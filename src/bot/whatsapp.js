import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from 'baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config.js';
import { logEvent } from '../db/index.js';
import { handleIncoming } from './handler.js';

const logger = pino({ level: config.env === 'development' ? 'info' : 'warn' });
let socket = null;
let starting = false;
let reconnectTimer = null;
const state = { status: 'disconnected', qr: null, user: null, lastError: null, updatedAt: new Date().toISOString() };

const updateState = (patch) => Object.assign(state, patch, { updatedAt: new Date().toISOString() });
export const getWhatsAppState = () => ({ ...state });

export async function startWhatsApp() {
  if (starting) return;
  starting = true;
  clearTimeout(reconnectTimer);
  try {
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
      generateHighQualityLinkPreview: false
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', (event) => handleIncoming(socket, event));
    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) updateState({ status: 'qr', qr, lastError: null });
      if (connection === 'connecting') updateState({ status: 'connecting', qr: null });
      if (connection === 'open') {
        updateState({ status: 'connected', qr: null, user: socket.user || null, lastError: null });
        await logEvent('info', 'whatsapp_connected', { user: socket.user });
      }
      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error).output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        updateState({ status: loggedOut ? 'logged_out' : 'disconnected', qr: null, user: null, lastError: lastDisconnect?.error?.message || `Código ${code}` });
        await logEvent('warn', 'whatsapp_disconnected', { code, loggedOut });
        socket = null;
        if (!loggedOut) reconnectTimer = setTimeout(() => startWhatsApp(), 5_000);
      }
    });
  } catch (error) {
    updateState({ status: 'error', lastError: error.message });
    await logEvent('error', 'whatsapp_start_error', { message: error.message, stack: error.stack });
    reconnectTimer = setTimeout(() => startWhatsApp(), 10_000);
  } finally { starting = false; }
}

export async function restartWhatsApp() {
  try { socket?.end?.(new Error('Reinício solicitado pelo admin')); } catch {}
  socket = null;
  updateState({ status: 'restarting', qr: null, user: null });
  await startWhatsApp();
}

export async function logoutWhatsApp() {
  try { if (socket) await socket.logout(); } catch {}
  socket = null;
  await fs.rm(path.resolve(config.authDir), { recursive: true, force: true });
  await fs.mkdir(config.authDir, { recursive: true });
  updateState({ status: 'logged_out', qr: null, user: null });
  await logEvent('warn', 'whatsapp_logout_by_admin');
  await startWhatsApp();
}
