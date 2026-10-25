import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

// Windows PowerShell writes UTF-8 files with a byte order mark. The saved
// browser choice has to survive that, or the user silently gets Chrome again.
test('a browser choice saved with a byte order mark is still read', { timeout: 60000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pulse-browser-'));
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'browser.json'), '\uFEFF{"browser":"msedge","executablePath":""}', 'utf8');
  const port = 8123 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC,
    env: { ...process.env, PULSE_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', PULSE_PREVIEW: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  try {
    let state = null;
    for (let attempt = 0; attempt < 60 && !state; attempt++) {
      try { const response = await fetch(`http://127.0.0.1:${port}/api/state`); if (response.ok) state = await response.json(); } catch { /* not up yet */ }
      if (!state) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(state, `the companion did not start: ${log.join('')}`);
    assert.equal(state.browserChoice.browser, 'msedge', 'the saved choice was read despite the byte order mark');
    assert(Array.isArray(state.browsers) && state.browsers.length >= 4, 'the browsers are listed for the picker');
    assert.deepEqual(state.extraMarkers, ['&', '8']);
  } finally {
    child.kill('SIGTERM');
    await rm(dataDir, { recursive: true, force: true });
  }
});
