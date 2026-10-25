# How the reference site works, what we changed, and whether we need an extension

This is the working note behind the current code. It answers three questions:

1. What does the site you showed me actually do?
2. Where was our program different from it, and what did we change?
3. Do we need a Chrome extension, or can this run without one?

---

## 1. What the reference site (RR Wheel / Marketplace Wheel) does

The saved page is a server-rendered Next.js app with these routes: `/discovery`,
`/taxes`, `/sellers`, `/purchases`, `/audit`, `/import`, `/plan`, `/help`, plus a
`/ledger`. It is a hosted, multi-user service — you sign in with an email
address, it keeps a "Live database", and it shows your own purchases, tax
numbers, sellers and audit exports.

The `/discovery` page is the part that matters here. Its own copy describes the
design:

> "Pick a saved profile or type as many keywords as you like. **The RR Wheel
> extension searches Walmart with your own sign-in and items appear here as they
> are found.**"
>
> "RR Wheel extension connected (v2.2.18)."

The page has: a keyword box (`Keywords separated by commas: blender, headphones,
vacuum`), a **Pages per search** selector (`1 / 2 / 3 / 5`), a **Search
Walmart** button, saved profiles (`all`, `Furniture`, `games`, `New profile`), a
live progress bar (`Finished — 321 item(s) found. · 321 item(s)`), sorting
(`Highest value` / `Newest`), and a product grid where each card carries the
title, the dollar value, the keyword it came from, a **Claim on Walmart** link
and a **View Item** link.

Two details in the markup explain the whole design:

* The **Claim on Walmart** link is not a plain link. It points at the reviewer
  portal with a fragment:
  `https://www.walmart.com/reviews/claim-product?q=&queryNups=car&page=1#rr-claim-20482510479~OTTOCAST%20Mini%20Nova%202…`
  That `rr-claim-<id>` marker is something **the extension writes into the
  Walmart page**, so the link can scroll to and highlight the exact card. The
  site says so: *"With the RR Wheel extension on, 'Claim on Walmart' scrolls to
  and highlights the item on Walmart's RR page — you still click Walmart's own
  Claim button."*
* The keyword list is the **reviewer portal**, not the retail search bar:
  `/reviews/claim-product` with `queryNups`, `page` and `sort`. 321 items for
  five keywords means it reads several pages per keyword.

### Why the reference needs an extension

The work happens in **your** browser because that is where your Walmart session
is. A hosted server cannot open a tab in your signed-in Chrome, cannot read your
cookies, and cannot ask Walmart anything on your behalf. So the only way for a
remote dashboard to search Walmart *as you* is to run code inside your browser:
a Chrome extension. That is the entire reason the extension exists — it is not
about scraping power, it is about **having your session**.

---

## 2. What Product Pulse does, and why it needs no extension

Product Pulse is not hosted. It is a small Node program that runs **on your
own computer** and drives a real Chrome through Playwright. Because the program
and the browser are both on your machine, the program can use the browser's
session directly — there is nothing to bridge, so there is nothing to install.

Three ways to get a signed-in session, all extension-free:

| Mode | What happens | Where you sign in | Extension |
| --- | --- | --- | --- |
| **Dedicated window** (default) | Product Pulse starts its own Chrome with its own profile folder | once, in that window | none |
| **Attach to your Chrome** | it drives the Chrome you already run, over a local debugging port | already signed in | none |
| **Console paste** (historical, `browser-monitor.js`) | a script you paste into a Walmart tab | already signed in | none |

The second one is the closest match to what the reference does with its
extension, and it is now built in:

```sh
# start Chrome with a debugging port and a throwaway profile folder
chrome --remote-debugging-port=9222 --user-data-dir=%TEMP%\pulse-chrome
npm start          # then click "Attach to my Chrome" in the dashboard
```

`/api/attach` connects with `chromium.connectOverCDP`. The dashboard shows
`Your Chrome attached`. The companion **disconnects** on shutdown and never
closes a browser it did not start.

---

## 3. Where we were behind the reference, and what changed

| # | The reference | Product Pulse before | Now |
| --- | --- | --- | --- |
| 1 | Reads several pages per keyword (`Pages per search` 1–5); 321 items for 5 keywords | Hard-coded to page 1, and a redirect away from page 1 was treated as a failure | **Pages per search** (1–5) in Preferences. Each page is read, merged and de-duplicated; the list stops early when a page has nothing |
| 2 | Opens a page, reads it, closes it | Opened a **new tab for every scan** and closed it | The tab is **kept and refreshed in place** (`page.reload()`), so the session stays warm and the browser shows the last page it read. Tab pool is bounded by the concurrency setting |
| 3 | Sort order is chosen | `sort=price_high` was hard-coded and any other sort was rejected | **Sort on the reviewer portal** (`price_high` / `price_low`). After reading, the values are checked against the requested order, and the dashboard says so if Walmart ignored it |
| 4 | — | No filters | **Minimum / maximum value**. Products outside the range are hidden and counted; products with an unknown value are counted separately instead of being guessed |
| 5 | Items "appear here as they are found" | The list only updated after a whole keyword finished | Every page is published as it is read. The sidebar shows `p2/3 · 118 found` while a scan runs |
| 6 | "Claim on Walmart" scrolls to and highlights the item | Only "View on Walmart" (the product page) | **Claim on Walmart** opens the reviewer portal in your browser, scrolls to that card and highlights it. You still click Walmart's own Claim button. The page also carries `rr-claim-<id>` anchors, so the link works as a deep link |
| 7 | Saved profiles (`all`, `Furniture`, `games`) | — | **Saved profiles**: name a keyword list, switch between watchlists in one click |
| 8 | — | — | **Value range + scope are honest**: unknown values, excluded cards, and pages that do not exist are all reported instead of being silently dropped |

### The second round: the working rhythm you asked for

* **First page by default.** `pages` defaults to `1`. Deeper pages are there when you want them, never in the way.
* **One keyword at a time, in the order you entered them.** `selectDueKeywords` walks the list in order instead of sorting by due time, so the program behaves like a list you can follow. A keyword that is overdue shows a **red ✕** and a **negative timer** (`-2m 13s`) until the loop reaches it; a keyword that has been read shows a **green ✓** and a countdown.
* **Extra items (experimental).** A per-keyword **⚗** switch makes the program search `keyword&` and `keyword8` as well, and keep whatever those searches reveal that the plain keyword did not show. The markers are **editable** (`Preferences → Extra-item markers`, one to three characters each, up to six), so `*` or `"` can be added back. Extra first-page requests per keyword per cycle — opt-in, per keyword.
* **Change things while it runs.** The **Watchlist** view is the control box: the keyword list, the active filters, and a start/pause button. Keywords, filters, interval, pages per search, sort, value range, markers and concurrency can all be changed mid-run; the change is used from the next pass, and no baseline is lost. (Previously every edit had to wait for a pause.)
* **Notifications with the product title and value.** `node-notifier` (an optional dependency) raises a **Windows toast** from the companion — so it arrives with the dashboard closed. Telegram is the second channel. Both carry the product title and its value. If the system notifier is missing, the failure is reported in Activity rather than swallowed.
* **A "check now" that is not swallowed.** A scan that was already running used to push the timer back over a request made during it. Each keyword now carries a token, and a request made mid-scan is honoured by the following pass.

### The third round: Windows-first delivery, browser choice, a calmer UI

The program had to become something a non-technical Windows user can install without a manual. Three things changed:

* **One-click installation.** `setup.bat` / `setup.ps1` check for Node.js, install the current LTS with `winget` if it is missing, run `npm ci`, find Chrome / Edge / Brave, ask which one to use, write the choice down, and put a desktop shortcut in place. `start.bat` starts the companion and opens the dashboard; `ProductPulse.bat` installs anything missing and then starts. `start.ps1` is a menu (start, install/repair, choose browser, open dashboard, attach to a Chrome you already started, find the data, reset). The full tutorial with every command to copy and paste is **[WINDOWS-SETUP.md](WINDOWS-SETUP.md)**.
* **The browser is a choice, not an assumption.** `browser-choice.js` holds a small catalog of the browsers the companion can drive, looks for each one in the usual Windows, macOS and Linux places, and turns the stored choice into Playwright launch options. The choice lives in `.local/product-pulse/browser.json` and can be set by the setup script, by the dashboard (**Browser setup → Which browser?**), or by `PULSE_BROWSER` / `PULSE_BROWSER_PATH`. Chrome is the default; Edge, Brave and the bundled Chromium are one click away.
* **A quieter interface.** Softer surfaces, cards that lift on hover, a calmer sidebar, and a three-step getting-started panel instead of a blank page. The **Browser setup** view gained the browser picker, and **Preferences** gained the extra-marker field.

Two Windows-specific details that are easy to get wrong and are covered by tests:

* Windows PowerShell writes UTF-8 **with a byte order mark**, and `JSON.parse` refuses such a file. `browser.json` is therefore written without a BOM, and the reader strips one if it finds it — otherwise the saved browser choice would be silently ignored on exactly the platform that needs it.
* The `.bat` and `.ps1` files are stored with **CRLF** line endings (`.gitattributes`), so a ZIP downloaded from GitHub behaves when it is double-clicked.

### Files that carry the change

| File | What it does now |
| --- | --- |
| `monitor-core.js` | `keywordUrl` (page + sort + base), `extractPage`, `scanKeywordPages` (walk, refresh in place, merge, stop early), `applyValueRange`, `sortApplied`, `tagClaimAnchors`, `claimUrl`, `experimentalVariants`, in-order `selectDueKeywords` |
| `server.js` | Tab pool with refresh-in-place, live progress, per-keyword experimental flag, keyword tokens, profiles API, `/api/claim` jump, `/api/attach` CDP mode, `/api/notify-test`, system toasts, `PULSE_PORTAL_URL` / `PULSE_BROWSER_PATH` / `PULSE_HEADLESS` overrides |
| `app.html` / `app.js` / `app.css` | Watchlist view (ordered keywords, live filters, add/remove), status icons and negative timers, experimental toggle, scope + filter controls, Claim-on-Walmart button, saved profiles, attach button, notification settings |
| `tests/scope.test.js` | Unit tests for the new scope, filters, merge, order check and claim links |
| `tests/companion.test.js` | In-order queue, priority check, experimental markers |
| `tests/scan-pages.test.js` | Browser test: page walk, refresh-in-place, merge, anchors, verification |
| `tests/server-scan.test.js` | End-to-end: real companion against a local portal fixture — pages merged, live progress cleared, re-check refreshes, claim jump, live filter edits, experimental extra items |
| `browser-choice.js` | The browser catalog, detection on Windows/macOS/Linux, and the stored choice → launch options |
| `setup.ps1` / `setup.bat` / `start.ps1` / `start.bat` / `ProductPulse.bat` | The Windows install, launch and menu scripts |
| `tests/phase3.test.js` | Marker parsing and defaults, variant building, browser catalog, detection and choice resolution |
| `tests/browser-choice-file.test.js` | A browser choice written with a byte order mark is still read |

---

## 4. The extension question, answered

**Do we need one? No — not for the app as it is built.**

The extension in the reference exists to give a *hosted* server access to a
browser session it cannot reach. Our companion runs on the same machine as the
browser, so it can drive Chrome directly:

* `browser()` in `server.js` launches a persistent Chrome profile, or
* `/api/attach` connects to the Chrome you already run over CDP.

Both are ordinary browser automation: no stealth settings, no CAPTCHA solving,
no cookie extraction, no protection bypass. Walmart may still detect it, and
the queue pauses and asks you to resolve a check by hand.

**When would we add one anyway?** Only if we wanted the reference's shape: a
hosted dashboard that any number of people sign into, each with their own
session. Then the extension would be the worker:

1. A Manifest V3 service worker that owns the "search these keywords" queue.
2. A content script (or `chrome.scripting` call) on
   `walmart.com/reviews/claim-product` that reads the cards and posts them to
   our server.
3. A pairing step: the dashboard shows a short code, the extension enters it,
   and both sides keep a token for the connection.
4. The same `readClaimableProducts()` / `tagClaimAnchors()` functions we already
   have, reused verbatim — they are plain functions that run in the page.

The legacy files in this folder (`manifest.json`, `background.js`,
`dashboard.html`, `extractor.js`, `core.js`) are that shape from an earlier
round and are **not** used by the current companion. If we ever go hosted, they
are the starting point, not a rewrite.

**What we did not do on purpose:** we did not add the extension back, we did
not add a "search Walmart with your own sign-in" button that reaches out to a
hosted service, and we did not add any capability to bypass Walmart's checks.

---

## 5. Known limits (unchanged, still true)

* Only `/reviews/claim-product` is read — never the retail search bar.
* Eligibility is what the page shows: cards with an enabled *View item* /
  *Claim* action. Out of stock, *Shop similar* and sold-out cards are excluded.
* Nothing is ever claimed automatically. A *Claim* button on the card does not
  guarantee the claim will still work later.
* Extraction is tested against fixtures, not your live account. A layout change
  on Walmart's side can still require a selector update.
* The value range is applied by us after reading; it is not a filter the portal
  itself applies.
* Alerts happen after a check, not at the instant a product is added.
