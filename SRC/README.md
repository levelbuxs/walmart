# Product Pulse — local browser companion (current version)

**No extension. No DevTools console script.** A dashboard running on your PC drives a real Chrome, reads the Walmart reviewer portal with your own sign-in, and stores the current products locally.

The hosted preview is a **setup/interface preview only**. It cannot access your computer's signed-in browser or perform live monitoring. Product lists start empty; no fabricated live products are displayed.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how the reference site works, what we changed to match it, and why no Chrome extension is needed.

## Run on your PC

Requirements: **Node.js 22+**, Google Chrome, and a desktop session capable of displaying browser windows.

1. Download/extract the source and open a terminal in `SRC`.
2. Run:

   ```sh
   npm ci
   npm start
   ```

3. Open **http://localhost:8080**.
4. Click **Open browser**. Sign in to Walmart in the visible browser window and confirm you can access the reviewer claim-product portal.
5. Enter your keywords, set the filters in the **Watchlist** view, then click **Start monitoring**.

`npm ci` also installs `node-notifier` as an **optional** dependency. It is what raises the Windows toast; if it fails to install, everything else still works and the notification failure is reported in Activity.

### Which browser/account does this use?

Two modes, both extension-free:

* **Dedicated window** (default). The companion launches a **dedicated persistent Chrome profile** in `SRC/.local/product-pulse/browser-profile`. Sign in once in that window. It does **not** attach to, copy cookies from, or control the Chrome profile you normally have open.
* **Attach to your Chrome.** If you would rather use the browser you already sign in to, start Chrome with a debugging port and a throwaway profile folder, then click **Attach to my Chrome**:

  ```sh
  # Windows
  chrome --remote-debugging-port=9222 --user-data-dir=%TEMP%\pulse-chrome
  # macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$TMPDIR/pulse-chrome"
  # Linux
  google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/pulse-chrome
  ```

  The companion connects over `http://127.0.0.1:9222`, drives that window, and **disconnects** when it stops — it never closes a browser it did not start. The debugging port is local-only; use a separate profile folder for it.

Do not open the dedicated profile simultaneously from another Chrome instance. No passwords are entered in the app. The browser profile contains authentication data: keep it private and never commit, upload, or share `.local`.

If Chrome is not installed, either install it, or use Playwright's browser:

```sh
npx playwright install chromium
```

Then set `PULSE_BROWSER=chromium` in your environment before `npm start` (PowerShell: `$env:PULSE_BROWSER="chromium"`; macOS/Linux: `PULSE_BROWSER=chromium npm start`). `PULSE_BROWSER=msedge` can select installed Edge, and `PULSE_BROWSER_PATH=/path/to/chrome` points at a specific binary. Linux may need browser system libraries and an actual graphical desktop. This is not meant to run headlessly on your PC.

## Exact pages used

The app uses **only the reviewer claim-product URLs**, never Walmart's retail search bar:

- All products, highest first: `https://www.walmart.com/reviews/claim-product?sort=price_high&page=1`
- Keyword: `https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1`
- Multiword example: `https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=power+bank&page=1`

**Pages per search** (Preferences, 1–5) decides how many pages of the portal are read for each keyword. The walk stops early when a page has no eligible cards, and the dashboard says how many pages were actually read. **Sort on the reviewer portal** chooses `price_high` or `price_low`; after reading, the values are checked against the requested order and the dashboard reports it if Walmart did not apply it. A redirected page must still match the expected origin, path, sort, keyword, and page before its products are accepted.

`PULSE_PORTAL_URL` can point the companion at a different reviewer portal (a mirror or a test server). It defaults to Walmart's own.

The prefilled list uses the screenshot keywords: chair, sofa, recliner, furniture, bed frame, Storage, outdoor, Gazebo, car, gaming, bike, ebike, Appliance, battery, ride on, scooter, camera, led, wireless, Electronics; plus **power bank**. The unfiltered all-products monitor is enabled initially and can be unchecked. The truncated screenshot entry “car - Walma…” was interpreted as `car`.

## Lists and products

- Edit keywords one per line, then **Save keyword list**. Saved lists and snapshots survive restarts. The list can also be edited while the program is running.
- **Save the current list as a profile** (for example *Furniture*), then apply or delete profiles in one click. Profiles are stored on this computer.
- The **Watchlist** view shows every keyword in order with its status, timer and the filters that are active, and lets you add, remove or re-filter while the program runs.
- Import/export a `.json` list or import plain text. Exports contain only keywords and the unfiltered-page preference, never browser credentials or Telegram tokens.
- Up to 100 keywords plus the unfiltered monitor. Blank/duplicate keywords are removed.
- Click a keyword in the sidebar to see that snapshot, last check, recorded high, pages read, exclusions, and any note from the last scan. The aggregate view deduplicates overlapping product IDs across keywords.
- Product cards show image, name, stated **Valued at $…** amount, the keyword it came from, and two links: **Claim on Walmart** and **View item**.
- **Claim on Walmart** opens the reviewer portal in your browser, scrolls to that exact card and highlights it. You still click Walmart's own Claim button. Nothing is claimed automatically.
- `Free` is not treated as a zero-dollar product value. Missing values remain unknown.
- High-to-low is the default display order; use the value/name controls or local product-name filter.
- Only cards with an enabled **View item / Claim / Claim item / Claim product** action are included. Out of stock, Shop similar, sold out, unavailable, and disabled-action cards are excluded.
- **View item is the entry button in the supplied screenshots.** The app does not click it or claim anything. Button presence is not a guarantee that a later claim will succeed.
- Image hotlinking may be restricted or expire. The card keeps its text/value even if its image cannot be displayed.

## Filters

Preferences has a **Search scope and filters** block:

- **Pages per search** (1–5): how many pages of the reviewer portal are read for each keyword. **The default is 1 — the first page only.** More pages means more requests to Walmart; use one unless you need more.
- **Sort on the reviewer portal**: `price_high` or `price_low`. Every keyword uses the same high-to-low link by default, so the list is always ordered by value, highest first. After a page is read, the values are checked against the order that was requested; if Walmart ignored the sort, the keyword shows a note instead of quietly showing a different order.
- **Minimum / maximum value**: a range applied by Product Pulse to what it shows. Products outside the range are hidden and counted. Products whose value is unknown are counted separately — they are never assumed to be inside the range.

Filters never change what the portal itself returns; they only shape this dashboard. They can be changed while the program is running.

## Experimental: finding extra items for a keyword

Some keywords return more products when a character is added to the end of the search term. The **⚗** button next to a keyword (or the *Extra items* list in the keyword editor) turns this on for that keyword only.

When it is on, after the normal search the program searches the same keyword again as:

* `keyword*`
* `keyword&`
* `keyword"`

and keeps every product those searches reveal that the plain keyword did not show. The extra products are merged into the list, counted in the keyword note (*"Extra-item search added 3 item(s) that the plain keyword did not show"*), and are announced like any other new product. The markers are added to the keyword — the keyword itself is never changed, and the extra searches only read the first page.

This is experimental: it is three extra requests per keyword per cycle, and whether it helps depends on the keyword.

## Notifications

New products are announced with the **product title and its value**:

```
New product · chair
Massage Chair Cushion Pad
Value: $1,299.95
https://www.walmart.com/ip/...
```

Two channels, both raised by the companion so they arrive even when the dashboard tab is closed:

* **System notification** — a Windows toast (or the equivalent on macOS/Linux). `node-notifier` is an optional dependency; if it is missing, the failure is reported in Activity instead of being hidden. Turn it on or off in Preferences.
* **Telegram** — to your phone, using your own bot. See the setup steps below.

If the system notification is switched off, the dashboard falls back to a browser notification, which needs this tab open and permission.

Removals are never announced.

## Schedule and queue

Preferences offer **1 minute, 5 minutes (default), 15 minutes, and custom 1–1,440 minutes**.

**The queue walks your keywords in the order you entered them, one at a time.** Keyword 1 is read, then keyword 2, and so on; when the list is finished it starts again. The order is never rearranged.

Every successfully completed keyword scan sets that keyword's own next due time. A failed ordinary scan retains its last good snapshot and schedules a later attempt. The scanner **keeps one tab open per worker and refreshes it in place** on every cycle, waits for a stable list while scrolling, reads the pages configured in **Pages per search**, saves the snapshot, and keeps the tab for the next cycle. Each page is published to the dashboard as it is read, so items show up while the scan is still running (the sidebar shows `p2/3 · 118 found`). A short notification-delivery step can keep that worker slot busy a little longer.

Next to every keyword you see:

* a **green ✓** once it has been read successfully,
* a **red ✕** when it is overdue or failed,
* a **countdown timer** to its next check (`4m 58s`),
* a **negative timer** (`-2m 13s`, in red) when the loop did not come back to it in time.

**One keyword at a time** is the default. Optional two- and three-at-a-time modes are labeled **not recommended** and **at your own risk**; they increase site load. If scans take longer than the interval, the timer goes negative until the queue reaches that keyword.

Pause stops further scheduling. Active page operations may take up to their timeout to finish before the pool of tabs is closed. Restarting the app never automatically resumes monitoring.

## Changing things while it runs

The **Watchlist** view is the control box: every keyword in order, the filters that are active, and a start/pause button.

* **Keywords, filters, pages per search, sort, value range, interval and concurrency can all be changed while the program is running.** Nothing has to be stopped and no baseline is lost — the change is used from the next pass of each keyword onward.
* Adding or removing a keyword takes effect the next time the queue reaches that point.
* **Check now** on a keyword asks for a fresh pass. If that keyword is being scanned at that moment, the request is kept and a new pass follows instead of being swallowed.
* The **⚗** button on a keyword turns the experimental extra-item search on or off for that keyword.

## Alerts — no removals

| Situation | Behavior |
| --- | --- |
| First successful scan for a keyword | Save a silent baseline and show its products |
| New product, value equal to/below previous high | **New product** with name/value |
| New product above that keyword's previous all-time recorded high | **URGENT new product** with name/value |
| Product disappears, becomes out of stock, or loses its action | Remove it from the current list **silently** |
| Product order changes or same products remain | No alert |
| Existing product changes value | Update its saved value/high; no new-product alert |
| Unknown value | Show Unknown; never manufacture an urgent alert |
| Failed/unrecognized/unstable extraction | Keep the last good list and show an error |

The high is retained even when a high-value product leaves the page. All newly seen IDs in one scan compare to the same prior high. Activity records additions only, grouped per keyword and urgency. An item that leaves and later returns can be treated as a new arrival. The same product can alert under multiple keywords, since baselines are per keyword. Activity is capped at 150 events, about 2 MB, with details for up to 100 products per event.

System notifications are raised by the companion, so they do not need the dashboard to be open; the dashboard's own browser notification is only used when system notifications are switched off. Existing historical events are not re-notified on load. OS focus/do-not-disturb settings can hide alerts. Polling the local companion every two seconds adds a small delay to what you see on screen — the system notification and Telegram are sent by the companion itself, so they are not affected.

### Telegram on Android (optional)

1. Create a bot with **@BotFather**. Open your bot and send **/start**.
2. Find your private chat ID (for example, with **@userinfobot**). Groups require their actual group chat ID and bot membership.
3. In Preferences, enable Telegram, enter the bot token and chat ID, and Save.
4. Send a test message and confirm receipt on Android. Allow Telegram notifications on the phone.

The Node companion, not the Walmart page, contacts Telegram, so this does not require relaxing Walmart's content-security policy. The token is saved on your PC in `.local/product-pulse/state.json` with restrictive file permissions where supported. It is not encrypted; protect the computer/profile. The token is **never returned by the state API**, nor included in list exports. Leaving the token field blank keeps the saved token. Do not paste real tokens into chat or source code. Telegram receives product names, values, and links (links can include site parameters). Delivery failures appear in Activity and are not automatically retried.

## Verification, login, and limits

**No stealth settings, CAPTCHA solving, DevTools protection bypass, cookie extraction, or access-control evasion is implemented.** Playwright is ordinary browser automation; Walmart may detect or disallow it. This approach avoids manually opening DevTools but does not guarantee avoiding verification.

When verification or login is detected, the queue **pauses globally** and leaves the affected tab open. Resolve it manually in the visible browser, then Resume. Other in-flight tabs finish/close without committing a new snapshot after the pause. If restrictions persist, stop using automation rather than retrying around them. Use only where authorized and consistent with Walmart's terms/rate limits.

Extraction is based on your screenshots, the supplied `link-identifier`/`h3` HTML, and existing repository selectors. It is tested against fixtures, **not your live account**. Virtualized lists, hidden frames, layout changes, browser policies, or a site challenge may require a site-specific update. The view represents the eligible cards that were detected on the pages that were read, not a full-catalog guarantee. A recognized empty-results page or a page containing only excluded cards can produce an empty current snapshot; unrecognized empty pages do not clear the list.

Keep your **PC awake, local companion process running, and browser signed in**. The dashboard can close if using only Telegram. A new product added/removed between checks can be missed. Alerts happen after detection, not at the exact instant the website changes.

## Local storage and security

The local server binds to **127.0.0.1 by default**. Do not expose it to a public network or forward its port. Origin/Host checks and JSON-only mutations protect against common cross-site calls, but it is intended for a trusted single-user computer, not a multi-user service.

Only explicitly allowlisted assets are served; `.local`, browser profile, tokens, and source/test files are not static routes. `.local` is ignored by Git and excluded from session snapshots. Back it up privately if needed. Do not copy it into an archive you share.

For the Arena setup preview only, run `PULSE_PREVIEW=1 HOST=0.0.0.0 npm start`. This disables browser launching, monitoring, and Telegram delivery; editing keyword/schedule configuration is still available. Never use that mode as a remotely exposed authenticated monitor.

## Tests

```sh
npm ci
npm test
npm run test:companion
```

`npm test` runs the unit tests plus two browser tests that use locally fulfilled fixture pages — they never contact Walmart, your account, or Telegram:

* `tests/scan-pages.test.js` walks the pages of a keyword in a real browser, proves the second cycle **refreshes the same tab** instead of opening a new one, checks the merge, the per-page publishing, the claim anchors, and that a verification page stops the walk instead of reporting empty results.
* `tests/server-scan.test.js` runs the **real companion** against a local portal fixture: both pages are merged into one snapshot, live progress is cleared when the scan ends, the keyword is scheduled again, a re-check reads the same tab, and the claim jump opens the portal and reports honestly when an item is not on the page.

For `test:companion`, first run a separate **preview** instance (do not point it at an active monitor):

```sh
# macOS/Linux, in a separate terminal inside SRC
PULSE_PREVIEW=1 npm start
# PowerShell: $env:PULSE_PREVIEW="1"; npm start
```

The companion browser test uses locally fulfilled fixture pages and that preview server; it does not contact your live account or Telegram. Old `dashboard.*`, extension files, and `browser-monitor.js` remain as historical versions and are **not used by the current companion**. The current entry point is `server.js` with `app.html`, `app.css`, `app.js`, and `monitor-core.js`. See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the design and the extension question.
