// Runs ONE scenario inside Electron: `electron test/e2e/run.js <name>.scenario.js` (all.js spawns this).
// A scenario exports { seed?: { relPath: content }, run(ctx) }; ctx = { win, vault, js(code), sleep(ms), afterQuit(fn) }.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scenarioFile = path.resolve(process.argv[2] || '');
const scenario = require(scenarioFile);

// Fresh temp tree per run: never the real ~/Documents/CortexVault, and a private userData so localStorage cannot leak between scenarios.
// all.js passes CORTEX_E2E_TMP and deletes it after this process exits (deleting here stalls ~20s on Windows file locks);
// run directly, the mkdtemp dir is left behind.
const tmp = process.env.CORTEX_E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2e-'));
const vault = path.join(tmp, 'vault');
fs.mkdirSync(vault, { recursive: true });
for (const [rel, content] of Object.entries(scenario.seed || {})) {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
app.setPath('userData', path.join(tmp, 'userData'));
// CI runners (GitHub's windows-latest) have no GPU: Chromium's GPU process crashes until Electron gives up ("GPU process isn't usable")
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
process.env.CORTEX_VAULT = vault;
process.env.CORTEX_E2E = '1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const afterQuitFns = [];
let failed = false;

// 'quit' fires on every exit path (scenario finished, or the scenario closed the window); afterQuit hooks assert on the final disk state.
app.on('quit', () => {
  for (const fn of afterQuitFns) {
    try { fn(); } catch (err) { console.error('AFTER-QUIT FAILED:', err); failed = true; }
  }
  process.exit(failed ? 1 : 0);
});

async function waitFor(check, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await sleep(50);
  }
}

require('../../electron/main.js'); // seeds nothing: the vault dir already exists

app.whenReady().then(async () => {
  try {
    const win = await waitFor(async () => BrowserWindow.getAllWindows()[0], 'the main window');
    win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.error('[renderer]', message); });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    await waitFor(() => js('typeof App !== "undefined" && !!App.vaultPath'), 'App.vaultPath');
    await scenario.run({ win, vault, js, sleep, afterQuit: (fn) => afterQuitFns.push(fn) });
  } catch (err) {
    console.error('SCENARIO FAILED:', err);
    failed = true;
  }
  app.quit();
});
