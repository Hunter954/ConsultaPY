import 'dotenv/config';

const integer = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: integer('PORT', 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${integer('PORT', 3000)}`,
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: (process.env.DATABASE_SSL || 'true') === 'true',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  authDir: process.env.BAILEYS_AUTH_DIR || './data/baileys',
  maxProducts: integer('MAX_PRODUCTS', 5),
  maxOffers: integer('MAX_OFFERS', 8),
  cacheTtlSeconds: integer('CACHE_TTL_SECONDS', 600),
  requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 15000),
  botName: process.env.BOT_NAME || 'Consulta Paraguai'
};

export function validateConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length) throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
}
