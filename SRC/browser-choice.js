import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Windows, macOS and Linux locations for the browsers this companion can drive.
// Playwright's own "channel" lookup also works on Windows, so a missing path
// here does not mean the browser cannot be started.
export const BROWSER_CATALOG = [
  {
    id: 'chrome', label: 'Google Chrome', channel: 'chrome',
    windows: [
      ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
      ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
      ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe']
    ],
    mac: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  },
  {
    id: 'msedge', label: 'Microsoft Edge', channel: 'msedge',
    windows: [
      ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['LOCALAPPDATA', 'Microsoft\\Edge\\Application\\msedge.exe']
    ],
    mac: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
  },
  {
    id: 'brave', label: 'Brave', channel: '',
    windows: [
      ['ProgramFiles', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
      ['ProgramFiles(x86)', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
      ['LOCALAPPDATA', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe']
    ],
    mac: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux: ['/usr/bin/brave-browser', '/usr/bin/brave']
  },
  { id: 'chromium', label: 'Chromium (bundled with Playwright)', channel: 'chromium', windows: [], mac: [], linux: [] }
];

export const DEFAULT_BROWSER = 'chrome';

function windowsPaths(entry, env) {
  const paths = [];
  for (const [variable, suffix] of entry.windows || []) {
    const root = env[variable];
    if (!root) continue;
    paths.push(join(root, suffix));
  }
  return paths;
}
export function findExecutable(entry, env = process.env, platform = process.platform) {
  const candidates = platform === 'win32'
    ? windowsPaths(entry, env)
    : platform === 'darwin' ? (entry.mac || []) : (entry.linux || []);
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return '';
}
// Lists the browsers that can be driven on this computer, with the one that
// would be used by default.
export function detectBrowsers(env = process.env, platform = process.platform) {
  return BROWSER_CATALOG.map(entry => {
    const path = findExecutable(entry, env, platform);
    return {
      id: entry.id,
      label: entry.label,
      channel: entry.channel,
      path,
      installed: Boolean(path) || entry.id === 'chromium',
      note: entry.id === 'chromium' ? 'Installed by: npx playwright install chromium' : (path ? 'Found on this computer' : 'Not found on this computer')
    };
  });
}
// Turns a stored choice into Playwright launch options.
export function resolveBrowser(choice, env = process.env) {
  if (env.PULSE_BROWSER_PATH) return { executablePath: env.PULSE_BROWSER_PATH, source: 'PULSE_BROWSER_PATH' };
  if (env.PULSE_BROWSER) return { channel: env.PULSE_BROWSER, source: 'PULSE_BROWSER' };
  const id = choice?.browser || DEFAULT_BROWSER;
  const entry = BROWSER_CATALOG.find(item => item.id === id) || BROWSER_CATALOG[0];
  const path = choice?.executablePath || findExecutable(entry, env);
  if (path) return { executablePath: path, source: 'choice' };
  if (entry.channel) return { channel: entry.channel, source: 'choice' };
  return { channel: 'chromium', source: 'fallback' };
}
