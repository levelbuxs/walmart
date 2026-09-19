/**
 * WALMART REVIEWER PORTAL SCRAPER (FIXED SYNTAX)
 * Engineered for Comet & Chromium browsers
 */
(async function runWalmartScraper() {
  'use strict';

  console.log("%c[Scraper] Starting DOM extraction...", "color: #0071dc; font-weight: bold; font-size: 14px;");

  const catalogDataset = [];
  const processedIds = new Set();
  let globalItemCounter = 1;
  let currentPage = 1;

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

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
          setTimeout(resolve, 1500);
        }
      }, 50);
    });
  }

  function findNextButton() {
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], a[aria-label]'));
    
    // 1. Next button by aria-label or text content
    let nextBtn = buttons.find(b => {
      const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
      return label.includes('next page') || label === 'next' || label.includes('navigate to next');
    });

    if (nextBtn) return nextBtn;

    // 2. Fallback to numeric page link for the next page index
    const nextPageStr = String(currentPage + 1);
    return buttons.find(b => b.textContent.trim() === nextPageStr);
  }

  while (true) {
    await scrollToBottom();

    // Query product cards based directly on the provided HTML structure
    const productCards = document.querySelectorAll('[data-test-id="gpt-main"], [data-item-id]');
    let pageAddedCount = 0;

    productCards.forEach((card) => {
      const itemId = card.getAttribute('data-item-id') || card.getAttribute('data-dca-guid');
      
      // Deduplicate using item ID or primary link
      const titleAnchor = card.querySelector('a[href*="/ip/"]');
      const href = titleAnchor ? titleAnchor.getAttribute('href') : '';
      const uniqueKey = itemId || href;

      if (!uniqueKey || processedIds.has(uniqueKey)) return;

      // Extract Title
      const titleEl = card.querySelector('[data-automation-id="product-title"]') || 
                      card.querySelector('h3') || 
                      titleAnchor;
      const title = titleEl ? titleEl.innerText.trim() : "";
      if (!title || title.toLowerCase() === "view item") return;

      // Extract Image
      const imgEl = card.querySelector('img[data-testid="productTileImage"]') || card.querySelector('img');
      const image = imgEl ? (imgEl.src || imgEl.getAttribute('srcset')?.split(' ')[0] || "") : "";

      // Extract Price / Valuation
      const cardText = card.innerText || "";
      const valMatch = cardText.match(/Valued at\s*\$([\d,]+\.?\d*)/i) || cardText.match(/\$([\d,]+\.?\d*)/);
      const value = valMatch ? parseFloat(valMatch[1].replace(/,/g, '')) : 0.0;
      const isFree = cardText.includes("Free") || value === 0.0;

      // Extract Rating
      const ratingEl = card.querySelector('[data-testid="product-ratings"], .wcp-rating_passiveRating__UAcJo');
      const ratingText = card.querySelector('.ld_Ec')?.innerText || ratingEl?.innerText || "";
      const ratingMatch = ratingText.match(/([\d.]+)\s*out of 5/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      // Extract Delivery Info
      const deliveryEl = card.querySelector('[data-testid="badgeTagComponent"]');
      const delivery = deliveryEl ? deliveryEl.innerText.replace(/\s+/g, ' ').trim() : "";

      // Extract URL
      const cleanUrl = href.startsWith('http') ? href.split('?')[0] : `https://www.walmart.com${href.split('?')[0]}`;

      processedIds.add(uniqueKey);
      catalogDataset.push({
        itemNumber: globalItemCounter++,
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
    });

    console.log(`[Page ${currentPage}] Scraped ${pageAddedCount} items. (Total: ${catalogDataset.length})`);

    // Pagination Logic
    const nextButton = findNextButton();
    if (nextButton && !nextButton.hasAttribute('disabled') && !nextButton.classList.contains('disabled')) {
      currentPage++;
      nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(500);
      nextButton.click();
      console.log(`[Navigation] Moving to page ${currentPage}... Waiting for hydration.`);
      await delay(3500);
    } else {
      console.log("%c[Scraper] Reached the end of pagination or no next button found.", "color: #10b981; font-weight: bold;");
      break;
    }
  }

  // Export File
  const outputData = {
    metadata: {
      scrapedAt: new Date().toISOString(),
      totalItems: catalogDataset.length
    },
    products: catalogDataset
  };

  const blob = new Blob([JSON.stringify(outputData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `products.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  console.log(`%c[Done] Saved ${catalogDataset.length} items to walmart_products.json`, "color: #10b981; font-weight: bold; font-size: 14px;");
})();
