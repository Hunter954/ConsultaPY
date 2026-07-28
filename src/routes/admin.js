import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { recentLogs } from '../db/index.js';
import { getWhatsAppState, logoutWhatsApp, restartWhatsApp } from '../bot/whatsapp.js';
import { renderAdmin, renderLogin } from '../views/admin.js';

export const adminRouter = express.Router();

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const requireAuth = (req, res, next) => (
  req.session?.admin ? next() : res.redirect('/admin/login')
);

adminRouter.get('/login', (req, res) => res.send(renderLogin(req.query.error === '1')));

adminRouter.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (safeEqual(req.body.username, config.adminUser) && safeEqual(req.body.password, config.adminPassword)) {
    req.session.regenerate((error) => {
      if (error) return res.redirect('/admin/login?error=1');
      req.session.admin = true;
      return res.redirect('/admin');
    });
  } else {
    res.redirect('/admin/login?error=1');
  }
});

adminRouter.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

adminRouter.get('/', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(renderAdmin());
});

adminRouter.get('/api/status', requireAuth, async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const state = getWhatsAppState();
  res.json({ ...state, logs: await recentLogs(30) });
});

adminRouter.post('/api/restart', requireAuth, async (_req, res) => {
  await restartWhatsApp();
  res.json({ ok: true });
});

adminRouter.post('/api/disconnect', requireAuth, async (_req, res) => {
  await logoutWhatsApp();
  res.json({ ok: true });
});
