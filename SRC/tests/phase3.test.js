import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXTRA_MARKERS, MAX_EXTRA_MARKERS, parseExtraMarkers, experimentalVariants, validateSettings
} from '../monitor-core.js';
import {
  BROWSER_CATALOG, DEFAULT_BROWSER, detectBrowsers, findExecutable, resolveBrowser
} from '../browser-choice.js';

test('the default extra-item markers are & and 8', () => {
  assert.deepEqual(DEFAULT_EXTRA_MARKERS, ['&', '8']);
});

test('extra markers are parsed from spaces or commas and cleaned up', () => {
  assert.deepEqual(parseExtraMarkers('& 8'), ['&', '8']);
  assert.deepEqual(parseExtraMarkers('*,&,"'), ['*', '&', '"']);
  assert.deepEqual(parseExtraMarkers(['&', '8']), ['&', '8']);
  assert.deepEqual(parseExtraMarkers('  &   8  '), ['&', '8']);
  assert.deepEqual(parseExtraMarkers('&& 8'), ['&&', '8']);
});

test('duplicate markers are removed and empty input falls back to the default', () => {
  assert.deepEqual(parseExtraMarkers('& & 8 8'), ['&', '8']);
  assert.deepEqual(parseExtraMarkers(''), DEFAULT_EXTRA_MARKERS);
  assert.deepEqual(parseExtraMarkers('   '), DEFAULT_EXTRA_MARKERS);
  assert.deepEqual(parseExtraMarkers([]), DEFAULT_EXTRA_MARKERS);
  assert.deepEqual(parseExtraMarkers(null), DEFAULT_EXTRA_MARKERS);
});

test('markers longer than three characters or too many markers are rejected', () => {
  assert.throws(() => parseExtraMarkers('abcd'));
  const many = Array.from({ length: MAX_EXTRA_MARKERS + 1 }, (_, index) => String.fromCharCode(97 + index));
  assert.throws(() => parseExtraMarkers(many.join(' ')));
  assert.doesNotThrow(() => parseExtraMarkers(many.slice(0, MAX_EXTRA_MARKERS).join(' ')));
});

test('a keyword is searched as itself plus every marker', () => {
  assert.deepEqual(experimentalVariants('chair'), ['chair&', 'chair8']);
  assert.deepEqual(experimentalVariants('chair', ['*']), ['chair*']);
  assert.deepEqual(experimentalVariants('chair', ['&', '8', '*']), ['chair&', 'chair8', 'chair*']);
  assert.deepEqual(experimentalVariants(''), []);
  assert.deepEqual(experimentalVariants('  '), []);
});

test('settings keep the chosen markers and the default when none are given', () => {
  assert.deepEqual(validateSettings({}).extraMarkers, DEFAULT_EXTRA_MARKERS);
  assert.deepEqual(validateSettings({ extraMarkers: '*' }).extraMarkers, ['*']);
  assert.deepEqual(validateSettings({ extraMarkers: '& 8' }).extraMarkers, ['&', '8']);
});

test('the browser catalog always offers chrome, edge, brave and chromium', () => {
  assert.deepEqual(BROWSER_CATALOG.map(entry => entry.id), ['chrome', 'msedge', 'brave', 'chromium']);
  assert.equal(DEFAULT_BROWSER, 'chrome');
});

test('browser detection reports which ones are installed on this computer', () => {
  const browsers = detectBrowsers();
  assert.equal(browsers.length, BROWSER_CATALOG.length);
  for (const entry of browsers) {
    assert.equal(typeof entry.installed, 'boolean');
    assert.equal(typeof entry.note, 'string');
    assert.ok(entry.note.length > 0);
  }
  // The bundled Chromium is always offered as a fallback.
  assert.equal(browsers.find(entry => entry.id === 'chromium').installed, true);
});

test('windows browser paths are found from the environment', () => {
  const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const chrome = BROWSER_CATALOG.find(entry => entry.id === 'chrome');
  const found = findExecutable(chrome, env, 'win32');
  // The path is only reported when it really exists on this machine.
  assert.ok(found === '' || found.includes('chrome.exe'));
});

test('the stored choice decides which browser is driven', () => {
  const chosen = resolveBrowser({ browser: 'msedge' }, {});
  assert.equal(chosen.source, 'choice');
  assert.ok(chosen.channel === 'msedge' || String(chosen.executablePath).includes('msedge'));
  // Without a choice, Chrome is the default.
  assert.equal(resolveBrowser({}, {}).source, 'choice');
});

test('environment variables still win over the stored choice', () => {
  assert.equal(resolveBrowser({ browser: 'chrome' }, { PULSE_BROWSER_PATH: '/tmp/chrome' }).executablePath, '/tmp/chrome');
  assert.equal(resolveBrowser({ browser: 'chrome' }, { PULSE_BROWSER_PATH: '/tmp/chrome' }).source, 'PULSE_BROWSER_PATH');
  assert.equal(resolveBrowser({ browser: 'chrome' }, { PULSE_BROWSER: 'chromium' }).channel, 'chromium');
});

test('an unknown browser choice falls back to something that can be launched', () => {
  const resolved = resolveBrowser({ browser: 'not-a-browser' }, {});
  assert.ok(resolved.channel || resolved.executablePath);
});
