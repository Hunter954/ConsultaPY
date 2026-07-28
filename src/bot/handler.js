import { clearSession, getSession, logEvent, saveSession } from '../db/index.js';
import { getProductOffers, getStoreDetails, searchProducts } from '../services/comprasParaguai.js';
import { cleanText } from '../utils/text.js';
import { helpMessage, menuMessage, offersMessage, productsMessage, storeMessage } from './messages.js';

const extractText = (message) => cleanText(
  message?.conversation || message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption || message?.videoMessage?.caption || ''
);

export async function handleIncoming(sock, event) {
  const message = event.messages?.[0];
  if (!message?.message || message.key.fromMe) return;
  const jid = message.key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;
  const text = extractText(message.message);
  if (!text) return;

  await logEvent('info', 'message_received', { jid, text: text.slice(0, 100) });
  const reply = (content) => sock.sendMessage(jid, { text: content }, { quoted: message });
  const lower = text.toLocaleLowerCase('pt-BR');

  try {
    if (['menu', 'oi', 'olá', 'ola', 'início', 'inicio', 'cancelar'].includes(lower)) {
      await clearSession(jid); await reply(menuMessage()); return;
    }
    if (lower === 'ajuda' || lower === '2') {
      await clearSession(jid); await reply(helpMessage()); return;
    }

    const session = await getSession(jid);
    if (session.step === 'waiting_product') return runSearch(jid, text, reply);

    if (session.step === 'choosing_product') {
      const index = Number.parseInt(text, 10) - 1;
      const products = session.payload.products || [];
      if (!Number.isInteger(index) || !products[index]) {
        await reply('❌ Opção inválida. Responda com o número de um produto da lista.'); return;
      }
      const product = products[index];
      await reply('⏳ Buscando as melhores ofertas...');
      const offers = await getProductOffers(product.url);
      if (!offers.length) {
        await clearSession(jid); await reply('Não consegui identificar ofertas agora. Tente outra pesquisa digitando *menu*.'); return;
      }
      await saveSession(jid, 'choosing_offer', { product, offers });
      await reply(offersMessage(product, offers)); return;
    }

    if (session.step === 'choosing_offer') {
      const index = Number.parseInt(text, 10) - 1;
      const offers = session.payload.offers || [];
      if (!Number.isInteger(index) || !offers[index]) {
        await reply('❌ Opção inválida. Responda com o número de uma loja da lista.'); return;
      }
      const offer = offers[index];
      await reply('⏳ Carregando informações da loja...');
      const store = await getStoreDetails(offer.storeUrl);
      await clearSession(jid); await reply(storeMessage(offer, store)); return;
    }

    if (text === '1') {
      await saveSession(jid, 'waiting_product', {});
      await reply('🔎 Digite o nome do produto que deseja pesquisar.\nExemplo: *iPhone 16 Pro Max 256GB*'); return;
    }

    await runSearch(jid, text, reply);
  } catch (error) {
    await logEvent('error', 'message_handler_error', { jid, message: error.message, stack: error.stack });
    await reply('⚠️ Não consegui concluir a consulta agora. Tente novamente em alguns instantes ou digite *menu*.');
  }
}

async function runSearch(jid, query, reply) {
  await reply(`⏳ Pesquisando *${query.slice(0, 80)}*...`);
  const products = await searchProducts(query);
  if (!products.length) {
    await saveSession(jid, 'waiting_product', {});
    await reply('Nenhum produto foi encontrado. Tente escrever o nome de outra forma.'); return;
  }
  await saveSession(jid, 'choosing_product', { query, products });
  await reply(productsMessage(query, products));
}
