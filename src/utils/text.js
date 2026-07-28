export const cleanText = (value = '') => String(value).replace(/\s+/g, ' ').trim();
export const absoluteUrl = (url) => new URL(url, 'https://www.comprasparaguai.com.br').toString();
export const normalizeQuery = (value) => cleanText(value).toLocaleLowerCase('pt-BR').slice(0, 100);
export const onlyDigits = (value = '') => String(value).replace(/\D/g, '');
export const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export function moneyFromText(text, currency) {
  const marker = currency === 'USD' ? /US\$\s*([\d.]+(?:,\d{1,2})?)/i : /R\$\s*([\d.]+(?:,\d{1,2})?)/i;
  const match = cleanText(text).match(marker);
  return match ? match[1] : null;
}
