import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getCache, setCache } from '../db/index.js';
import { absoluteUrl, cleanText, moneyFromText, normalizeQuery } from '../utils/text.js';

const SITE_ORIGIN = 'https://www.comprasparaguai.com.br';
const SITE_HOST_RE = /(?:www\.|mobile\.)?comprasparaguai\.com\.br/i;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

const directClient = axios.create({
  timeout: config.requestTimeoutMs,
  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: `${SITE_ORIGIN}/`,
    'Upgrade-Insecure-Requests': '1'
  },
  maxContentLength: 5_000_000,
  maxBodyLength: 5_000_000,
  validateStatus: (status) => status >= 200 && status < 400
});

const readerClient = axios.create({
  timeout: Math.max(config.requestTimeoutMs, 30_000),
  headers: {
    Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',
    'User-Agent': BROWSER_UA,
    'X-Return-Format': 'markdown',
    'X-Timeout': '25'
  },
  maxContentLength: 8_000_000,
  maxBodyLength: 8_000_000
});

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function siteUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  return new URL(input, SITE_ORIGIN).toString();
}

async function fetchPage(input) {
  const url = siteUrl(input);
  try {
    const response = await directClient.get(url);
    return { content: String(response.data || ''), format: 'html', source: 'direct', url };
  } catch (error) {
    const status = error.response?.status;
    const blocked = status === 401 || status === 403 || status === 429;
    if (!blocked) throw friendlyRequestError(error);

    console.warn(`[ComprasParaguai] Acesso direto bloqueado (${status}). Tentando leitor alternativo.`);

    // Alguns destinos funcionam no Reader apenas com http://, outros com https://.
    // Também tentamos o domínio mobile, pois ele pode ter regras de CDN diferentes.
    const parsed = new URL(url);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    const targets = uniqueBy([
      url,
      `http://www.comprasparaguai.com.br${pathAndQuery}`,
      `https://mobile.comprasparaguai.com.br${pathAndQuery}`,
      `http://mobile.comprasparaguai.com.br${pathAndQuery}`
    ], (value) => value);

    let lastError;
    for (const target of targets) {
      try {
        const readerUrl = `https://r.jina.ai/${target}`;
        const response = await readerClient.get(readerUrl);
        const content = String(response.data || '');
        if (!content.trim()) continue;
        const looksHtml = /<!doctype html|<html[\s>]|<body[\s>]/i.test(content);
        console.info(`[ComprasParaguai] Leitor alternativo respondeu (${content.length} bytes) para ${target}.`);
        return {
          content,
          format: looksHtml ? 'html' : 'markdown',
          source: 'reader',
          url: target
        };
      } catch (readerError) {
        lastError = readerError;
      }
    }

    const readerStatus = lastError?.response?.status;
    const finalError = new Error(
      `O Compras Paraguai bloqueou a consulta do servidor${status ? ` (HTTP ${status})` : ''}` +
      `${readerStatus ? ` e o acesso alternativo respondeu HTTP ${readerStatus}` : ''}.`
    );
    finalError.code = 'COMPRAS_PARAGUAI_BLOCKED';
    finalError.cause = lastError;
    throw finalError;
  }
}
function friendlyRequestError(error) {
  const status = error.response?.status;
  const message = status
    ? `Falha ao consultar o Compras Paraguai (HTTP ${status}).`
    : `Falha de rede ao consultar o Compras Paraguai: ${error.message}`;
  const result = new Error(message);
  result.code = 'COMPRAS_PARAGUAI_REQUEST_FAILED';
  result.cause = error;
  return result;
}

function parseMarkdownLinks(markdown) {
  const links = [];

  // Links Markdown tradicionais: [texto](url)
  const markdownRegex = /\[([^\]]{2,300})\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g;
  let match;
  while ((match = markdownRegex.exec(markdown))) {
    links.push({ text: cleanText(match[1]), url: siteUrl(match[2]), index: match.index });
  }

  // O Jina Reader pode devolver URLs cruas ou o texto seguido da URL.
  const rawUrlRegex = /https?:\/\/(?:www\.|mobile\.)?comprasparaguai\.com\.br\/[^\s<>()\]]+/gi;
  while ((match = rawUrlRegex.exec(markdown))) {
    const rawUrl = match[0].replace(/[.,;:'\"]+$/, '');
    const before = markdown.slice(Math.max(0, match.index - 320), match.index);
    const lines = before.split(/\r?\n/).map(cleanText).filter(Boolean);
    const candidate = lines.reverse().find((line) =>
      line.length >= 5 && line.length <= 260 &&
      !/^(source:|url source:|published time:|markdown content:|image:)/i.test(line)
    );
    links.push({ text: cleanText(candidate || ''), url: siteUrl(rawUrl), index: match.index });
  }

  // Também aceita caminhos relativos soltos, comuns em HTML convertido para texto.
  const relativeRegex = /(?:^|[\s"'(])\/(?!busca\/|lojas\/|categorias\/)([a-z0-9][a-z0-9\-_%]*_+\d+)\/?(?:\?[^\s<>()\]]*)?/gim;
  while ((match = relativeRegex.exec(markdown))) {
    const relative = `/${match[1]}/`;
    const before = markdown.slice(Math.max(0, match.index - 260), match.index);
    const lines = before.split(/\r?\n/).map(cleanText).filter(Boolean);
    links.push({ text: cleanText(lines.at(-1) || ''), url: siteUrl(relative), index: match.index });
  }

  return uniqueBy(links, (item) => item.url);
}
function nearbyText(text, index, radius = 350) {
  return cleanText(text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)));
}

function parseProductsFromHtml(html) {
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
    products.push({
      name,
      usd: moneyFromText(blockText, 'USD'),
      brl: moneyFromText(blockText, 'BRL'),
      offers: Number.parseInt(blockText.match(/(\d+)\s+OFERTAS?/i)?.[1] || '0', 10),
      url: full
    });
  });
  return products;
}

function productUrlInfo(inputUrl) {
  try {
    const parsed = new URL(inputUrl, SITE_ORIGIN);
    if (!SITE_HOST_RE.test(parsed.hostname)) return null;
    if (/^\/(?:busca|lojas|categorias)\//i.test(parsed.pathname)) return null;
    // Há páginas agrupadoras com _48863 e ofertas individuais com __5335591.
    const match = parsed.pathname.match(/^\/([^/]*?_+\d+)\/?$/i);
    if (!match) return null;
    return { url: `${SITE_ORIGIN}/${match[1]}/`, slug: match[1] };
  } catch {
    return null;
  }
}

function titleFromSlug(slug = '') {
  return cleanText(
    decodeURIComponent(slug)
      .replace(/_+\d+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function bestProductName(linkText, block, slug) {
  const invalid = /^(ver oferta|ver ofertas|saiba mais|imagem|image|produto|link)$/i;
  const candidates = [
    cleanText(linkText),
    ...String(block).split(/\r?\n/).map(cleanText).reverse(),
    titleFromSlug(slug)
  ];
  return candidates.find((value) =>
    value && value.length >= 8 && value.length <= 240 &&
    !invalid.test(value) &&
    !/^(US\$|R\$|a partir de|\d+ ofertas?)/i.test(value)
  ) || titleFromSlug(slug);
}

function parseProductsFromMarkdown(markdown) {
  const products = [];
  for (const link of parseMarkdownLinks(markdown)) {
    const info = productUrlInfo(link.url);
    if (!info) continue;
    const rawBlock = markdown.slice(Math.max(0, link.index - 650), Math.min(markdown.length, link.index + 350));
    const block = cleanText(rawBlock);
    const name = bestProductName(link.text, rawBlock, info.slug);
    products.push({
      name,
      usd: moneyFromText(block, 'USD'),
      brl: moneyFromText(block, 'BRL'),
      offers: Number.parseInt(block.match(/(\d+)\s+OFERTAS?/i)?.[1] || '0', 10),
      url: info.url
    });
  }

  // Último recurso: encontra slugs mesmo quando o Reader removeu a marcação dos links.
  const slugRegex = /(?:https?:\/\/(?:www\.|mobile\.)?comprasparaguai\.com\.br)?\/([a-z0-9][a-z0-9\-_%]*?_+\d+)\/?/gi;
  let match;
  while ((match = slugRegex.exec(markdown))) {
    const info = productUrlInfo(`${SITE_ORIGIN}/${match[1]}/`);
    if (!info) continue;
    const rawBlock = markdown.slice(Math.max(0, match.index - 650), Math.min(markdown.length, match.index + 350));
    const block = cleanText(rawBlock);
    products.push({
      name: bestProductName('', rawBlock, info.slug),
      usd: moneyFromText(block, 'USD'),
      brl: moneyFromText(block, 'BRL'),
      offers: Number.parseInt(block.match(/(\d+)\s+OFERTAS?/i)?.[1] || '0', 10),
      url: info.url
    });
  }

  return uniqueBy(products, (item) => item.url)
    .filter((item) => item.name.length >= 8 && item.name.length <= 240);
}
export async function searchProducts(rawQuery) {
  const query = normalizeQuery(rawQuery);
  if (query.length < 2) throw new Error('Digite pelo menos 2 caracteres.');
  const cacheKey = `products:${query}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const url = `${SITE_ORIGIN}/busca/?q=${encodeURIComponent(query)}`;
  const page = await fetchPage(url);
  const products = page.format === 'html'
    ? parseProductsFromHtml(page.content)
    : parseProductsFromMarkdown(page.content);

  console.info(`[ComprasParaguai] Parser ${page.format}/${page.source}: ${products.length} produto(s) identificado(s).`);

  const result = uniqueBy(products, (p) => p.url)
    .sort((a, b) => Number(Boolean(b.usd)) - Number(Boolean(a.usd)))
    .slice(0, config.maxProducts);

  await setCache(cacheKey, result, config.cacheTtlSeconds);
  return result;
}

function parseOffersFromHtml(html) {
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
  return offers;
}

function parseOffersFromMarkdown(markdown) {
  return parseMarkdownLinks(markdown)
    .filter(({ url }) => url.includes('/lojas/'))
    .map((link) => {
      const block = nearbyText(markdown, link.index, 420);
      return {
        storeName: link.text,
        usd: moneyFromText(block, 'USD'),
        brl: moneyFromText(block, 'BRL'),
        storeUrl: link.url
      };
    })
    .filter((offer) => offer.storeName && (offer.usd || offer.brl));
}

export async function getProductOffers(productUrl) {
  const cacheKey = `offers:${productUrl}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const page = await fetchPage(productUrl);
  const offers = page.format === 'html'
    ? parseOffersFromHtml(page.content)
    : parseOffersFromMarkdown(page.content);

  const result = uniqueBy(offers, (o) => `${o.storeUrl}:${o.usd}:${o.brl}`).slice(0, config.maxOffers);
  await setCache(cacheKey, result, config.cacheTtlSeconds);
  return result;
}

function extractStoreDetailsFromText(text, storeUrl, title = '') {
  const clean = cleanText(text);
  const phones = uniqueBy(
    (clean.match(/(?:\+?595|0)?\s*\(?\d{2,4}\)?[\s.-]*\d{3,4}[\s.-]*\d{3,4}/g) || []).map(cleanText),
    (value) => value
  ).slice(0, 3);
  const address = clean.match(/([^.\n]{5,180}(?:Ciudad del Este|Pedro Juan Caballero|Salto del Guairá)[^.\n]{0,100})/i)?.[1] || '';
  const hours = clean.match(/De Segunda[^|.\n]{0,120}(?:\|[^.\n]{0,100})?/i)?.[0] || '';
  return {
    name: cleanText(title),
    address: cleanText(address),
    phones,
    whatsapp: text.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s)\]]+/i)?.[0] || null,
    website: null,
    map: text.match(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.app\.goo\.gl)\/[^\s)\]]+/i)?.[0] || null,
    hours: cleanText(hours),
    url: storeUrl
  };
}

export async function getStoreDetails(storeUrl) {
  const cacheKey = `store:${storeUrl}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const page = await fetchPage(storeUrl);
  let details;

  if (page.format === 'html') {
    const $ = cheerio.load(page.content);
    const body = cleanText($('body').text());
    const title = cleanText($('h1').first().text() || $('title').text().replace(/\s*[-|].*$/, ''));
    details = extractStoreDetailsFromText(page.content, storeUrl, title);
    const addressCandidates = [];
    $('[itemprop="streetAddress"], address, .address, .endereco, [class*="address"], [class*="endereco"]').each((_, el) => {
      const value = cleanText($(el).text());
      if (value.length > 8) addressCandidates.push(value);
    });
    details.address = uniqueBy(addressCandidates, (value) => value)[0] || details.address;
    details.whatsapp = $('a[href*="wa.me"],a[href*="api.whatsapp.com"]').first().attr('href') || details.whatsapp;
    details.website = $('a[href^="http"]').filter((_, el) => {
      const href = $(el).attr('href') || '';
      return !href.includes('comprasparaguai.com.br') && !href.includes('facebook.com') && !href.includes('instagram.com') && !href.includes('wa.me');
    }).first().attr('href') || null;
    details.map = $('a[href*="google.com/maps"],a[href*="maps.app.goo.gl"]').first().attr('href') || details.map;
  } else {
    const title = cleanText(page.content.match(/^Title:\s*(.+)$/im)?.[1] || '');
    details = extractStoreDetailsFromText(page.content, storeUrl, title);
    const links = parseMarkdownLinks(page.content);
    details.website = links.find(({ url }) =>
      !url.includes('comprasparaguai.com.br') &&
      !url.includes('facebook.com') &&
      !url.includes('instagram.com') &&
      !url.includes('wa.me') &&
      !url.includes('google.com/maps')
    )?.url || null;
  }

  await setCache(cacheKey, details, config.cacheTtlSeconds * 6);
  return details;
}
