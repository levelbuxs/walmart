
/**
 * WALMART REVIEWER PORTAL SCRAPER — FULL CATEGORY RUN (v4)
 * Engineered for Comet & Chromium browsers
 *
 * Changes from v3:
 * - MAX_PAGES_PER_KEYWORD raised from 10 to 20 (some categories run deep)
 * - Logs a warning if a keyword hits the page cap, so truncation is visible
 * - Everything still merges into a single final products.json
 * - Resumable via localStorage, checkpoints every 20 keywords
 * - metadata.generatedAt matches SCRAPE.html's freshness check
 *
 * Keep this tab in the FOREGROUND for the whole run — background tabs get
 * throttled by Chromium and pagination/scroll timers will stall.
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
    "heavy duty"
  ];

  const SEARCH_INPUT_SELECTOR = '#inline-search-input';
  const SEARCH_BUTTON_SELECTOR = 'button[aria-label="Search"][type="submit"]';
  const BASE_WAIT_AFTER_SEARCH_MS = 4000;
  const BASE_WAIT_AFTER_PAGE_MS = 3000;
  const CHECKPOINT_EVERY = 20;
  const PROGRESS_KEY = 'walmartScraperProgress_v4';
  const MAX_PAGES_PER_KEYWORD = 20;   // raised from 10 → 20 per request
  // ------------------------------------------------------------------

  const jitter = (base) => base + Math.floor(Math.random() * 1200);
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  console.log("%c[Scraper] Starting FULL category run (page cap: 20)...", "color: #0071dc; font-weight: bold; font-size: 14px;");
  console.log(`%c[Scraper] Keep this tab focused for the whole run (~${SEARCH_TERMS.length} keywords).`, "color: #f59e0b; font-weight: bold;");

  let allProducts = [];
  let completedKeywords = [];
  let globalItemCounter = 1;
  const perKeywordCounts = {};
  const cappedKeywords = [];

  const saved = localStorage.getItem(PROGRESS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      allProducts = parsed.allProducts || [];
      completedKeywords = parsed.completedKeywords || [];
      globalItemCounter = parsed.globalItemCounter || 1;
      Object.assign(perKeywordCounts, parsed.perKeywordCounts || {});
      console.log(`%c[Scraper] Resuming — ${completedKeywords.length} completed keywords, ${allProducts.length} saved products.`, "color: #f59e0b; font-weight: bold;");
    } catch (e) {
      console.warn("[Scraper] Could not parse saved progress, starting fresh.");
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({
        allProducts, completedKeywords, globalItemCounter, perKeywordCounts
      }));
    } catch (e) {
      console.warn("[Scraper] localStorage save failed (likely quota). Continuing without checkpoint save.", e);
    }
  }

  function downloadCheckpoint(final = false) {
    const outputData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        searches: SEARCH_TERMS,
        completedKeywords: completedKeywords,
        perKeywordCounts: perKeywordCounts,
        cappedKeywords: cappedKeywords,
        totalItems: allProducts.length,
        isFinal: final
      },
      products: allProducts
    };
    const blob = new Blob([JSON.stringify(outputData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = final ? `products.json` : `products_checkpoint_${completedKeywords.length}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log(`%c[Scraper] Downloaded ${a.download} (${allProducts.length} items so far)`, "color: #10b981; font-weight: bold;");
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
    const input = document.querySelector(SEARCH_INPUT_SELECTOR);
    if (!input) {
      console.warn(`%c[Scraper] Search input not found for "${keyword}".`, "color: #ef4444; font-weight: bold;");
      return false;
    }
    input.focus();
    setNativeInputValue(input, '');
    await delay(150);
    setNativeInputValue(input, keyword);
    await delay(200);

    const form = input.closest('form');
    const searchButton = (form || document).querySelector(SEARCH_BUTTON_SELECTOR) || document.querySelector(SEARCH_BUTTON_SELECTOR);

    if (searchButton) {
      searchButton.click();
    } else if (form) {
      form.requestSubmit ? form.requestSubmit() : form.submit();
    } else {
      console.warn(`%c[Scraper] No search button/form found for "${keyword}".`, "color: #ef4444; font-weight: bold;");
      return false;
    }

    await delay(jitter(BASE_WAIT_AFTER_SEARCH_MS));
    return true;
  }

  async function scrapeForKeyword(keyword) {
    const processedIds = new Set();
    let currentPage = 1;
    let keywordCount = 0;
    let hitCap = false;

    const ok = await submitSearch(keyword);
    if (!ok) return 0;

    while (currentPage <= MAX_PAGES_PER_KEYWORD) {
      await scrollToBottom();

      const productCards = document.querySelectorAll('[data-test-id="gpt-main"], [data-item-id]');
      let pageAddedCount = 0;

      productCards.forEach((card) => {
        const itemId = card.getAttribute('data-item-id') || card.getAttribute('data-dca-guid');
        const titleAnchor = card.querySelector('a[href*="/ip/"]');
        const href = titleAnchor ? titleAnchor.getAttribute('href') : '';
        const uniqueKey = itemId || href;
        if (!uniqueKey || processedIds.has(uniqueKey)) return;

        const titleEl = card.querySelector('[data-automation-id="product-title"]') ||
                        card.querySelector('h3') ||
                        titleAnchor;
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
        allProducts.push({
          itemNumber: globalItemCounter++,
          searchKeyword: keyword,
          pageScraped: currentPage,
          itemId: itemId || null,
          title: title,
          value: value,
          isFree: isFree,
          deliveryInfo: delivery,
          rating: rating,
          image: image,
          url: cleanUrl,
          scrapedAt: new Date().toISOString()
        });

        pageAddedCount++;
        keywordCount++;
      });

      console.log(`[${keyword} | Page ${currentPage}/${MAX_PAGES_PER_KEYWORD}] +${pageAddedCount} items (keyword total: ${keywordCount})`);

      if (pageAddedCount === 0 && currentPage > 1) break;

      const nextButton = findNextButton(currentPage);
      if (nextButton && !nextButton.hasAttribute('disabled') && !nextButton.classList.contains('disabled')) {
        currentPage++;
        if (currentPage > MAX_PAGES_PER_KEYWORD) {
          hitCap = true;
          break;
        }
        nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(400);
        nextButton.click();
        await delay(jitter(BASE_WAIT_AFTER_PAGE_MS));
      } else {
        break;
      }
    }

    if (hitCap) {
      cappedKeywords.push(keyword);
      console.warn(`%c[Cap Hit] "${keyword}" stopped at page cap (${MAX_PAGES_PER_KEYWORD}) — likely has more results beyond this.`, "color: #f59e0b; font-weight: bold;");
    }

    return keywordCount;
  }

  for (const keyword of SEARCH_TERMS) {
    if (completedKeywords.includes(keyword)) {
      console.log(`%c[Skip] "${keyword}" already completed in a previous run.`, "color: #94a3b8;");
      continue;
    }

    try {
      const count = await scrapeForKeyword(keyword);
      perKeywordCounts[keyword] = count;
      completedKeywords.push(keyword);
      console.log(`%c[Done] "${keyword}": ${count} items. (${completedKeywords.length}/${SEARCH_TERMS.length} keywords, ${allProducts.length} total items)`, "color: #10b981; font-weight: bold;");
    } catch (err) {
      console.warn(`%c[Error] Keyword "${keyword}" failed: ${err.message}. Skipping.`, "color: #ef4444; font-weight: bold;");
    }

    saveProgress();

    if (completedKeywords.length % CHECKPOINT_EVERY === 0) {
      downloadCheckpoint(false);
    }

    await delay(jitter(800));
  }

  downloadCheckpoint(true);
  localStorage.removeItem(PROGRESS_KEY);

  if (cappedKeywords.length) {
    console.warn(`%c[Summary] ${cappedKeywords.length} keyword(s) hit the ${MAX_PAGES_PER_KEYWORD}-page cap and may be missing results: ${cappedKeywords.join(', ')}`, "color: #f59e0b; font-weight: bold;");
  }
  console.log(`%c[ALL DONE] ${allProducts.length} total items across ${completedKeywords.length} keywords. products.json downloaded.`, "color: #10b981; font-weight: bold; font-size: 16px;");
})();
