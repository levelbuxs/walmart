/**
 * WALMART REVIEWER PORTAL SCRAPER — FULL CATEGORY RUN (v7, resume from checkpoint file)
 * Engineered for Comet & Chromium browsers — pure console-paste, no extensions.
 *
 * NEW in v7: on start, prompts you to pick a previously downloaded
 * products_checkpoint_N.json file. Its items get imported into IndexedDB
 * (grouped by searchKeyword) and those keywords are marked completed, so
 * the script skips re-scraping them and continues from where you left off.
 * If you don't want to resume, just click Cancel on the file picker and
 * it starts fresh.
 */
(async function runWalmartFullCategoryScraper() {
  'use strict';

  // ---- CONFIG ----------------------------------------------------------
  const SEARCH_TERMS = [
    "led","shoes","bed","bedding","cat","cat toys","toys","laser","usb","usb c","tv","phone","baby",
    "rc car","shirt","pants","lingerie","pillow","speakers","bluetooth","watch","2.4ghz","wifi","light",
    "electronics","laptop","xbox","basket","posters","tapestry","decor","curtains","blankets","nails",
    "clothes","cups","plates","computer","beauty","supplies","hygiene","accessories","massage","kitchen",
    "windows","boots","sneakers","hats","camera","keyboard","controller","mouse","cleaning","headphones",
    "earbuds","charger","power bank","tablet","smartwatch","fitness tracker","gaming chair","monitor",
    "webcam","microphone","router","extension cord","surge protector","hdmi cable","adapter","flashlight",
    "lantern","night light","string lights","projector","drone","action camera","tripod","vr headset",
    "game console","controller charger","remote control","smart plug","smart bulb","security camera",
    "doorbell camera","baby monitor","air fryer","blender","coffee maker","toaster","microwave",
    "slow cooker","instant pot","cutting board","knife set","cookware","bakeware","dinnerware",
    "food storage","water bottle","lunch box","thermos","vacuum","broom","mop","laundry basket",
    "storage bins","organizer","hangers","closet organizer","shower curtain","bath mat","towels",
    "bedsheets","comforter","mattress topper","throw blanket","area rug","wall art","mirror","clock",
    "candles","diffuser","air freshener","plant pot","artificial plants","furniture","desk","office chair",
    "bookshelf","storage cart","step stool","tool kit","screwdriver set","drill","tape measure",
    "flashlight batteries","extension ladder","garden hose","lawn mower","patio furniture","grill",
    "cooler","tent","sleeping bag","backpack","luggage","travel bag","umbrella","raincoat","jacket",
    "sweater","hoodie","socks","underwear","bra","swimsuit","sandals","slippers","sunglasses","jewelry",
    "wallet","belt","scarf","gloves","beanie","makeup","skincare","shampoo","conditioner","body wash",
    "perfume","cologne","hair dryer","hair straightener","electric razor","toothbrush","dental care",
    "vitamins","supplements","first aid kit","face mask","yoga mat","dumbbells","resistance bands",
    "exercise bike","treadmill","board games","puzzle","action figure","doll","building blocks","lego",
    "art supplies","coloring book","backpack for kids","car seat","stroller","diapers","baby formula",
    "pet bed","dog toys","dog leash","cat litter","fish tank","bird cage","phone case","screen protector",
    "laptop bag","gaming mouse pad","desk lamp","office supplies","printer","printer ink","label maker",
    "heavy duty","large appliance","ride on","bike","3 pro","4 pro"
  ];

  const SEARCH_INPUT_SELECTOR = '#inline-search-input';
  const SEARCH_BUTTON_SELECTOR = 'button[aria-label="Search"][type="submit"]';
  const BASE_WAIT_AFTER_SEARCH_MS = 4000;
  const BASE_WAIT_AFTER_PAGE_MS = 3000;
  const CHECKPOINT_EVERY = 10;
  const PROGRESS_KEY = 'walmartScraperProgress_v7';
  const DB_NAME = 'walmartScraperDB_v7';
  const STORE_NAME = 'keywordItems';
  const MAX_PAGES_PER_KEYWORD = 20;
  // ------------------------------------------------------------------

  const jitter = (base) => base + Math.floor(Math.random() * 1200);
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'keyword' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  let dbInstance = null;
  async function getDB() { if (!dbInstance) dbInstance = await openDB(); return dbInstance; }

  async function idbSaveKeyword(keyword, items) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ keyword, items });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAllKeywords() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const results = [];
      const cursorReq = tx.objectStore(STORE_NAME).openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { results.push(cursor.value); cursor.continue(); }
        else resolve(results);
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  // ---- Resume-from-file support ----
  function promptForCheckpointFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.position = 'fixed';
      input.style.top = '10px';
      input.style.left = '10px';
      input.style.zIndex = '999999';
      input.style.background = 'white';
      input.style.padding = '8px';

      const label = document.createElement('div');
      label.textContent = 'Pick a checkpoint JSON to resume from, or click elsewhere to skip (10s timeout)';
      label.style.position = 'fixed';
      label.style.top = '50px';
      label.style.left = '10px';
      label.style.zIndex = '999999';
      label.style.background = '#020617';
      label.style.color = '#38bdf8';
      label.style.padding = '6px 10px';
      label.style.fontFamily = 'monospace';
      label.style.fontSize = '12px';
      label.style.borderRadius = '6px';

      document.body.appendChild(input);
      document.body.appendChild(label);

      const cleanup = () => { input.remove(); label.remove(); };

      const timeout = setTimeout(() => { cleanup(); resolve(null); }, 10000);

      input.addEventListener('change', (e) => {
        clearTimeout(timeout);
        const file = e.target.files[0];
        cleanup();
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = (evt) => {
          try { resolve(JSON.parse(evt.target.result)); }
          catch (err) { console.warn('[Scraper] Could not parse selected file as JSON.', err); resolve(null); }
        };
        reader.readAsText(file);
      });
    });
  }

  async function importCheckpoint(checkpointData) {
    if (!checkpointData || !Array.isArray(checkpointData.products)) {
      console.warn('[Scraper] Checkpoint file missing a "products" array — skipping import.');
      return { imported: 0, keywords: [] };
    }

    const byKeyword = new Map();
    checkpointData.products.forEach((item) => {
      const kws = item.matchedKeywords && item.matchedKeywords.length ? item.matchedKeywords : [item.searchKeyword];
      kws.filter(Boolean).forEach((kw) => {
        if (!byKeyword.has(kw)) byKeyword.set(kw, []);
        byKeyword.get(kw).push(item);
      });
    });

    for (const [kw, items] of byKeyword.entries()) {
      await idbSaveKeyword(kw, items);
    }

    const importedKeywords = checkpointData.metadata && Array.isArray(checkpointData.metadata.completedKeywords)
      ? checkpointData.metadata.completedKeywords
      : Array.from(byKeyword.keys());

    console.log(`%c[Import] Loaded ${checkpointData.products.length} items across ${importedKeywords.length} keywords from checkpoint file.`, "color: #10b981; font-weight: bold;");
    return { imported: checkpointData.products.length, keywords: importedKeywords };
  }

  console.log("%c[Scraper] Starting FULL category run (v7, resumable from checkpoint file)...", "color: #0071dc; font-weight: bold; font-size: 14px;");

  let completedKeywords = [];
  let perKeywordCounts = {};
  let cappedKeywords = [];

  const savedProgress = localStorage.getItem(PROGRESS_KEY);
  if (savedProgress) {
    try {
      const parsed = JSON.parse(savedProgress);
      completedKeywords = parsed.completedKeywords || [];
      perKeywordCounts = parsed.perKeywordCounts || {};
      cappedKeywords = parsed.cappedKeywords || [];
      console.log(`%c[Scraper] Found existing v7 progress — ${completedKeywords.length} keywords already completed in this browser session.`, "color: #f59e0b; font-weight: bold;");
    } catch (e) { /* ignore */ }
  }

  console.log("%c[Scraper] File picker appearing top-left — select products_checkpoint_40.json to resume, or ignore it for 10s to start fresh.", "color: #f59e0b; font-weight: bold; font-size: 13px;");
  const checkpointData = await promptForCheckpointFile();
  if (checkpointData) {
    const { keywords } = await importCheckpoint(checkpointData);
    keywords.forEach((kw) => { if (!completedKeywords.includes(kw)) completedKeywords.push(kw); });
  } else {
    console.log("%c[Scraper] No checkpoint file selected — continuing without import.", "color: #94a3b8;");
  }

  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ completedKeywords, perKeywordCounts, cappedKeywords })); }
    catch (e) { console.warn("[Scraper] Progress list save failed (small metadata only).", e); }
  }
  saveProgress();

  function downloadBlob(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function isNoResultsPage() {
    return !!document.getElementById('search-item-stack-no-results-header') ||
           document.body.innerText.toLowerCase().includes('no search results for');
  }

  async function recoverFromNoResultsPage() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const startNewSearchBtn = buttons.find(b => (b.textContent || '').toLowerCase().includes('start a new search'));
    if (startNewSearchBtn) {
      startNewSearchBtn.click();
      console.log("%c[Scraper] Clicked 'Start a new search' to recover the search bar.", "color: #f59e0b; font-weight: bold;");
      await delay(2000);
      return true;
    }
    console.warn("%c[Scraper] Could not find 'Start a new search' button to recover.", "color: #ef4444; font-weight: bold;");
    return false;
  }

  async function scrollToBottom() {
    return new Promise((resolve) => {
      let totalOffset = 0;
      const step = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        totalOffset += step;
        if (totalOffset >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          setTimeout(resolve, 1200);
        }
      }, 50);
    });
  }

  function findNextButton(currentPage) {
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], a[aria-label]'));
    let nextBtn = buttons.find(b => {
      const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
      return label.includes('next page') || label === 'next' || label.includes('navigate to next');
    });
    if (nextBtn) return nextBtn;
    const nextPageStr = String(currentPage + 1);
    return buttons.find(b => b.textContent.trim() === nextPageStr);
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function submitSearch(keyword) {
    if (isNoResultsPage()) await recoverFromNoResultsPage();

    let input = document.querySelector(SEARCH_INPUT_SELECTOR);
    if (!input) {
      console.warn(`%c[Scraper] Search input still not found for "${keyword}" after recovery attempt.`, "color: #ef4444; font-weight: bold;");
      return false;
    }
    input.focus();
    setNativeInputValue(input, '');
    await delay(150);
    setNativeInputValue(input, keyword);
    await delay(200);

    const form = input.closest('form');
    const searchButton = (form || document).querySelector(SEARCH_BUTTON_SELECTOR) || document.querySelector(SEARCH_BUTTON_SELECTOR);

    if (searchButton) { searchButton.click(); }
    else if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); }
    else { console.warn(`%c[Scraper] No search button/form found for "${keyword}".`, "color: #ef4444; font-weight: bold;"); return false; }

    await delay(jitter(BASE_WAIT_AFTER_SEARCH_MS));
    return true;
  }

  function extractItemsFromPage(keyword, currentPage, processedIds, resultsArr) {
    const productCards = document.querySelectorAll('[data-test-id="gpt-main"], [data-item-id]');
    let added = 0;

    productCards.forEach((card) => {
      const itemId = card.getAttribute('data-item-id') || card.getAttribute('data-dca-guid');
      const titleAnchor = card.querySelector('a[href*="/ip/"]');
      const href = titleAnchor ? titleAnchor.getAttribute('href') : '';
      const uniqueKey = itemId || href;
      if (!uniqueKey || processedIds.has(uniqueKey)) return;

      const titleEl = card.querySelector('[data-automation-id="product-title"]') || card.querySelector('h3') || titleAnchor;
      const title = titleEl ? titleEl.innerText.trim() : "";
      if (!title || title.toLowerCase() === "view item") return;

      const imgEl = card.querySelector('img[data-testid="productTileImage"]') || card.querySelector('img');
      const image = imgEl ? (imgEl.src || imgEl.getAttribute('srcset')?.split(' ')[0] || "") : "";

      const cardText = card.innerText || "";
      const valMatch = cardText.match(/Valued at\s*\$([\d,]+\.?\d*)/i) || cardText.match(/\$([\d,]+\.?\d*)/);
      const value = valMatch ? parseFloat(valMatch[1].replace(/,/g, '')) : 0.0;
      const isFree = cardText.includes("Free") || value === 0.0;

      const ratingEl = card.querySelector('[data-testid="product-ratings"], .wcp-rating_passiveRating__UAcJo');
      const ratingText = card.querySelector('.ld_Ec')?.innerText || ratingEl?.innerText || "";
      const ratingMatch = ratingText.match(/([\d.]+)\s*out of 5/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      const deliveryEl = card.querySelector('[data-testid="badgeTagComponent"]');
      const delivery = deliveryEl ? deliveryEl.innerText.replace(/\s+/g, ' ').trim() : "";

      const cleanUrl = href.startsWith('http') ? href.split('?')[0] : `https://www.walmart.com${href.split('?')[0]}`;

      processedIds.add(uniqueKey);
      resultsArr.push({
        searchKeyword: keyword, pageScraped: currentPage, itemId: itemId || null,
        title, value, isFree, deliveryInfo: delivery, rating, image, url: cleanUrl,
        scrapedAt: new Date().toISOString()
      });
      added++;
    });

    return added;
  }

  async function scrapeForKeyword(keyword) {
    const ok = await submitSearch(keyword);
    if (!ok) return [];

    if (isNoResultsPage()) { console.log(`%c[${keyword}] No results.`, "color: #94a3b8;"); return []; }

    const processedIds = new Set();
    const keywordItems = [];
    let currentPage = 1;
    let hitCap = false;

    while (currentPage <= MAX_PAGES_PER_KEYWORD) {
      await scrollToBottom();
      const added = extractItemsFromPage(keyword, currentPage, processedIds, keywordItems);
      console.log(`[${keyword} | Page ${currentPage}/${MAX_PAGES_PER_KEYWORD}] +${added} items (keyword total: ${keywordItems.length})`);

      if (added === 0 && currentPage > 1) break;

      const nextButton = findNextButton(currentPage);
      if (!nextButton || nextButton.hasAttribute('disabled') || nextButton.classList.contains('disabled')) break;

      currentPage++;
      if (currentPage > MAX_PAGES_PER_KEYWORD) { hitCap = true; break; }

      nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(400);
      nextButton.click();
      await delay(jitter(BASE_WAIT_AFTER_PAGE_MS));

      if (isNoResultsPage()) {
        console.warn(`%c[${keyword}] Hit a broken/no-results page mid-pagination at page ${currentPage}. Stopping here, keeping ${keywordItems.length} items.`, "color: #f59e0b; font-weight: bold;");
        await recoverFromNoResultsPage();
        break;
      }
    }

    if (hitCap) cappedKeywords.push(keyword);
    return keywordItems;
  }

  for (const keyword of SEARCH_TERMS) {
    if (completedKeywords.includes(keyword)) {
      console.log(`%c[Skip] "${keyword}" already completed (from import or this session).`, "color: #94a3b8;");
      continue;
    }

    try {
      const items = await scrapeForKeyword(keyword);
      perKeywordCounts[keyword] = items.length;
      completedKeywords.push(keyword);
      await idbSaveKeyword(keyword, items);
      console.log(`%c[Done] "${keyword}": ${items.length} items saved to IndexedDB. (${completedKeywords.length}/${SEARCH_TERMS.length})`, "color: #10b981; font-weight: bold;");
    } catch (err) {
      console.warn(`%c[Error] Keyword "${keyword}" failed: ${err.message}. Attempting recovery and skipping.`, "color: #ef4444; font-weight: bold;");
      if (isNoResultsPage()) await recoverFromNoResultsPage();
    }

    saveProgress();

    if (completedKeywords.length % CHECKPOINT_EVERY === 0) {
      const partial = await mergeAndDedup();
      downloadBlob(`products_checkpoint_${completedKeywords.length}.json`, partial);
      console.log(`%c[Checkpoint] Downloaded products_checkpoint_${completedKeywords.length}.json (${partial.products.length} unique items so far)`, "color: #10b981; font-weight: bold;");
    }

    await delay(jitter(800));
  }

  async function mergeAndDedup() {
    const allKeywordRecords = await idbGetAllKeywords();
    const merged = new Map();

    allKeywordRecords.forEach(({ keyword, items }) => {
      items.forEach((item) => {
        const key = item.itemId || item.url;
        if (!key) return;
        if (merged.has(key)) {
          const existing = merged.get(key);
          if (!existing.matchedKeywords) existing.matchedKeywords = [item.searchKeyword];
          if (!existing.matchedKeywords.includes(item.searchKeyword || keyword)) existing.matchedKeywords.push(item.searchKeyword || keyword);
        } else {
          merged.set(key, { ...item, matchedKeywords: item.matchedKeywords || [item.searchKeyword || keyword] });
        }
      });
    });

    const finalProducts = Array.from(merged.values()).map((p, i) => ({ itemNumber: i + 1, ...p }));

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        searches: SEARCH_TERMS,
        completedKeywords: completedKeywords,
        cappedKeywords: cappedKeywords,
        totalItems: finalProducts.length
      },
      products: finalProducts
    };
  }

  const finalOutput = await mergeAndDedup();
  downloadBlob('products.json', finalOutput);
  localStorage.removeItem(PROGRESS_KEY);

  if (cappedKeywords.length) {
    console.warn(`%c[Summary] ${cappedKeywords.length} keyword(s) hit the ${MAX_PAGES_PER_KEYWORD}-page cap: ${cappedKeywords.join(', ')}`, "color: #f59e0b; font-weight: bold;");
  }
  console.log(`%c[ALL DONE] ${finalOutput.products.length} unique items after dedup, across ${completedKeywords.length} keywords. products.json downloaded.`, "color: #10b981; font-weight: bold; font-size: 16px;");
})();
