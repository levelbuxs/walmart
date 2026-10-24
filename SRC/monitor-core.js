export const BASE_URL = 'https://www.walmart.com/reviews/claim-product';
export const DEFAULT_KEYWORDS = ['chair', 'power bank', 'sofa', 'recliner', 'furniture', 'bed frame', 'Storage', 'outdoor', 'Gazebo', 'car', 'gaming', 'bike', 'ebike', 'Appliance', 'battery', 'ride on', 'scooter', 'camera', 'led', 'wireless', 'Electronics'];

export function keywordUrl(keyword = '') {
  const url = new URL(BASE_URL);
  url.searchParams.set('sort', 'price_high');
  if (keyword.trim()) url.searchParams.set('queryNups', keyword.trim());
  url.searchParams.set('page', '1');
  return url.href;
}
export function normalizeKeywords(input) {
  if (!Array.isArray(input) || input.length > 100) throw new Error('Use up to 100 keywords.');
  const seen = new Set();
  return input.map(value => {
    if (typeof value !== 'string' || value.length > 100) throw new Error('Each keyword must be text, up to 100 characters.');
    return value.trim();
  }).filter(value => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()));
}
export function validateSettings(input = {}) {
  const minutes = Number(input.minutes ?? 5), concurrency = Number(input.concurrency ?? 1);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('Set an interval from 1 to 1,440 minutes.');
  if (![1, 2, 3].includes(concurrency)) throw new Error('Choose 1, 2, or 3 simultaneous pages.');
  return { minutes, concurrency, telegram: !!input.telegram, chatId: String(input.chatId || '').trim().slice(0, 100) };
}
export function diffProducts(previous, products) {
  const unique = [...new Map(products.map(p => [p.id, p])).values()];
  const oldIds = new Set(previous?.products.map(p => p.id) || []);
  const added = previous ? unique.filter(p => !oldIds.has(p.id)) : [];
  const urgent = added.filter(p => previous.high != null && Number.isFinite(p.price) && p.price > previous.high);
  const known = unique.map(p => p.price).filter(Number.isFinite);
  const high = Math.max(previous?.high ?? -Infinity, ...known);
  return { products: unique, added, urgent, high: Number.isFinite(high) ? high : null, baseline: !previous };
}

export function selectDueKeywords(keywords, activeIds, now, concurrency) {
  return keywords.filter(k => !activeIds.has(k.id) && k.nextDue <= now)
    .sort((a, b) => a.nextDue - b.nextDue)
    .slice(0, Math.max(0, concurrency - activeIds.size));
}

// Serialized into the visible Walmart page by Playwright. Never clicks a claim button.
export function readClaimableProducts() {
  const text = node => (node?.innerText || node?.textContent || '').trim();
  const body = text(document.body);
  if (/verify you are human|robot or human|press and hold|unusual traffic|access denied|prove you are human/i.test(body)) return { status: 'verification', products: [] };
  const roots = new Set();
  for (const anchor of document.querySelectorAll('a[href*="/ip/"]')) {
    let card = anchor.closest('[data-item-id]');
    if (!card) {
      for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.querySelectorAll('h3').length > 1) break;
        if (/valued at\s*\$/i.test(text(parent)) && parent.querySelector('h3')) { card = parent; break; }
      }
    }
    if (card) roots.add(card);
  }
  const products = new Map();
  let excluded = 0;
  for (const card of roots) {
    const cardText = text(card);
    if (/out of stock|shop similar|sold out|currently unavailable/i.test(cardText)) { excluded++; continue; }
    const action = [...card.querySelectorAll('button, a, [role="button"]')].find(el => /^(view item|claim|claim item|claim product)$/i.test(text(el)) && !el.disabled && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    if (!action) { excluded++; continue; }
    const link = card.querySelector('a[link-identifier][href*="/ip/"], a[href*="/ip/"]');
    const title = text(card.querySelector('[data-automation-id="product-title"], h3')) || link?.getAttribute('aria-label');
    if (!title || !link) continue;
    let url;
    try { url = new URL(link.getAttribute('href'), location.href); if (!['http:', 'https:'].includes(url.protocol)) continue; } catch { continue; }
    const id = card.getAttribute('data-item-id') || link.getAttribute('link-identifier') || url.pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1] || url.pathname;
    // Reviewer items are Free: the important number is the stated product VALUE, not $0.
    const priceMatch = cardText.match(/Valued at\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    const price = priceMatch ? Number(priceMatch[1].replaceAll(',', '')) : null;
    const img = card.querySelector('img[data-testid="productTileImage"], img');
    let image = img?.currentSrc || img?.getAttribute('src') || img?.getAttribute('data-src') || '';
    try { const u = new URL(image, location.href); image = image && /^https?:$/.test(u.protocol) ? u.href : ''; } catch { image = ''; }
    products.set(id, { id, title, url: url.href, price, image });
  }
  if (!roots.size && /no results|no items found|no products found|0 results/i.test(body)) return { status: 'empty', products: [], excluded: 0, cards: 0 };
  if (!roots.size && (/\/account\//.test(location.pathname) || /sign in to (your account|continue)|log in to continue/i.test(body))) return { status: 'login', products: [] };
  return { status: roots.size ? 'ok' : 'unrecognized', products: [...products.values()], excluded, cards: roots.size };
}
