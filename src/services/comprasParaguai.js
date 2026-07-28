import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getCache, setCache } from '../db/index.js';
import { absoluteUrl, cleanText, moneyFromText, normalizeQuery } from '../utils/text.js';

const client = axios.create({
  baseURL: 'https://www.comprasparaguai.com.br',
  timeout: config.requestTimeoutMs,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ConsultaParaguaiBot/1.0)',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7'
  },
  maxContentLength: 5_000_000,
  maxBodyLength: 5_000_000
});

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function searchProducts(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) throw new Error('Digite pelo menos 2 caracteres.');
  const cacheKey = `products:${query}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data: html } = await client.get('/busca/', { params: { q: query } });
  const $ = cheerio.load(html);
  const products = [];

  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href') || '';
    if (!/^https?:\/\//.test(href) && !href.startsWith('/')) return;
    if (href.includes('/busca/') || href.includes('/lojas/') || href.includes('/categorias/')) return;
    const full = absoluteUrl(href);
    if (!/comprasparaguai\.com\.br\/.+_\d+\/?(?:\?|$)/i.test(full)) return;

    const card = $(anchor).closest('article, li, .card, .product, .produto, div').first();
    const blockText = cleanText(card.text() || $(anchor).text());
    const name = cleanText($(anchor).attr('title') || $(anchor).find('h1,h2,h3,h4,.title,.nome').first().text() || $(anchor).text());
    if (!name || name.length < 8 || name.length > 240) return;
    const usd = moneyFromText(blockText, 'USD');
    const brl = moneyFromText(blockText, 'BRL');
    const offers = Number.parseInt(blockText.match(/(\d+)\s+OFERTAS?/i)?.[1] || '0', 10);
    products.push({ name, usd, brl, offers, url: full });
  });

  const result = uniqueBy(products, (p) => p.url)
    .sort((a, b) => Number(Boolean(b.usd)) - Number(Boolean(a.usd)))
    .slice(0, config.maxProducts);

  await setCache(cacheKey, result, config.cacheTtlSeconds);
  return result;
}

export async function getProductOffers(productUrl) {
  const cacheKey = `offers:${productUrl}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data: html } = await client.get(productUrl);
  const $ = cheerio.load(html);
  const offers = [];

  $('a[href*="/lojas/"]').each((_, anchor) => {
    const storeUrl = absoluteUrl($(anchor).attr('href'));
    const storeName = cleanText($(anchor).attr('title') || $(anchor).text());
    if (!storeName || storeName.length > 100) return;
    const row = $(anchor).closest('tr, li, article, .offer, .oferta, .card, div').first();
    const text = cleanText(row.text());
    const usd = moneyFromText(text, 'USD');
    const brl = moneyFromText(text, 'BRL');
    if (!usd && !brl) return;
    offers.push({ storeName, usd, brl, storeUrl });
  });

  const result = uniqueBy(offers, (o) => `${o.storeUrl}:${o.usd}:${o.brl}`).slice(0, config.maxOffers);
  await setCache(cacheKey, result, config.cacheTtlSeconds);
  return result;
}

export async function getStoreDetails(storeUrl) {
  const cacheKey = `store:${storeUrl}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const { data: html } = await client.get(storeUrl);
  const $ = cheerio.load(html);
  const body = cleanText($('body').text());
  const title = cleanText($('h1').first().text() || $('title').text().replace(/\s*[-|].*$/, ''));
  const phones = uniqueBy((body.match(/(?:\+?595|0)?\s*\(?\d{2,4}\)?[\s.-]*\d{3,4}[\s.-]*\d{3,4}/g) || []).map(cleanText), x => x).slice(0, 3);
  const whatsappLink = $('a[href*="wa.me"],a[href*="api.whatsapp.com"]').first().attr('href') || null;
  const website = $('a[href^="http"]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return !href.includes('comprasparaguai.com.br') && !href.includes('facebook.com') && !href.includes('instagram.com') && !href.includes('wa.me');
  }).first().attr('href') || null;
  const mapLink = $('a[href*="google.com/maps"],a[href*="maps.app.goo.gl"]').first().attr('href') || null;
  const addressCandidates = [];
  $('[itemprop="streetAddress"], address, .address, .endereco, [class*="address"], [class*="endereco"]').each((_, el) => {
    const value = cleanText($(el).text()); if (value.length > 8) addressCandidates.push(value);
  });
  const fallbackAddress = body.match(/([^.]{5,140}(?:Ciudad del Este|Pedro Juan Caballero|Salto del Guairá)[^.]{0,80})/i)?.[1];
  const hours = body.match(/De Segunda[^|.]{0,100}(?:\|[^.]{0,80})?/i)?.[0] || null;
  const details = {
    name: title,
    address: uniqueBy(addressCandidates, x => x)[0] || cleanText(fallbackAddress || ''),
    phones,
    whatsapp: whatsappLink,
    website,
    map: mapLink,
    hours: cleanText(hours || ''),
    url: storeUrl
  };
  await setCache(cacheKey, details, config.cacheTtlSeconds * 6);
  return details;
}
