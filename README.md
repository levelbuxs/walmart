# Product Pulse

A local monitor for the Walmart **reviewer claim-product pages**. It runs on your own PC, drives a real browser with your own sign-in, and tells you when something new appears — with the product's name and value. Removals stay silent.

**No extension. No DevTools console script. No hosted service.**

```
walmart/
├── SRC/          ← the program (this is the folder you download and run)
│   ├── setup.bat / setup.ps1      one-time installer for Windows
│   ├── start.bat / start.ps1      launches it and opens the dashboard
│   ├── ProductPulse.bat           install-if-needed, then start
│   └── WINDOWS-SETUP.md           the full step-by-step Windows tutorial
├── scrape.js / walmart_scraper_full_categories_v7.js   earlier experiments
└── 3.html                                         earlier reference capture
```

## Start here

| You want to… | Go to |
| --- | --- |
| **Install and run it on Windows** | **[SRC/WINDOWS-SETUP.md](SRC/WINDOWS-SETUP.md)** — step by step, with every command to copy and paste |
| **Read the full tutorial (Windows)** | [SRC/WINDOWS-SETUP.md](SRC/WINDOWS-SETUP.md) |
| **Understand every setting and behavior** | [SRC/README.md](SRC/README.md) |
| **Understand how it works, and the extension question** | [SRC/ARCHITECTURE.md](SRC/ARCHITECTURE.md) |
| **See the earlier console-script version** | [SRC/BROWSER-SETUP.md](SRC/BROWSER-SETUP.md) (historical) |

## The short version

1. Download this repository as a ZIP and extract it somewhere permanent.
2. Open the **`SRC`** folder and double-click **`setup.bat`** (Windows). It installs Node.js if needed, installs the program, asks which browser to use, and makes a desktop shortcut.
3. Double-click **`start.bat`** (or the shortcut) whenever you want to use it. The dashboard opens at <http://localhost:8080>.
4. Click **Open browser**, sign in to Walmart once, pick your keywords, and press **Start monitoring**.

Chrome is the default browser; Edge, Brave and the bundled Chromium are one click away in **Browser setup → Which browser?**.

---

Product Pulse automates a browser. It does not bypass CAPTCHAs, anti-bot checks, or any access control, and it never clicks a Claim button for you. Use it only where you are authorized to, and keep to the site's terms and rate limits.
