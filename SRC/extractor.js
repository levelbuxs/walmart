// Self-contained: Chrome serializes this function into the signed-in page.
export async function extractProducts(selectors) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const money = text => {
    const m = String(text).match(/Valued at\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i) || String(text).match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return m ? Number(m[1].replaceAll(',', '')) : null;
  };
  const text = el => (el?.innerText || el?.textContent || '').trim();
  try {
    for (const s of Object.values(selectors)) if (s) document.querySelector(s);
  } catch { throw new Error('Invalid CSS selector. Edit this monitor’s selectors.'); }
  const pageText = text(document.body).slice(0, 12000);
  if (/verify you are human|unusual traffic|press and hold|access denied|robot or human/i.test(pageText)) {
    throw new Error('Verification or access restriction detected. Open the page and resolve it manually.');
  }
  let lastSignature = '', stable = 0, products = [];
  const start = Date.now();
  while (Date.now() - start < 22000) {
    const cards = [...document.querySelectorAll(selectors.card)];
    const found = new Map();
    for (const card of cards) {
      const link = card.querySelector(selectors.link);
      let url = '';
      try { url = new URL(link?.getAttribute('href') || '', location.href).href; } catch { /* skip invalid link */ }
      if (!link || !/^https?:/.test(url)) continue;
      const title = text(card.querySelector(selectors.title)) || link.getAttribute('aria-label') || text(link);
      if (!title || /^view item$/i.test(title)) continue;
      const productId = card.getAttribute('data-item-id') || new URL(url).pathname.match(/\/ip\/(?:.*\/)?(\d+)\/?$/)?.[1] || new URL(url).origin + new URL(url).pathname;
      const price = money(selectors.price ? text(card.querySelector(selectors.price)) : text(card));
      found.set(productId, { id: productId, title, url, price });
    }
    products = [...found.values()];
    const signature = JSON.stringify(products);
    stable = products.length && signature === lastSignature ? stable + 1 : 0;
    lastSignature = signature;
    // Reveal lazy-loaded cards on this page only; never click pagination.
    window.scrollTo(0, document.body.scrollHeight);
    if (stable >= 3 && Date.now() - start >= 5000) break;
    await sleep(1500);
  }
  window.scrollTo(0, 0);
  if (!products.length) throw new Error('No product cards found. Check login, page URL, and selectors. The previous snapshot was kept (empty pages are not treated as removals).');
  if (stable < 3) throw new Error('Product list did not settle. Keeping the previous snapshot to avoid false alerts.');
  return { products, pageTitle: document.title, scannedUrl: location.href };
}
