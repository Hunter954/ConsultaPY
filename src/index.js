import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { config, validateConfig } from './config.js';
import { migrate, pool } from './db/index.js';
import { startWhatsApp } from './bot/whatsapp.js';
import { adminRouter } from './routes/admin.js';

validateConfig();
await migrate();
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  name: 'consulta.admin', secret: config.sessionSecret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: config.env === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));
app.get('/', (_req, res) => res.redirect('/admin'));
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: config.botName }); }
  catch { res.status(503).json({ ok: false }); }
});
app.use('/admin', adminRouter);
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.listen(config.port, '0.0.0.0', () => console.log(`${config.botName} rodando na porta ${config.port}`));
startWhatsApp();
