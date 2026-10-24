import { compareSnapshot, validateMonitor } from './core.js';
import { extractProducts } from './extractor.js';

const queue = new Set();
let running = false;
let lock = Promise.resolve();
const update = fn => {
  const task = lock.then(async () => {
    const data = await chrome.storage.local.get({ monitors: [], events: [], settings: { desktop: true, telegram: false }, ownedTabs: [] });
    const result = await fn(data);
    await chrome.storage.local.set(data);
    return result;
  });
  lock = task.catch(() => {});
  return task;
};
const alarmName = id => `monitor:${id}`;
const price = value => value === null ? 'Price unavailable' : `$${value.toFixed(2)}`;

async function setupAlarms() {
  const { monitors = [] } = await chrome.storage.local.get('monitors');
  const ids = new Set(monitors.filter(m => m.enabled).map(m => alarmName(m.id)));
  for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith('monitor:') && !ids.has(alarm.name)) await chrome.alarms.clear(alarm.name);
  for (const m of monitors.filter(m => m.enabled)) {
    const a = await chrome.alarms.get(alarmName(m.id));
    if (!a || a.periodInMinutes !== m.minutes) await chrome.alarms.create(alarmName(m.id), { delayInMinutes: m.minutes, periodInMinutes: m.minutes });
  }
}

async function telegram(settings, message) {
  if (!settings.token || !settings.chatId) throw new Error('Telegram needs a bot token and chat ID.');
  const allowed = await chrome.permissions.contains({ origins: ['https://api.telegram.org/*'] });
  if (!allowed) throw new Error('Grant Telegram permission in settings.');
  const response = await fetch(`https://api.telegram.org/bot${settings.token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: settings.chatId, text: message.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`Telegram rejected the message (${response.status}). Check the bot token, chat ID, and that you started the bot.`);
}

async function notify(monitor, result) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const urgentIds = new Set(result.urgent.map(p => p.id));
  const ordinary = result.added.filter(p => !urgentIds.has(p.id));
  const groups = [
    { kind: 'urgent', title: `URGENT new product · ${monitor.keyword}`, items: result.urgent },
    { kind: 'new', title: `New product · ${monitor.keyword}`, items: ordinary },
    { kind: 'removed', title: `Page update · ${monitor.keyword}`, items: result.removed }
  ].filter(g => g.items.length);
  for (const group of groups) {
    const id = crypto.randomUUID();
    const prefix = group.kind === 'removed' ? 'Left the first page' : 'Added to the first page';
    const message = `${group.title}\n${prefix}: ${group.items.length}\n${group.items.slice(0, 12).map(p => `${p.title} — ${price(p.price)}\n${p.url}`).join('\n\n')}${group.items.length > 12 ? '\nMore items in the dashboard.' : ''}\n\n${monitor.url}`;
    const failures = [];
    if (settings.desktop !== false) {
      try { await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: group.title, message: `${prefix}: ${group.items.length}\n${group.items.slice(0, 3).map(p => `${p.title} — ${price(p.price)}`).join('\n')}`, priority: group.kind === 'urgent' ? 2 : 0, requireInteraction: group.kind === 'urgent' }); }
      catch { failures.push('Desktop notification failed. Check browser and OS notification permissions.'); }
    }
    if (settings.telegram) {
      try { await telegram(settings, message); }
      catch (error) { failures.push(error.message.includes('Telegram') ? error.message : 'Telegram delivery failed (network or timeout).'); }
    }
    await update(data => {
      data.events.unshift({ id, monitorId: monitor.id, keyword: monitor.keyword, url: monitor.url, kind: group.kind, title: group.title, count: group.items.length, items: group.items.slice(0, 100), at: Date.now(), failures });
      data.events = data.events.slice(0, 200);
      while (data.events.length > 1 && JSON.stringify(data.events).length > 2000000) data.events.pop();
    });
  }
}

async function loadTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await update(data => { data.ownedTabs.push(tab.id); });
  return tab.id;
}
async function waitForLoad(tabId) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Page loading timed out.');
}

async function scan(id) {
  let monitor;
  await update(data => {
    monitor = data.monitors.find(m => m.id === id);
    if (monitor?.enabled) { monitor.scanningAt = Date.now(); monitor.error = ''; }
  });
  if (!monitor?.enabled) return;
  let tabId;
  try {
    const origin = new URL(monitor.url).origin + '/*';
    if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('Page access permission is missing. Edit and save this monitor to grant it again.');
    tabId = await loadTab(monitor.url);
    await waitForLoad(tabId);
    const frames = await chrome.scripting.executeScript({ target: { tabId }, func: extractProducts, args: [monitor.selectors] });
    const extracted = frames[0]?.result;
    if (!extracted?.products?.length) throw new Error('Could not read products. Open the page to check your login or selectors.');
    if (new URL(extracted.scannedUrl).origin !== new URL(monitor.url).origin) throw new Error('The page redirected to a different site. Check your login.');
    let result;
    await update(data => {
      const current = data.monitors.find(m => m.id === id);
      if (!current?.enabled || current.revision !== monitor.revision) return;
      result = compareSnapshot(current.snapshot, extracted.products);
      current.snapshot = { products: result.products, high: result.high };
      current.lastCheck = Date.now(); current.error = ''; current.scanningAt = null;
      current.lastAdded = result.added.map(p => p.id); current.lastUrgent = result.urgent.map(p => p.id);
      if (result.baseline || result.added.length || result.removed.length) current.lastChange = Date.now();
    });
    if (result && !result.baseline) await notify(monitor, result);
  } catch (error) {
    await update(data => {
      const current = data.monitors.find(m => m.id === id);
      if (current && current.revision === monitor.revision) { current.error = error.message; current.lastAttempt = Date.now(); current.scanningAt = null; }
    });
  } finally {
    if (tabId !== undefined) {
      await chrome.tabs.remove(tabId).catch(() => {});
      await update(data => { data.ownedTabs = data.ownedTabs.filter(id => id !== tabId); });
    }
  }
}

async function enqueue(ids) {
  await ready;
  for (const id of ids) queue.add(id);
  if (running) return;
  running = true;
  try {
    while (queue.size) {
      const id = queue.values().next().value;
      queue.delete(id);
      await scan(id);
    }
  } finally { running = false; }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('monitor:')) void enqueue([alarm.name.slice(8)]);
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
chrome.notifications.onClicked.addListener(async id => {
  const { events = [] } = await chrome.storage.local.get('events');
  const event = events.find(e => e.id === id);
  await chrome.tabs.create({ url: event?.url || chrome.runtime.getURL('dashboard.html') });
});
async function recover() {
  const { ownedTabs = [] } = await chrome.storage.local.get('ownedTabs');
  for (const id of ownedTabs) await chrome.tabs.remove(id).catch(() => {});
  await update(data => { data.ownedTabs = []; data.monitors.forEach(m => { if (m.scanningAt) m.error = 'The last check was interrupted. The next scheduled check will retry.'; m.scanningAt = null; }); });
  await setupAlarms();
}
const ready = recover();
chrome.runtime.onInstalled.addListener(() => ready.then(setupAlarms));
chrome.runtime.onStartup.addListener(() => ready.then(setupAlarms));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only extension pages may control monitors or access Telegram settings.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  (async () => {
    await ready;
    if (message.type === 'save') {
      const valid = validateMonitor(message.monitor);
      const id = message.monitor.id || crypto.randomUUID();
      await update(data => {
        const existing = data.monitors.find(m => m.id === id);
        if (!existing && data.monitors.length >= 30) throw new Error('Maximum 30 monitors.');
        if (existing) {
          const reset = existing.url !== valid.url || JSON.stringify(existing.selectors) !== JSON.stringify(valid.selectors);
          Object.assign(existing, valid, { enabled: true, error: '' });
          existing.revision = (existing.revision || 0) + 1; existing.scanningAt = null;
          if (reset) { existing.snapshot = null; existing.lastCheck = null; existing.lastChange = null; }
        } else data.monitors.push({ ...valid, id, revision: 1, enabled: true, snapshot: null, createdAt: Date.now() });
      });
      await setupAlarms(); void enqueue([id]); return { id };
    }
    if (message.type === 'toggle' || message.type === 'delete') {
      await update(data => {
        if (message.type === 'delete') data.monitors = data.monitors.filter(m => m.id !== message.id);
        else { const m = data.monitors.find(m => m.id === message.id); if (m) { m.enabled = !m.enabled; m.revision = (m.revision || 0) + 1; m.scanningAt = null; } }
      });
      await setupAlarms(); return {};
    }
    if (message.type === 'check') {
      const { monitors = [] } = await chrome.storage.local.get('monitors');
      void enqueue(monitors.filter(m => m.enabled && (!message.id || m.id === message.id)).map(m => m.id)); return {};
    }
    if (message.type === 'settings') {
      await update(data => { data.settings = { desktop: !!message.settings.desktop, telegram: !!message.settings.telegram, token: String(message.settings.token || '').trim(), chatId: String(message.settings.chatId || '').trim() }; }); return {};
    }
    if (message.type === 'testTelegram') {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await telegram(settings, 'Product Pulse connected. New products and URGENT new price highs will arrive here.'); return {};
    }
    if (message.type === 'testDesktop') {
      await chrome.notifications.create(crypto.randomUUID(), { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Product Pulse is ready', message: 'Desktop alerts are working.' }); return {};
    }
    throw new Error('Unknown request.');
  })().then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
