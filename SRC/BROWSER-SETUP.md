> **Historical console-script instructions.** The current requested app is the local browser companion.
> - **Windows, step by step:** [WINDOWS-SETUP.md](WINDOWS-SETUP.md)
> - **What the program does:** [README.md](README.md)
> - **Why no extension:** [ARCHITECTURE.md](ARCHITECTURE.md)
>
> This console approach is not recommended given the verification behavior you reported. It is kept only as a record of the earlier version.

# No-extension monitor — start here

This is the version requested for running **inside your own signed-in browser**, without installing any extension. The previous extension files are optional legacy code; they are **not needed** for this version.

## Your first link is already included

**chair — page 1, highest price first**

https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1

## Run it

1. Open Walmart in your normal browser and sign in. Use the link above to verify that your products are visible.
2. Open the downloaded `browser-monitor.js` file in a text editor and copy its entire contents.
3. In your **Walmart tab**, press **F12** or **Ctrl+Shift+J** to open Developer Tools, then choose **Console**. Review the code before running it. Only run code you trust; do not disable browser security settings or site protections.
4. Paste the script into the Console and run it. A Product Pulse panel appears over the Walmart page. Close DevTools if desired.
5. Click **Start monitoring** in the panel. If blocked, allow the popup for Walmart and click Start again.
6. Keep **both** the original controller tab and its separate monitoring window open. **Do not refresh the controller tab.** Only the monitoring window refreshes.

The separate monitoring window is necessary: refreshing the very tab running a console script would erase that script. The controller stays open and reads the refreshed window on the same Walmart origin, using your browser's signed-in account. No external server or extension is involved.

## What you get

- The complete list of **detected product cards on page one**, with prices/values and product links, sorted highest-first in the panel.
- A fresh first-page check every **5, 7, or 10 minutes**. Never visits page 2.
- Products that leave page one simply disappear from the current list. **No removal notification or removal activity entry.**
- **New product** alerts for additions, including similarly priced or lower-priced products.
- **URGENT new product** for a newly appearing item above the keyword's previously recorded all-time price high.
- First successful scan establishes a baseline and shows the full product list without alerting for every existing item.
- Unknown prices do not trigger urgent alerts. Price changes to an existing product are reflected in the list but do not create new-product alerts.
- Old successful lists are retained if the page is blocked, login expires, or no stable product cards can be read. These failures display an error rather than silently deleting your list.

Choose **Enable desktop alerts** if you want OS notifications. Permission is requested for Walmart's origin because the code runs on Walmart. OS Focus / Do Not Disturb mode and browser notification restrictions can hide alerts. New-product messages always appear in the panel too. **No Telegram integration is included in this no-extension version**: calling Telegram directly from Walmart may be prohibited by the site's content security policy. Do not put bot tokens in the site's console or local storage.

## More links

Pause, then add one keyword and URL per line:

```text
chair | https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1
```

Up to 30 links are accepted. They must use the same `https://www.walmart.com` origin and claim-product path with the keyword (`queryNups`) and highest-price sort (`sort=price_high`). The script forces `page=1`. Checks run sequentially through one monitoring window, so many links or slow loads can delay a cycle.

## Keep in mind

- I cannot directly access or control your local signed-in browser. You must run the script once yourself.
- A console script cannot survive reloading or closing its controller tab. Paste it again after doing either. Product snapshots, links, and all-time price highs are stored in Walmart-origin `localStorage` for the next run. Walmart scripts can access that storage; no tokens/passwords are stored.
- Keep the browser running and PC awake. The dashboard may be minimized, but background-tab throttling can delay checks. Alerts happen after a successful poll, not at the exact instant a product is added.
- Browser cross-origin isolation policies or site navigation may prevent access to the monitoring window. The script reports an error rather than bypassing those restrictions.
- Extraction uses the Walmart card selectors from this repository's existing scraper. It has been tested with local fixture pages, not your authenticated live page. Virtualized grids or different markup may need a selector adapter. The list represents detected first-page cards, not a guaranteed full catalog.
- Verification/CAPTCHAs must be resolved manually. Use only where permitted by the site's terms and rate limits.
- Click **Pause** to stop scheduling checks. To remove the panel entirely, run `window.__productPulseBrowser.stop()` in the controller console or refresh the controller page.
