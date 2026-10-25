# Product Pulse on Windows — the full, step-by-step guide

Everything you need, in order, written for someone who has never used a terminal.
**No extension. No DevTools. No pasting code into a website.** You download one folder, double-click one file, and it runs.

---

## Table of contents

1. [What you are installing (2 minutes of reading)](#1-what-you-are-installing)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Step 1 — Download the folder](#3-step-1--download-the-folder)
4. [Step 2 — Unzip it](#4-step-2--unzip-it)
5. [Step 3 — Install everything (one double-click)](#5-step-3--install-everything-one-double-click)
6. [Step 4 — Install by hand instead (copy and paste)](#6-step-4--install-by-hand-instead-copy-and-paste)
7. [Step 5 — Choose your browser](#7-step-5--choose-your-browser)
8. [Step 6 — Start Product Pulse](#8-step-6--start-product-pulse)
9. [Step 7 — Sign in to Walmart](#9-step-7--sign-in-to-walmart)
10. [Step 8 — Build your keyword list](#10-step-8--build-your-keyword-list)
11. [Step 9 — Start monitoring](#11-step-9--start-monitoring)
12. [Step 10 — Turn on notifications](#12-step-10--turn-on-notifications)
13. [Everyday use](#13-everyday-use)
14. [The menu (start.ps1)](#14-the-menu-startps1)
15. [Where your data lives, and how to back it up](#15-where-your-data-lives-and-how-to-back-it-up)
16. [Troubleshooting — copy and paste these](#16-troubleshooting--copy-and-paste-these)
17. [All the commands in one place](#17-all-the-commands-in-one-place)

---

## 1. What you are installing

Product Pulse is a small program that runs **on your own computer**. It:

* opens a real browser window on your PC,
* reads the Walmart **reviewer claim-product pages** with **your own sign-in**,
* shows you every claimable product with its **image, name and value**,
* tells you when something **new** appears — with the name and the value — and never nags you about things that merely disappeared.

Three things happen on your computer and nowhere else:

| Thing | Where it lives | Can I delete it? |
| --- | --- | --- |
| The program itself | The `SRC` folder you downloaded | Yes, it is just files |
| Your keywords, snapshots and settings | `SRC\.local\product-pulse\` | Yes, but you lose your keyword list |
| The dedicated browser profile (your Walmart login) | `SRC\.local\product-pulse\browser-profile\` | Yes, but you have to sign in again |

Nothing is uploaded anywhere. There is no account to create and no server to sign up for.

> **Fair warning, stated plainly:** Product Pulse automates a real browser. Walmart may show a verification prompt or restrict automated traffic. The program never bypasses those checks, never solves CAPTCHAs, and never clicks a Claim button for you. Use it only where you are allowed to, and stop if the site asks you to.

---

## 2. What you need before you start

* **Windows 10 or Windows 11** (64-bit). Windows 7 will not work.
* **Google Chrome** — already installed is fine. Edge and Brave also work.
* **About 300 MB of free disk space** and an internet connection for the one-time install.
* **Your Walmart account**, with access to the reviewer claim-product pages.

**You do not need** any of these: a browser extension, Node.js experience, Python, Git, a command prompt, an API key, or a credit card.

If you are not sure whether Node.js is already installed, skip that question — the installer checks for you and installs it if it is missing.

---

## 3. Step 1 — Download the folder

1. Open the repository page in your browser.
2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Wait for the download to finish. You get a file called something like `walmart-main.zip`.

> If your browser blocked the download, allow it once. The ZIP is not dangerous; it is just a folder of text files.

---

## 4. Step 2 — Unzip it

1. Open **Downloads** (or wherever the ZIP landed).
2. Right-click the ZIP → **Extract All…**
3. Choose a simple place, like `C:\ProductPulse`. Click **Extract**.
4. Open the extracted folder. You should see a folder called `SRC` inside it.

Your folder should look like this:

```
C:\ProductPulse\
└── SRC\
    ├── setup.bat        ← double-click this once
    ├── start.bat        ← double-click this every day
    ├── ProductPulse.bat ← one file that does everything
    ├── setup.ps1
    ├── start.ps1
    ├── app.html
    ├── app.js
    ├── app.css
    ├── monitor-core.js
    ├── browser-choice.js
    ├── server.js
    ├── package.json
    └── ...
```

**Tip:** move the whole extracted folder somewhere permanent, like `C:\ProductPulse`. If you leave it in `Downloads`, Windows may clean it up and you will lose your keyword list.

---

## 5. Step 3 — Install everything (one double-click)

1. Open the `SRC` folder.
2. **Double-click `setup.bat`.**

A black window opens. It runs through four steps:

```
== Checking Node.js
   [ok] Node.js v22.14.0 is installed.

== Installing the program files
   [ok] Dependencies installed.

== Looking for your browser
   [ok] Google Chrome found.

   Which browser should Product Pulse open?
     1) Google Chrome
     2) Microsoft Edge
     3) Chromium (downloaded by the program)
   Type the number and press Enter [1]

== Creating a shortcut on your desktop
   [ok] Desktop shortcut created.
```

**Type `1` and press Enter** to use Google Chrome. (If you want Edge, type `2`. If you want the bundled Chromium, type the last number.)

> Choosing **Chromium** means one extra one-time download of about 150 MB — the installer does it for you. Chrome and Edge need no download at all, because they are already on your computer.

The installer also puts a **Product Pulse** shortcut on your desktop. You will use that from now on.

Press **Enter** once more to close the window. Installation is done.

> **If Windows shows a blue "Windows protected your PC" message:** that is Microsoft's SmartScreen warning about files downloaded from the internet. Click **More info** → **Run anyway**. It is your own copy of the program.
>
> **If a black window flashes and disappears:** right-click `setup.bat` → **Run as administrator**, and watch what it says.

---

## 6. Step 4 — Install by hand instead (copy and paste)

If you would rather do it manually — or the installer complains — open **PowerShell** and paste these blocks one at a time.

**Open PowerShell:** press **Win**, type `powershell`, press **Enter**. (Or right-click the `SRC` folder → *Open in Terminal*.)

### 6.1 Move into the SRC folder

Paste this and press Enter (change the path to yours if you put it somewhere else):

```powershell
cd "C:\ProductPulse\SRC"
```

Check you are in the right place:

```powershell
Get-ChildItem
```

You should see `package.json`, `server.js`, `app.html` and friends.

### 6.2 Install Node.js (skip if you already have it)

Check first:

```powershell
node --version
```

If it prints something like `v22.14.0`, you already have Node.js — **skip to 6.3**.

Otherwise install the current LTS release with winget:

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
```

**Close the PowerShell window and open a new one** afterwards, so the new `PATH` is picked up. Then check again:

```powershell
node --version
npm --version
```

If `winget` is not available (it is missing on some editions), download the **LTS** installer from <https://nodejs.org> and run it. Accept the defaults.

### 6.3 Install the program's own files

```powershell
npm ci
```

You should see something like `added 20 packages in 4s`. That is the one slow step; you only do it once.

### 6.4 Pick your browser and write it down

Paste this to see what is installed:

```powershell
@(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
) | Where-Object { Test-Path $_ } | ForEach-Object { "FOUND: $_" }
```

Now write the choice down. For Google Chrome (change the path to the one your check printed):

```powershell
New-Item -ItemType Directory -Force -Path ".local\product-pulse" | Out-Null
@{ browser = "chrome"; executablePath = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" } |
  ConvertTo-Json | Set-Content -Path ".local\product-pulse\browser.json" -Encoding UTF8
Get-Content ".local\product-pulse\browser.json"
```

For Microsoft Edge use `"browser": "msedge"`, for Brave use `"browser": "brave"`. If the check printed nothing at all, use `"browser": "chromium"` and an empty path, and run:

```powershell
npx playwright install chromium
```

### 6.5 Optional: make a desktop shortcut by hand

```powershell
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\Product Pulse.lnk")
$link.TargetPath = "$PWD\start.bat"
$link.WorkingDirectory = "$PWD"
$link.Save()
```

### 6.6 Start it

```powershell
npm start
```

You should see:

```
Product Pulse listening on http://localhost:8080
```

---

## 7. Step 5 — Choose your browser

You already made this choice during setup. To change it later, use **either**:

* the dashboard — **Browser setup** tab → **Which browser?** → pick one → **Save browser**; or
* the menu — double-click `ProductPulse.bat` → **3) Choose the browser**.

Product Pulse supports:

| Choice | When to pick it |
| --- | --- |
| **Google Chrome** | The default. Use your normal Chrome install. |
| **Microsoft Edge** | If Chrome is not installed or you do not use it. |
| **Brave** | If that is your daily browser. |
| **Chromium** | The copy the program downloads itself. Works even with no browser installed. |

**You are never forced into one browser.** The choice is stored in `.local\product-pulse\browser.json` and can be changed whenever you like.

---

## 8. Step 6 — Start Product Pulse

Pick whichever you like:

* **Double-click the desktop shortcut** `Product Pulse`.
* **Double-click `start.bat`** inside `SRC`.
* **Double-click `ProductPulse.bat`** inside `SRC` — this one installs anything missing first, then starts. Use it if you are not sure.
* **Or in PowerShell:** `npm start`.

A black window appears:

```
  Starting Product Pulse...
  -----------------------
  The dashboard opens in your browser. Keep this window open.
  Press Ctrl+C to stop it.
```

Your browser opens **http://localhost:8080** automatically.

> **Keep that black window open.** Closing it stops Product Pulse. Minimising it is fine. If you want it out of the way, right-click its title bar → *Minimize*.

If the browser does not open by itself, type this into your browser's address bar:

```
http://localhost:8080
```

---

## 9. Step 7 — Sign in to Walmart

1. In the dashboard, click **Open browser** (top right) — or the **Open browser ↗** button in the **Browser setup** tab.
2. A **separate Chrome window** opens. It has its own profile, so your everyday Chrome is untouched.
3. Sign in to Walmart in that window.
4. Make sure you can open the reviewer page. Paste this into that window's address bar:

```
https://www.walmart.com/reviews/claim-product?sort=price_high&page=1
```

5. If you see your products, you are signed in correctly. **Leave that window open** — Product Pulse keeps using it and refreshing it in place so your session stays warm.
6. Go back to the dashboard tab. The bottom-left corner should now say **Browser connected**.

### Prefer your everyday Chrome?

You can drive the Chrome you already sign in to. It is still extension-free:

1. Close Product Pulse.
2. Open **PowerShell** and paste:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\pulse-chrome"
```

(If your Chrome is in `Program Files (x86)` or `%LOCALAPPDATA%`, change the path. You can find the real one by pressing **Win+R** and typing `chrome` — right-click the result → *Open file location*.)

3. That opens a new Chrome window.
4. Start Product Pulse again and click **Attach to my Chrome** (top right, or in the **Browser setup** tab).

> The `--user-data-dir` part is deliberate: it gives the monitored Chrome its own throwaway profile folder so your real profile is never touched. You will sign in once in that window.

---

## 10. Step 8 — Build your keyword list

1. Click **Watchlist** in the left sidebar, or the **+** next to **YOUR KEYWORDS**.
2. One keyword per line. You can also paste a Walmart reviewer link and the keyword is taken out of it automatically:

```
chair
power bank
sofa
recliner
```

3. Tick **Also monitor all products (no keyword filter)** if you want the unfiltered highest-value page watched too.
4. Click **Save keyword list**.

Your list is saved on this computer and survives restarts.

### The ⚗ extra-items switch

Some keywords return more products when a character is added to the end. Click the **⚗** next of a keyword to switch that on:

* it searches `keyword&` and `keyword8` as well as the plain keyword,
* keeps whatever extra products those searches reveal,
* the markers are editable in **Preferences → Search scope and filters → Extra-item markers** (you can add `*` or `"` there if they help you),
* it costs extra requests to Walmart, so leave it off for most keywords.

---

## 11. Step 9 — Start monitoring

1. Open the **Watchlist** tab.
2. Check the **Filters in effect** panel — time between checks, pages per search, sort, value range.
3. Click **Start monitoring**.

You will see, per keyword:

* a **green ✓** once it has been read,
* a **red ✕** if it is overdue or failed,
* a **countdown** to its next check (`4m 58s`),
* a **red negative time** (`-2m 13s`) when the queue is running late,
* `p2/3 · 118 found` while a page is being read.

The **Product radar** tab fills in with cards as pages are read — image, name, value, and a **Claim on Walmart** button that jumps straight to that item on the portal and highlights it. You still click Walmart's own Claim button.

---

## 12. Step 10 — Turn on notifications

### Windows toast (built in)

**Preferences → Notifications → Send system notifications (Windows toast)** → tick it → **Save preferences**.

A new product looks like this:

```
New product · chair
Massage Chair Cushion Pad
Value: $1,299.95
```

and an above-average newcomer looks like this:

```
URGENT new product · chair
Massage Chair Cushion Pad
Value: $1,299.95
```

Click **Send test notification** to check it works. Removals are never announced.

> The toast comes from the little black window (the companion), not from the dashboard tab — so it works even if you close the dashboard. Keep the black window running.
>
> If no toast appears, Windows may be blocking it: **Settings → System → Notifications → turn on notifications for your terminal/Windows Terminal**, and check **Do not disturb** is off.

### Telegram to your phone (optional)

1. Open Telegram, find **@BotFather**, send `/newbot`, give it a name and a username.
2. Copy the token it gives you.
3. Open **@userinfobot** and send `/start` to get your chat ID.
4. In **Preferences → Telegram to your Android**: tick the box, paste the **bot token** and the **chat ID**, then **Save preferences**.
5. Click **Send test message**.

The token is stored only on your computer, in `.local\product-pulse\state.json`. It is never sent to Walmart and never included in a list export.

---

## 13. Everyday use

| I want to… | Do this |
| --- | --- |
| Start monitoring | Desktop shortcut **Product Pulse** → **Start monitoring** in the dashboard |
| Stop it | Click **Pause monitoring**, or close the black window |
| Change the interval | **Watchlist → Time between checks**, or **Preferences** |
| Change how many pages are read | **Watchlist → Pages per search** (default: **1**, the first page only) |
| Change the sort | **Watchlist → Sort on the portal** (default: **Value: high to low**) |
| Add a keyword | **Watchlist → Add a keyword… → Add** |
| Remove a keyword | The **×** at the right of its row |
| Search for one product now | Select a keyword, then click **↻** next to the search box |
| Change the browser | **Browser setup → Which browser?** → **Save browser** |
| See what happened | **Activity** tab |
| Back everything up | Copy the `.local\product-pulse` folder |

**Nothing has to be stopped when you change a setting.** The next pass of each keyword picks the new value up. No baseline is lost.

---

## 14. The menu (`start.ps1`)

`ProductPulse.bat` opens a menu if you launch it with PowerShell:

```
  Product Pulse
  -------------
   1) Start Product Pulse
   2) Install or repair (Node.js, files, browser)
   3) Choose the browser (Chrome / Edge / Brave / Chromium)
   4) Open the dashboard in a browser
   5) Attach to a Chrome you already started
   6) Where is my data?
   7) Reset everything (wipes keywords and history)
   8) Quit
```

To open it directly:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProductPulse\SRC\start.ps1"
```

---

## 15. Where your data lives, and how to back it up

Everything is inside the folder you downloaded:

```
C:\ProductPulse\SRC\.local\product-pulse\
├── state.json          ← keywords, settings, snapshots, alerts, Telegram token
├── browser.json        ← which browser you picked
└── browser-profile\    ← the dedicated Chrome profile with your Walmart login
```

**Back it up** (while Product Pulse is closed):

```powershell
Copy-Item "C:\ProductPulse\SRC\.local\product-pulse" "D:\Backups\product-pulse" -Recurse
```

**Move it to another PC:** copy the whole `SRC` folder, run `setup.bat` on the new machine, then copy your `.local\product-pulse` folder across too.

**Start completely fresh:**

```powershell
Remove-Item -Recurse -Force "C:\ProductPulse\SRC\.local\product-pulse"
```

> `.local` contains your Walmart session. Treat it like a password: never upload it, never put it in a shared archive, never commit it to Git.

---

## 16. Troubleshooting — copy and paste these

### "`node` is not recognized…"

Node.js is not installed, or PowerShell was opened before the install finished.

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
```

Close PowerShell, open it again, then:

```powershell
node --version
npm --version
```

### "npm ci failed" / "ENOTFOUND registry.npmjs.org"

No internet, or a proxy. Check your connection, then retry:

```powershell
npm ci --no-audit --no-fund
```

If you are behind a corporate proxy:

```powershell
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
npm ci
```

### "Port 8080 is already in use"

Something else is using the port — usually a second copy of Product Pulse.

```powershell
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object OwningProcess
```

Close the other black window, or start on a different port:

```powershell
$env:PORT = "8090"; npm start
```

Then open **http://localhost:8090**.

### "This computer has no system notifier"

The Windows toast library is missing. Reinstall it:

```powershell
npm install node-notifier --no-save
```

Telegram still works either way.

### "Could not read a stable list" / the keyword shows a red ✕

Walmart changed the page, or it asked for verification. Open the browser window that Product Pulse started, look at it, solve anything it asks (by hand), then press **Resume monitoring**. If the page looks broken, stop and try again later — do not hammer it.

### The dashboard says "Companion offline"

The black window was closed. Start it again.

### "The browser was closed by the user" / no browser opens

Your chosen browser path is wrong. Check it:

```powershell
@(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ }
```

Then re-run the setup script, which asks again:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProductPulse\SRC\setup.ps1"
```

### Windows SmartScreen blocks the scripts

Right-click the `.bat` → **Properties** → tick **Unblock** at the bottom → **OK**. Or right-click → **Run as administrator**.

### PowerShell says "running scripts is disabled on this system"

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

That only affects the current window.

### Everything is fine but I see no products

1. Is the browser signed in? Open the dedicated window and check.
2. Are you monitoring the right thing? The retailer search bar is not used — only the reviewer claim-product pages.
3. Did the first scan finish? The very first scan is a silent baseline and takes a moment.
4. Are you on the first page? Default is **1 page per search**, which is the gentlest setting.

---

## 17. All the commands in one place

```powershell
# --- one-time install ---------------------------------------------------
cd "C:\ProductPulse\SRC"
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
npm ci

# --- everyday use --------------------------------------------------------
npm start                                   # start the companion
Start-Process http://localhost:8080        # open the dashboard
Stop-Process -Name node                     # stop the companion (careful)

# --- the scripts ---------------------------------------------------------
.\setup.bat                                 # install / repair
.\start.bat                                 # start
.\ProductPulse.bat                          # install if needed, then start

# --- settings ------------------------------------------------------------
$env:PULSE_PORT = "8090"                    # use a different port
$env:PULSE_HEADLESS = "1"                   # no visible browser (testing only)
$env:PULSE_BROWSER = "msedge"               # force Edge / chrome / chromium
$env:PULSE_BROWSER_PATH = "C:\...\chrome.exe"
$env:PULSE_OPEN_DASHBOARD = "0"             # do not open the browser automatically

# --- housekeeping --------------------------------------------------------
Copy-Item ".local\product-pulse" "D:\Backups\product-pulse" -Recurse   # backup
Remove-Item -Recurse -Force ".local\product-pulse"                    # reset
npm test                                     # run the test suite
```

---

## Where to go next

* **[README.md](README.md)** — how the program behaves, every setting explained.
* **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it works and why no extension is needed.
* **[BROWSER-SETUP.md](BROWSER-SETUP.md)** — the older console-script approach (historical).
