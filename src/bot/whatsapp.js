import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from 'baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config.js';
import { logEvent } from '../db/index.js';
import { handleIncoming } from './handler.js';

const logger = pino({ level: config.env === 'development' ? 'info' : 'warn' });
let socket = null;
let starting = false;
let reconnectTimer = null;

const state = {
  status: 'disconnected',
  qr: null,
  qrDataUrl: null,
  user: null,
  lastError: null,
  updatedAt: new Date().toISOString()
};

const updateState = (patch) => {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
};

export const getWhatsAppState = () => ({ ...state });

export async function startWhatsApp() {
  if (starting) return;
  starting = true;
  clearTimeout(reconnectTimer);

  try {
    console.log(`[WhatsApp] Iniciando. Sessão: ${config.authDir}`);
    await fs.mkdir(config.authDir, { recursive: true });

    const { state: auth, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    socket = makeWASocket({
      version,
      auth,
      logger,
      browser: Browsers.ubuntu('Consulta Paraguai'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 120_000,
      connectTimeoutMs: 120_000
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', (event) => handleIncoming(socket, event));

    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 340, margin: 2 });
          updateState({
            status: 'qr',
            qr,
            qrDataUrl,
            user: null,
            lastError: null
          });
          console.log('[WhatsApp] QR Code gerado. Abra /admin para escanear.');
        } catch (error) {
          updateState({ status: 'error', lastError: `Falha ao converter QR Code: ${error.message}` });
          console.error('[WhatsApp] Falha ao converter QR Code:', error);
        }
      }

      // O Baileys pode enviar "qr" e "connecting" no mesmo update.
      // Nunca apague o QR durante connecting.
      if (connection === 'connecting') {
        updateState({
          status: state.qrDataUrl ? 'qr' : 'connecting',
          lastError: null
        });
      }

      if (connection === 'open') {
        updateState({
          status: 'connected',
          qr: null,
          qrDataUrl: null,
          user: socket.user || null,
          lastError: null
        });
        console.log('[WhatsApp] Conectado.');
        await logEvent('info', 'whatsapp_connected', { user: socket.user });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error
          ? new Boom(lastDisconnect.error).output?.statusCode
          : undefined;
        const loggedOut = code === DisconnectReason.loggedOut;

        updateState({
          status: loggedOut ? 'logged_out' : 'disconnected',
          qr: null,
          qrDataUrl: null,
          user: null,
          lastError: lastDisconnect?.error?.message || (code ? `Código ${code}` : 'Conexão encerrada')
        });

        await logEvent('warn', 'whatsapp_disconnected', { code, loggedOut });
        socket = null;

        if (!loggedOut) {
          reconnectTimer = setTimeout(() => startWhatsApp(), 5_000);
        }
      }
    });
  } catch (error) {
    updateState({
      status: 'error',
      qr: null,
      qrDataUrl: null,
      lastError: error.message
    });
    console.error('[WhatsApp] Erro ao iniciar:', error);
    await logEvent('error', 'whatsapp_start_error', {
      message: error.message,
      stack: error.stack
    });
    reconnectTimer = setTimeout(() => startWhatsApp(), 10_000);
  } finally {
    starting = false;
  }
}

export async function restartWhatsApp() {
  clearTimeout(reconnectTimer);
  try {
    socket?.end?.(new Error('Reinício solicitado pelo admin'));
  } catch {}
  socket = null;
  updateState({
    status: 'restarting',
    qr: null,
    qrDataUrl: null,
    user: null,
    lastError: null
  });
  setTimeout(() => startWhatsApp(), 500);
}

export async function logoutWhatsApp() {
  clearTimeout(reconnectTimer);
  try {
    if (socket) await socket.logout();
  } catch {}

  socket = null;
  await fs.rm(path.resolve(config.authDir), { recursive: true, force: true });
  await fs.mkdir(config.authDir, { recursive: true });

  updateState({
    status: 'logged_out',
    qr: null,
    qrDataUrl: null,
    user: null,
    lastError: null
  });

  await logEvent('warn', 'whatsapp_logout_by_admin');
  setTimeout(() => startWhatsApp(), 500);
}
