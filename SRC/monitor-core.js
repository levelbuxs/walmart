export const BASE_URL = 'https://www.walmart.com/reviews/claim-product';
export const DEFAULT_KEYWORDS = ['chair', 'power bank', 'sofa', 'recliner', 'furniture', 'bed frame', 'Storage', 'outdoor', 'Gazebo', 'car', 'gaming', 'bike', 'ebike', 'Appliance', 'battery', 'ride on', 'scooter', 'camera', 'led', 'wireless', 'Electronics'];
// Sorts the reviewer portal is known to accept on /reviews/claim-product.
export const SORT_OPTIONS = [
  { value: 'price_high', label: 'Value: high to low' },
  { value: 'price_low', label: 'Value: low to high' }
];
export const MAX_PAGES_PER_KEYWORD = 5;
export const MAX_VALUE = 1000000;

export function keywordUrl(keyword = '', { page = 1, sort = 'price_high', base = BASE_URL } = {}) {
  const url = new URL(base);
  url.searchParams.set('sort', sort);
  if (keyword.trim()) url.searchParams.set('queryNups', keyword.trim());
  url.searchParams.set('page', String(page));
  return url.href;
}

// Deep link back to the reviewer portal item. The fragment mirrors the marker a
// companion adds to the card, so the page scrolls to and highlights the item.
export function claimAnchorId(product) {
  return `rr-claim-${product?.id ?? ''}`;
}
export function claimUrl(keyword, product, { sort = 'price_high', page = 1, base = BASE_URL } = {}) {
  const url = new URL(keywordUrl(keyword, { page, sort, base }));
  url.hash = `${claimAnchorId(product)}~${encodeURIComponent(product?.title || '')}`;
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
  const pages = Number(input.pages ?? 1);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES_PER_KEYWORD) throw new Error(`Choose 1 to ${MAX_PAGES_PER_KEYWORD} pages per search.`);
  const sort = String(input.sort ?? 'price_high');
  if (!SORT_OPTIONS.some(option => option.value === sort)) throw new Error('Choose a supported sort order.');
  const minValue = input.minValue === '' || input.minValue == null ? 0 : Number(input.minValue);
  const maxValue = input.maxValue === '' || input.maxValue == null ? 0 : Number(input.maxValue);
  if (!Number.isFinite(minValue) || minValue < 0 || minValue > MAX_VALUE) throw new Error('Minimum value must be 0 or more.');
  if (!Number.isFinite(maxValue) || maxValue < 0 || maxValue > MAX_VALUE) throw new Error('Maximum value must be 0 or more.');
  if (maxValue && minValue && maxValue < minValue) throw new Error('Maximum value must not be lower than the minimum.');
  return {
    minutes, concurrency, pages, sort,
    minValue: minValue || 0, maxValue: maxValue || 0,
    telegram: !!input.telegram, chatId: String(input.chatId || '').trim().slice(0, 100),
    desktopToasts: input.desktopToasts !== false
  };
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

// Keeps only products whose stated value falls inside the chosen range.
// Products with an unknown value cannot be confirmed to be in range, so they
// are counted separately instead of being silently shown as in-range.
export function applyValueRange(products, { minValue = 0, maxValue = 0 } = {}) {
  if (!minValue && !maxValue) return { products, filtered: 0, unknown: 0 };
  const kept = [], unknown = [];
  let filtered = 0;
  for (const product of products) {
    if (!Number.isFinite(product.price)) { unknown.push(product); continue; }
    if ((minValue && product.price < minValue) || (maxValue && product.price > maxValue)) { filtered++; continue; }
    kept.push(product);
  }
  return { products: kept, filtered, unknown: unknown.length };
}

// Merges the pages of one keyword scan. The first occurrence wins so the
// highest-value ordering of the first page is preserved.
export function mergeProductPages(pages) {
  const merged = new Map();
  for (const list of pages) for (const product of list || []) if (!merged.has(product.id)) merged.set(product.id, product);
  return [...merged.values()];
}

// Removes repeated products from one flat list, keeping the first occurrence.
export function dedupeProducts(products) {
  const unique = new Map();
  for (const product of products || []) if (!unique.has(product.id)) unique.set(product.id, product);
  return [...unique.values()];
}

// Verifies that the portal honoured the requested order. Unknown values are
// skipped, and a page that mixes values only reports "unknown".
export function sortApplied(products, sort) {
  if (sort !== 'price_high' && sort !== 'price_low') return null;
  const values = products.map(p => p.price).filter(Number.isFinite);
  if (values.length < 2) return null;
  for (let index = 1; index < values.length; index++) {
    if (sort === 'price_high' && values[index] > values[index - 1]) return false;
    if (sort === 'price_low' && values[index] < values[index - 1]) return false;
  }
  return true;
}

// The queue walks the keywords in the order they were added, one at a time.
// A keyword that is marked priority (a manual "check now") is taken first, but
// the order of the rest of the list is never rearranged.
export function selectDueKeywords(keywords, activeIds, now, concurrency) {
  const due = keywords.filter(k => !activeIds.has(k.id) && k.nextDue <= now);
  const priority = due.filter(k => k.priority), rest = due.filter(k => !k.priority);
  return [...priority, ...rest].slice(0, Math.max(0, concurrency - activeIds.size));
}

// Markers that sometimes make the reviewer portal return more items than the
// plain keyword does. They are opt-in per keyword and never change the
// baseline keyword itself.
export const EXTRA_MARKERS = ['*', '&', '"'];
export function experimentalVariants(keyword) {
  const base = String(keyword || '').trim();
  if (!base) return [];
  return EXTRA_MARKERS.map(marker => base + marker);
}

// Reads the reviewer portal until the list stops changing. Returns the raw
// card data for one page. `isRunning` lets a caller stop mid-poll.
export async function extractPage(page, { isRunning = () => true, minWait = 5000, timeout = 35000, interval = 1000 } = {}) {
  let signature = '', stable = 0, last;
  const until = Date.now() + timeout;
  const start = Date.now();
  while (Date.now() < until) {
    if (!isRunning()) return null;
    last = await page.evaluate(readClaimableProducts);
    if (['verification', 'login'].includes(last.status)) return last;
    const next = JSON.stringify(last);
    stable = ['ok', 'empty'].includes(last.status) && next === signature ? stable + 1 : 0;
    signature = next;
    const atBottom = await page.evaluate(() => {
      window.scrollBy(0, Math.max(600, innerHeight * 0.85));
      return scrollY + innerHeight >= document.documentElement.scrollHeight - 20;
    });
    if (stable >= 3 && atBottom && Date.now() - start >= minWait) return last;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Could not read a stable list. Last good products kept. The page layout may need an adapter.');
}

// Walks the pages of one keyword. The tab is reused: when it already shows the
// wanted page it is refreshed in place, otherwise it navigates there.
export async function scanKeywordPages(page, {
  keyword = '', pages = 1, sort = 'price_high', base = BASE_URL,
  isRunning = () => true, onPage = () => {}, onNavigate = () => {},
  extract = extractPage, pauseBetweenPages = 1200
} = {}) {
  const portal = new URL(base);
  const merged = [];
  let excluded = 0, pagesRead = 0, note = '';
  for (let number = 1; number <= pages; number++) {
    if (!isRunning()) return { status: 'stopped', products: dedupeProducts(merged), pagesRead, excluded, note };
    const target = keywordUrl(keyword, { page: number, sort, base });
    const refreshed = page.url() === target;
    if (refreshed) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    else await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    onNavigate({ number, pages, refreshed, url: target });
    const result = await extract(page, { isRunning });
    if (!result) return { status: 'stopped', products: dedupeProducts(merged), pagesRead, excluded, note };
    if (['verification', 'login'].includes(result.status)) return { status: result.status, products: dedupeProducts(merged), pagesRead, excluded, note };
    const url = new URL(page.url());
    const matches = url.origin === portal.origin && url.pathname === portal.pathname
      && url.searchParams.get('page') === String(number) && url.searchParams.get('sort') === sort
      && (url.searchParams.get('queryNups') || '') === keyword;
    if (!matches) {
      if (number === 1) throw new Error('Page redirected away from the expected first-page search. Check the browser login.');
      note = `Page ${number} was not available (the portal sent the tab to another page). Scanning stopped there.`;
      break;
    }
    await page.evaluate(tagClaimAnchors).catch(() => {});
    if (result.status === 'empty' || !result.products.length) {
      if (number > 1) note = `Only ${number - 1} page(s) were available for this keyword.`;
      break;
    }
    merged.push(...result.products);
    excluded += result.excluded || 0;
    pagesRead = number;
    await onPage({ number, pages, products: dedupeProducts(merged) });
    if (number < pages) await new Promise(resolve => setTimeout(resolve, pauseBetweenPages + Math.floor(Math.random() * 400)));
  }
  return { status: 'ok', products: dedupeProducts(merged), pagesRead, excluded, note };
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

// Serialized into the page as well. Gives every eligible card a stable
// `rr-claim-<id>` anchor so a companion deep link can scroll to and highlight
// the item. It only sets attributes; it never clicks or claims anything.
export function tagClaimAnchors() {
  const text = node => (node?.innerText || node?.textContent || '').trim();
  const style = document.getElementById('product-pulse-claim-style') || (() => {
    const node = document.createElement('style');
    node.id = 'product-pulse-claim-style';
    node.textContent = '.product-pulse-claim-target{outline:3px solid #0071dc!important;outline-offset:-3px;box-shadow:0 0 0 6px #0071dc22!important;border-radius:6px;background:#0071dc0d!important}';
    document.documentElement.appendChild(node);
    return node;
  })();
  void style;
  let tagged = 0;
  for (const anchor of document.querySelectorAll('a[href*="/ip/"]')) {
    const card = anchor.closest('[data-item-id]') || anchor.closest('[data-test-id="gpt-main"]');
    if (!card) continue;
    const id = card.getAttribute('data-item-id') || anchor.getAttribute('link-identifier') || (() => {
      try { return new URL(anchor.getAttribute('href'), location.href).pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1]; } catch { return ''; }
    })();
    if (!id) continue;
    card.id = `rr-claim-${id}`;
    card.setAttribute('data-rr-claim', id);
    tagged++;
  }
  const hash = decodeURIComponent(location.hash || '').replace(/^#/, '');
  const wanted = hash.split('~')[0];
  for (const card of document.querySelectorAll('[data-rr-claim]')) {
    const match = `rr-claim-${card.getAttribute('data-rr-claim')}` === wanted;
    card.classList.toggle('product-pulse-claim-target', match);
    if (match) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return tagged;
}
