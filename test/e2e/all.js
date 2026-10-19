// `npm run test:e2e`: runs every test/e2e/*.scenario.js in its own Electron process; stops at the first failure.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron'); // from plain Node this is the path of the electron binary

const TIMEOUT_MS = 30000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2e-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // would make electron.exe behave as plain Node

function runScenario(file) {
  return new Promise((resolve) => {
    const tmp = path.join(base, path.basename(file, '.scenario.js'));
    const child = spawn(electron, [path.join(__dirname, 'run.js'), file], { stdio: 'inherit', env: { ...env, CORTEX_E2E_TMP: tmp } });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`TIMEOUT after ${TIMEOUT_MS / 1000}s: ${path.basename(file)}`);
      // kill the whole tree: Electron's renderer/GPU processes must not outlive a hung run
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); console.error(err); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0 && !timedOut); });
  });
}

(async () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.scenario.js')).sort();
  let failedFile = null;
  for (const f of files) {
    console.log(`\n--- e2e: ${f}`);
    if (!(await runScenario(path.join(__dirname, f)))) { failedFile = f; break; }
    console.log(`PASS ${f}`);
  }
  // the Electron process has exited, so its userData files are unlocked now
  try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }); } catch (err) { console.error('temp cleanup failed:', err.message); }
  if (failedFile) { console.error(`FAIL ${failedFile}`); process.exit(1); }
  console.log(`\n${files.length} e2e scenario(s) passed`);
})();
