import { config } from '../config.js';

export const menuMessage = () => `🛍️ *${config.botName}*\n\n1️⃣ Pesquisar produto\n2️⃣ Ajuda\n\nDigite *1* para pesquisar ou escreva diretamente o nome do produto.\nExemplo: *iPhone 16 Pro Max 256GB*`;

export const helpMessage = () => `ℹ️ *Como usar*\n\n• Digite *menu* para abrir o menu.\n• Digite o nome de um produto para pesquisar.\n• Depois, responda com o número do produto e da oferta.\n• Digite *cancelar* para voltar ao início.\n\n⚠️ Preços e estoque podem mudar. Confirme sempre diretamente com a loja.`;

export function productsMessage(query, products) {
  const lines = products.map((p, i) => {
    const price = p.usd ? `US$ ${p.usd}` : (p.brl ? `R$ ${p.brl}` : 'Preço não identificado');
    const offers = p.offers ? ` · ${p.offers} oferta(s)` : '';
    return `*${i + 1}.* ${p.name}\n   A partir de ${price}${offers}`;
  });
  return `🔎 *Resultados para:* ${query}\n\n${lines.join('\n\n')}\n\nResponda com o número do produto.\nDigite *cancelar* para voltar.`;
}

export function offersMessage(product, offers) {
  const lines = offers.map((o, i) => {
    const prices = [o.usd && `US$ ${o.usd}`, o.brl && `R$ ${o.brl}`].filter(Boolean).join(' · ');
    return `*${i + 1}.* ${o.storeName}\n   ${prices}`;
  });
  return `📦 *${product.name}*\n\n${lines.join('\n\n')}\n\nResponda com o número da loja para ver os detalhes.`;
}

export function storeMessage(offer, store) {
  const lines = [
    `🏪 *${store.name || offer.storeName}*`,
    '',
    `💵 Preço: ${[offer.usd && `US$ ${offer.usd}`, offer.brl && `R$ ${offer.brl}`].filter(Boolean).join(' · ')}`,
    store.address && `📍 ${store.address}`,
    store.hours && `🕒 ${store.hours}`,
    store.phones?.length && `☎️ ${store.phones.join(' / ')}`,
    store.whatsapp && `📱 WhatsApp: ${store.whatsapp}`,
    store.website && `🌐 Site: ${store.website}`,
    store.map && `🗺️ Mapa: ${store.map}`,
    `🔗 Fonte: ${store.url}`,
    '',
    '⚠️ Confirme preço e estoque diretamente com a loja.',
    '',
    'Digite *menu* para uma nova pesquisa.'
  ].filter(Boolean);
  return lines.join('\n');
}
