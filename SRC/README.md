# Product Pulse — local browser companion (current version)

**No extension. No DevTools console script.** A dashboard running on your PC opens first-page Walmart reviewer-portal tabs, reads eligible cards, closes the tabs, and stores the current products locally.

The hosted preview is a **setup/interface preview only**. It cannot access your computer's signed-in browser or perform live monitoring. Product lists start empty; no fabricated live products are displayed.

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
5. Edit/save your keywords and schedule, then click **Start monitoring**.

### Which browser/account does this use?

The companion launches a **dedicated persistent Chrome profile** in `SRC/.local/product-pulse/browser-profile`. Sign in once in that window. It does **not** attach to, copy cookies from, or control the Chrome profile you normally have open. Browser security does not permit the hosted dashboard to simply read your local authenticated tabs.

Do not open this profile simultaneously from another Chrome instance. No passwords are entered in the app. The browser profile contains authentication data: keep it private and never commit, upload, or share `.local`.

If Chrome is not installed, either install it, or use Playwright's browser:

```sh
npx playwright install chromium
```

Then set `PULSE_BROWSER=chromium` in your environment before `npm start` (PowerShell: `$env:PULSE_BROWSER="chromium"`; macOS/Linux: `PULSE_BROWSER=chromium npm start`). `PULSE_BROWSER=msedge` can select installed Edge. Linux may need browser system libraries and an actual graphical desktop. This is not meant to run headlessly on your PC.

## Exact pages used

The app uses **only the reviewer claim-product URLs**, never Walmart's retail search bar:

- All products, highest first: `https://www.walmart.com/reviews/claim-product?sort=price_high&page=1`
- Keyword: `https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=chair&page=1`
- Multiword example: `https://www.walmart.com/reviews/claim-product?sort=price_high&queryNups=power+bank&page=1`

It does not click pagination or navigate to page two. A redirected page must still match the expected origin, path, sort, keyword, and page before its products are accepted.

The prefilled list uses the screenshot keywords: chair, sofa, recliner, furniture, bed frame, Storage, outdoor, Gazebo, car, gaming, bike, ebike, Appliance, battery, ride on, scooter, camera, led, wireless, Electronics; plus **power bank**. The unfiltered all-products monitor is enabled initially and can be unchecked. The truncated screenshot entry “car - Walma…” was interpreted as `car`.

## Lists and products

- Edit keywords one per line, then **Save keyword list**. Saved lists and snapshots survive restarts.
- Import/export a `.json` list or import plain text. Exports contain only keywords and the unfiltered-page preference, never browser credentials or Telegram tokens.
- Up to 100 keywords plus the unfiltered monitor. Blank/duplicate keywords are removed.
- Click a keyword in the sidebar to see that first-page snapshot, last check, recorded high, and exclusions. The aggregate view deduplicates overlapping product IDs across keywords.
- Product cards show image, name, stated **Valued at $…** amount, and link. `Free` is not treated as a zero-dollar product value. Missing values remain unknown.
- High-to-low is the default display order; use the value/name controls or local product-name filter.
- Only cards with an enabled **View item / Claim / Claim item / Claim product** action are included. Out of stock, Shop similar, sold out, unavailable, and disabled-action cards are excluded.
- **View item is the entry button in the supplied screenshots.** The app does not click it or claim anything. Button presence is not a guarantee that a later claim will succeed.
- Image hotlinking may be restricted or expire. The card keeps its text/value even if its image cannot be displayed.

## Schedule and queue

Preferences offer **1 minute, 5 minutes (default), 15 minutes, and custom 1–1,440 minutes**.

Every successfully completed keyword scan sets that keyword's own next due time. A failed ordinary scan retains its last good snapshot and schedules a later attempt. The scanner loads a fresh tab, waits for a stable list while scrolling through the first page, saves the snapshot, and closes the tab. A short notification-delivery step can keep that worker slot busy a little longer.

**One page at a time** is the default. Optional two-page mode is labeled **not recommended**; three-page mode is labeled **at your own risk**. This is a concurrency limit, not CPU threading. Due keywords are scheduled oldest-due-first; in-flight keywords are never duplicated. If scans take longer than the interval, the sidebar displays **Overdue**/queued duration until a worker slot is available. There is no promise that every keyword can be checked within a one-minute interval.

Pause stops further scheduling. Active page operations may take up to their timeout to finish before tabs close; wait for them before editing settings/lists or resuming. Restarting the app never automatically resumes monitoring.

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

Desktop notifications require permission and **this dashboard to stay open**. Existing historical events are not re-notified on load. OS focus/do-not-disturb settings can hide alerts. Polling the local companion every two seconds adds a small desktop-delivery delay.

### Telegram on Android (optional)

1. Create a bot with **@BotFather**. Open your bot and send **/start**.
2. Find your private chat ID (for example, with **@userinfobot**). Groups require their actual group chat ID and bot membership.
3. In Preferences, enable Telegram, enter the bot token and chat ID, and Save.
4. Send a test message and confirm receipt on Android. Allow Telegram notifications on the phone.

The Node companion, not the Walmart page, contacts Telegram, so this does not require relaxing Walmart's content-security policy. The token is saved on your PC in `.local/product-pulse/state.json` with restrictive file permissions where supported. It is not encrypted; protect the computer/profile. The token is **never returned by the state API**, nor included in list exports. Leaving the token field blank keeps the saved token. Do not paste real tokens into chat or source code. Telegram receives product names, values, and links (links can include site parameters). Delivery failures appear in Activity and are not automatically retried.

## Verification, login, and limits

**No stealth settings, CAPTCHA solving, DevTools protection bypass, cookie extraction, or access-control evasion is implemented.** Playwright is ordinary browser automation; Walmart may detect or disallow it. This approach avoids manually opening DevTools but does not guarantee avoiding verification.

When verification or login is detected, the queue **pauses globally** and leaves the affected tab open. Resolve it manually in the visible browser, then Resume. Other in-flight tabs finish/close without committing a new snapshot after the pause. If restrictions persist, stop using automation rather than retrying around them. Use only where authorized and consistent with Walmart's terms/rate limits.

Extraction is based on your screenshots, the supplied `link-identifier`/`h3` HTML, and existing repository selectors. It is tested against fixtures, **not your live account**. Virtualized lists, hidden frames, layout changes, browser policies, or a site challenge may require a site-specific update. The view represents detected eligible first-page cards, not a full-catalog guarantee. A recognized empty-results page or a page containing only excluded cards can produce an empty current snapshot; unrecognized empty pages do not clear the list.

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

For `test:companion`, first run a separate **preview** instance (do not point it at an active monitor):

```sh
# macOS/Linux, in a separate terminal inside SRC
PULSE_PREVIEW=1 npm start
# PowerShell: $env:PULSE_PREVIEW="1"; npm start
```

The companion browser test uses locally fulfilled fixture pages and that preview server; it does not contact your live account or Telegram. Old `dashboard.*`, extension files, and `browser-monitor.js` remain as historical versions and are **not used by the current companion**. The current entry point is `server.js` with `app.html`, `app.css`, `app.js`, and `monitor-core.js`.
