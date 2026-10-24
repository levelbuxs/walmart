export const DEFAULT_SELECTORS = {
  card: '[data-test-id="gpt-main"], [data-item-id]',
  title: '[data-automation-id="product-title"], h3',
  link: 'a[href*="/ip/"]',
  price: ''
};

export function parsePrice(text) {
  const match = String(text).match(/Valued at\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)
    || String(text).match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function compareSnapshot(previous, products) {
  const current = [...new Map(products.map(p => [p.id, p])).values()];
  const prices = current.map(p => p.price).filter(p => Number.isFinite(p));
  const currentMax = prices.length ? Math.max(...prices) : null;
  if (!previous) return { baseline: true, added: [], removed: [], urgent: [], high: currentMax, products: current };
  const oldIds = new Set(previous.products.map(p => p.id));
  const ids = new Set(current.map(p => p.id));
  const added = current.filter(p => !oldIds.has(p.id));
  const oldPrices = previous.products.map(p => p.price).filter(p => Number.isFinite(p));
  const high = previous.high ?? (oldPrices.length ? Math.max(...oldPrices) : null);
  return {
    baseline: false, added,
    removed: previous.products.filter(p => !ids.has(p.id)),
    urgent: added.filter(p => Number.isFinite(p.price) && high !== null && p.price > high),
    high: high === null ? currentMax : currentMax === null ? high : Math.max(high, currentMax), products: current
  };
}

export function validateMonitor(input) {
  const keyword = String(input.keyword || '').trim();
  if (!keyword || keyword.length > 100) throw new Error('Enter a keyword (up to 100 characters).');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('Enter a valid full page URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) page URL without embedded credentials.');
  const minutes = Number(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10) throw new Error('Choose an interval between 5 and 10 minutes.');
  return { keyword, url: url.href, minutes, selectors: { ...DEFAULT_SELECTORS, ...input.selectors } };
}
