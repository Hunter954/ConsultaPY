import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from 'baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { logEvent } from '../db/index.js';
import { handleIncoming } from './handler.js';

const logger = pino({ level: config.env === 'development' ? 'info' : 'warn' });
let socket = null;
let starting = false;
let reconnectTimer = null;
let generation = 0;

const state = {
  status: 'disconnected',
  qr: null,
  qrDataUrl: null,
  user: null,
  lastError: null,
  updatedAt: new Date().toISOString()
};

const updateState = (patch) => Object.assign(state, patch, { updatedAt: new Date().toISOString() });
export const getWhatsAppState = () => ({ ...state });

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const scheduleReconnect = (delay = 5_000) => {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => startWhatsApp(), delay);
};

export async function startWhatsApp() {
  if (starting || socket) return;
  starting = true;
  clearTimeout(reconnectTimer);
  const currentGeneration = ++generation;

  try {
    updateState({ status: 'starting', qr: null, qrDataUrl: null, lastError: null });
    console.log(`[WhatsApp] Iniciando. Sessão: ${config.authDir}`);

    await fs.mkdir(config.authDir, { recursive: true });
    const { state: auth, saveCreds } = await useMultiFileAuthState(config.authDir);

    // A consulta de versão pode falhar ou demorar no Railway. Nesse caso,
    // deixamos o Baileys usar a versão padrão embutida no pacote.
    const versionResult = await withTimeout(
      fetchLatestBaileysVersion().catch(() => ({ version: undefined })),
      15_000,
      'Consulta da versão do WhatsApp'
    ).catch((error) => {
      console.warn(`[WhatsApp] ${error.message}. Continuando com a versão padrão.`);
      return { version: undefined };
    });

    const socketOptions = {
      auth,
      logger,
      browser: Browsers.ubuntu('Consulta Paraguai'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 120_000,
      defaultQueryTimeoutMs: 120_000,
      keepAliveIntervalMs: 25_000
    };
    if (versionResult?.version) socketOptions.version = versionResult.version;

    const sock = makeWASocket(socketOptions);
    socket = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', (event) => {
      void handleIncoming(sock, event).catch(async (error) => {
        console.error('[WhatsApp] Falha não tratada ao processar mensagem:', error?.message || error);
        try {
          await logEvent('error', 'messages_upsert_unhandled_error', {
            message: error?.message || String(error),
            stack: error?.stack || null
          });
        } catch (logError) {
          console.error('[WhatsApp] Também falhou ao registrar o erro:', logError?.message || logError);
        }
      });
    });
    sock.ev.on('connection.update', async (update) => {
      if (currentGeneration !== generation || socket !== sock) return;

      const { connection, lastDisconnect, qr } = update;

      // O Baileys normalmente envia "qr" e "connection: connecting" no mesmo
      // evento. Antes o bloco de connecting apagava o QR recém-recebido.
      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 1, scale: 8 });
          if (currentGeneration !== generation || socket !== sock) return;
          updateState({
            status: 'qr',
            qr,
            qrDataUrl,
            user: null,
            lastError: null
          });
          console.log('[WhatsApp] QR Code gerado. Abra /admin para escanear.');
          await logEvent('info', 'whatsapp_qr_generated');
        } catch (error) {
          updateState({ status: 'error', lastError: `Falha ao gerar imagem do QR: ${error.message}` });
          await logEvent('error', 'whatsapp_qr_render_error', { message: error.message });
        }
      }

      if (connection === 'connecting' && !qr && !state.qrDataUrl) {
        updateState({ status: 'connecting', lastError: null });
      }

      if (connection === 'open') {
        updateState({
          status: 'connected',
          qr: null,
          qrDataUrl: null,
          user: sock.user || null,
          lastError: null
        });
        console.log(`[WhatsApp] Conectado como ${sock.user?.id || 'conta vinculada'}.`);
        await logEvent('info', 'whatsapp_connected', { user: sock.user });
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error).output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const message = lastDisconnect?.error?.message || `Conexão encerrada (código ${code || 'desconhecido'})`;

        if (socket === sock) socket = null;
        updateState({
          status: loggedOut ? 'logged_out' : 'disconnected',
          qr: null,
          qrDataUrl: null,
          user: null,
          lastError: message
        });
        console.warn(`[WhatsApp] Desconectado. Código: ${code}. ${message}`);
        await logEvent('warn', 'whatsapp_disconnected', { code, loggedOut, message });
        if (!loggedOut) scheduleReconnect(5_000);
      }
    });
  } catch (error) {
    socket = null;
    updateState({ status: 'error', qr: null, qrDataUrl: null, lastError: error.message });
    console.error('[WhatsApp] Erro ao iniciar:', error);
    await logEvent('error', 'whatsapp_start_error', { message: error.message, stack: error.stack });
    scheduleReconnect(10_000);
  } finally {
    starting = false;
  }
}

export async function restartWhatsApp() {
  clearTimeout(reconnectTimer);
  generation += 1;
  const oldSocket = socket;
  socket = null;
  updateState({ status: 'restarting', qr: null, qrDataUrl: null, user: null, lastError: null });

  try {
    oldSocket?.ev?.removeAllListeners?.('connection.update');
    oldSocket?.ws?.close?.();
    oldSocket?.end?.(new Error('Reinício solicitado pelo admin'));
  } catch {}

  await new Promise((resolve) => setTimeout(resolve, 500));
  await startWhatsApp();
}

export async function logoutWhatsApp() {
  clearTimeout(reconnectTimer);
  generation += 1;
  const oldSocket = socket;
  socket = null;

  try {
    oldSocket?.ev?.removeAllListeners?.('connection.update');
    if (oldSocket) await oldSocket.logout();
  } catch {}

  await fs.rm(path.resolve(config.authDir), { recursive: true, force: true });
  await fs.mkdir(config.authDir, { recursive: true });
  updateState({ status: 'logged_out', qr: null, qrDataUrl: null, user: null, lastError: null });
  await logEvent('warn', 'whatsapp_logout_by_admin');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await startWhatsApp();
}
