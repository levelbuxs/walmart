const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');

(async () => {
  console.log("Connecting to active Chrome browser...");

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
  } catch (err) {
    console.error("Failed to connect. Ensure Chrome is running with --remote-debugging-port=9222");
    process.exit(1);
  }

  const page = await browser.newPage();
  console.log("Navigating to Walmart Recognized Reviewer portal...");
  await page.goto('https://www.walmart.com/reviews/claim-product', { waitUntil: 'networkidle2' });

  // Execute extraction routine across all pages
  const allProducts = await page.evaluate(async () => {
    const products = [];
    const processedUrls = new Set();
    let pageNum = 1;

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    async function autoScroll() {
      let totalHeight = 0;
      const distance = 300;
      return new Promise((resolve) => {
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 2000);
          }
        }, 100);
      });
    }

    while (true) {
      await autoScroll();

      const itemLinks = Array.from(document.querySelectorAll('a[href*="/ip/"]'));

      itemLinks.forEach((link) => {
        const rawHref = link.getAttribute('href') || '';
        const fullUrl = rawHref.startsWith('http') ? rawHref : `https://www.walmart.com${rawHref.split('?')[0]}`;

        if (processedUrls.has(fullUrl)) return;

        let card = link;
        for (let i = 0; i < 5; i++) {
          if (card.parentElement && card.parentElement.innerText.includes('Valued at')) {
            card = card.parentElement;
            break;
          }
          if (card.parentElement) card = card.parentElement;
        }

        const cardText = card.innerText || "";
        const titleEl = card.querySelector('h2') || link;
        let title = (titleEl.innerText || link.getAttribute('aria-label') || "").trim();
        title = title.replace(/^In \d+\+ people's carts\s*/i, '').replace(/\s+/g, ' ');

        const valueMatch = cardText.match(/Valued at\s*\$([\d.]+)/i) || cardText.match(/\$([\d.]+)/);
        const value = valueMatch ? parseFloat(valueMatch[1]) : 0.00;

        const imgEl = card.querySelector('img');
        const image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || "") : "";

        let delivery = "Standard Delivery";
        if (/tomorrow/i.test(cardText)) {
          delivery = "Tomorrow";
        } else {
          const dateMatch = cardText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*[A-Z][a-z]+\s*\d+/i);
          if (dateMatch) delivery = dateMatch[0];
        }

        const ratingMatch = cardText.match(/([\d.]+)\s*out of 5 stars/i);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

        if (title && title !== "View item" && fullUrl) {
          processedUrls.add(fullUrl);
          products.push({
            id: btoa(fullUrl).slice(-12),
            title: title,
            value: value,
            image: image,
            url: fullUrl,
            delivery: delivery,
            rating: rating
          });
        }
      });

      // Pagination target
      const nextPageNum = pageNum + 1;
      const targetPageBtn = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === String(nextPageNum));
      const nextBtn = document.querySelector('button[aria-label="Next page"], a[aria-label="Next page"]');

      const btnToClick = targetPageBtn || nextBtn;

      if (btnToClick && !btnToClick.disabled) {
        pageNum++;
        btnToClick.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
        btnToClick.click();
        await sleep(4000);
      } else {
        break;
      }
    }

    return products;
  });

  console.log(`Successfully scraped ${allProducts.length} items.`);

  // Write dataset locally
  fs.writeFileSync('./products.json', JSON.stringify(allProducts, null, 2));
  console.log("Saved products.json locally.");

  await page.close();

  // Commit and push changes directly to GitHub Pages repository
  try {
    console.log("Pushing updated dataset to GitHub Pages...");
    execSync('git add products.json index.html');
    execSync('git commit -m "Auto-update products.json [Daily Cron]"');
    execSync('git push origin main');
    console.log("GitHub repository updated successfully! Live website refreshed.");
  } catch (error) {
    console.error("Git operations failed or no changes detected:", error.message);
  }

  process.exit(0);
})();