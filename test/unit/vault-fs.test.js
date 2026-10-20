const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { createVaultFs } = require('../../electron/vault-fs');

function setup(t) {
  const base = fs.mkdtempSync(join(os.tmpdir(), 'cortex-vfs-'));
  const root = join(base, 'v');
  fs.mkdirSync(root);
  const trashed = [];
  const fsx = createVaultFs({ getRoot: () => root, trash: async (p) => { trashed.push(p); } });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root, trashed, fsx };
}

test('list reflects a file written after an earlier list', async (t) => {
  const { root, fsx } = setup(t);
  await fsx.list(root);
  await fsx.write(join(root, 'New.md'), 'x');
  assert.deepEqual((await fsx.list(root)).files.map(f => f.name), ['New.md']);
});

test('list: folders first, then by name, dot-entries hidden', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'b.md'), '');
  fs.writeFileSync(join(root, 'a.md'), '');
  fs.mkdirSync(join(root, 'Z'));
  fs.mkdirSync(join(root, '.cortex'));
  fs.writeFileSync(join(root, '.hidden.md'), '');
  const { files } = await fsx.list(root);
  assert.deepEqual(files.map(f => f.name), ['Z', 'a.md', 'b.md']);
  assert.deepEqual(files[1], { name: 'a.md', isDirectory: false, path: join(root, 'a.md'), ext: 'md' });
  assert.equal(files[0].isDirectory, true);
});

test('list of a missing folder inside the vault is an empty list', async (t) => {
  const { root, fsx } = setup(t);
  assert.deepEqual(await fsx.list(join(root, 'nope')), { success: true, files: [] });
});

test('every list failure still carries files: []', async (t) => {
  const { base, root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  const cases = {
    'outside the vault': await fsx.list(base),
    'empty path': await fsx.list(''),
    'a file listed as a directory (ENOTDIR)': await fsx.list(join(root, 'a.md')),
  };
  for (const [name, r] of Object.entries(cases)) {
    assert.equal(r.success, false, name);
    assert.equal(typeof r.error, 'string', name);
    assert.deepEqual(r.files, [], name);
  }
});

test('every op rejects paths outside the vault', async (t) => {
  const { base, root, fsx } = setup(t);
  const out = join(base, 'out.md');
  fs.writeFileSync(out, 'secret');
  fs.writeFileSync(join(root, 'a.md'), 'a');
  const results = await Promise.all([
    fsx.read(out), fsx.write(out, 'x'), fsx.list(base), fsx.mkdir(join(base, 'newdir')),
    fsx.remove(out), fsx.rename(join(root, 'a.md'), out), fsx.rename(out, join(root, 'b.md')),
    fsx.read(join(root, '..', 'out.md')),
  ]);
  for (const r of results) {
    assert.equal(r.success, false);
    assert.match(r.error, /outside the vault/);
  }
  assert.equal(fs.readFileSync(out, 'utf-8'), 'secret');
  assert.equal(fs.existsSync(join(base, 'newdir')), false);
  assert.equal(fs.existsSync(join(root, 'a.md')), true);
});

test('empty and non-string paths are rejected', async (t) => {
  const { fsx } = setup(t);
  for (const bad of ['', undefined, null, 42, {}]) {
    const r = await fsx.read(bad);
    assert.equal(r.success, false);
    assert.match(r.error, /outside the vault/);
  }
});

test('a sibling directory sharing the root prefix is outside', async (t) => {
  const { base, fsx } = setup(t);
  fs.mkdirSync(join(base, 'v-evil'));
  fs.writeFileSync(join(base, 'v-evil', 'x.md'), 'x');
  assert.match((await fsx.read(join(base, 'v-evil', 'x.md'))).error, /outside the vault/);
});

test('a file whose name merely starts with two dots is inside the vault', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, '..notes.md'), 'ok');
  assert.deepEqual(await fsx.read(join(root, '..notes.md')), { success: true, content: 'ok' });
});

test('remove and rename refuse the vault root itself', async (t) => {
  const { root, trashed, fsx } = setup(t);
  assert.equal((await fsx.remove(root)).success, false);
  assert.equal((await fsx.rename(root, join(root, 'x'))).success, false);
  assert.equal((await fsx.rename(join(root, 'x'), root)).success, false);
  assert.deepEqual(trashed, []);
});

test('read and write refuse the vault root itself; list and mkdir accept it', async (t) => {
  const { root, fsx } = setup(t);
  assert.equal((await fsx.read(root)).success, false);
  assert.equal((await fsx.write(root, 'x')).success, false);
  assert.equal((await fsx.list(root)).success, true);
  assert.equal((await fsx.mkdir(root)).success, true);
});

test('write overwrite:false refuses an existing file and keeps its content', async (t) => {
  const { root, fsx } = setup(t);
  const p = join(root, 'a.md');
  fs.writeFileSync(p, 'old');
  const r = await fsx.write(p, 'new', { overwrite: false });
  assert.equal(r.success, false);
  assert.equal(r.exists, true);
  assert.equal(fs.readFileSync(p, 'utf-8'), 'old');
});

test('write overwrites by default and overwrite:false creates a new file', async (t) => {
  const { root, fsx } = setup(t);
  const p = join(root, 'a.md');
  assert.equal((await fsx.write(p, 'one', { overwrite: false })).success, true);
  assert.equal((await fsx.write(p, 'two')).success, true);
  assert.equal(fs.readFileSync(p, 'utf-8'), 'two');
});

test('rename moves a file', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  assert.equal((await fsx.rename(join(root, 'a.md'), join(root, 'b.md'))).success, true);
  assert.equal(fs.existsSync(join(root, 'a.md')), false);
  assert.equal(fs.readFileSync(join(root, 'b.md'), 'utf-8'), 'a');
});

test('rename refuses an existing destination and leaves both intact', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  fs.writeFileSync(join(root, 'b.md'), 'b');
  const r = await fsx.rename(join(root, 'a.md'), join(root, 'b.md'));
  assert.equal(r.success, false);
  assert.equal(r.exists, true);
  assert.equal(fs.readFileSync(join(root, 'a.md'), 'utf-8'), 'a');
  assert.equal(fs.readFileSync(join(root, 'b.md'), 'utf-8'), 'b');
});

test('rename allows changing only the case of a name', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  assert.equal((await fsx.rename(join(root, 'a.md'), join(root, 'A.md'))).success, true);
  assert.deepEqual((await fsx.list(root)).files.map(f => f.name), ['A.md']);
});

// Windows refuses a folder rename (EPERM/EBUSY) while a file under it is open, e.g. the index reading it for a moment
const busy = (code) => Object.assign(new Error(code + ': resource busy'), { code });

test('rename retries a busy (EPERM/EBUSY) rename and then succeeds', async (t) => {
  const { root, fsx } = setup(t);
  fs.mkdirSync(join(root, 'd'));
  const real = fs.promises.rename;
  let calls = 0;
  t.mock.method(fs.promises, 'rename', async (...args) => {
    calls++;
    if (calls === 1) throw busy('EPERM');
    if (calls === 2) throw busy('EBUSY');
    return real(...args);
  });
  assert.deepEqual(await fsx.rename(join(root, 'd'), join(root, 'e')), { success: true });
  assert.equal(calls, 3);
  assert.ok(fs.statSync(join(root, 'e')).isDirectory());
});

test('rename gives up after 5 busy attempts with the last error', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  let calls = 0;
  t.mock.method(fs.promises, 'rename', async () => { calls++; throw busy('EPERM'); });
  assert.deepEqual(await fsx.rename(join(root, 'a.md'), join(root, 'b.md')), { success: false, error: 'EPERM: resource busy' });
  assert.equal(calls, 5);
});

test('rename fails at once on any other error', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  let calls = 0;
  t.mock.method(fs.promises, 'rename', async () => { calls++; throw busy('EACCES'); });
  assert.deepEqual(await fsx.rename(join(root, 'a.md'), join(root, 'b.md')), { success: false, error: 'EACCES: resource busy' });
  assert.equal(calls, 1);
});

test('remove hands the path to trash and does not unlink', async (t) => {
  const { root, trashed, fsx } = setup(t);
  const p = join(root, 'a.md');
  fs.writeFileSync(p, 'a');
  assert.equal((await fsx.remove(p)).success, true);
  assert.deepEqual(trashed, [p]);
  assert.ok(fs.existsSync(p));
});

test('remove of a missing path succeeds without calling trash', async (t) => {
  const { root, trashed, fsx } = setup(t);
  assert.deepEqual(await fsx.remove(join(root, 'gone.md')), { success: true });
  assert.deepEqual(trashed, []);
});

test('remove reports a trash failure', async (t) => {
  const { root } = setup(t);
  const p = join(root, 'a.md');
  fs.writeFileSync(p, 'a');
  const fsx = createVaultFs({ getRoot: () => root, trash: async () => { throw new Error('no recycle bin'); } });
  assert.deepEqual(await fsx.remove(p), { success: false, error: 'no recycle bin' });
});

test('read of an empty file succeeds with content ""', async (t) => {
  const { root, fsx } = setup(t);
  const p = join(root, 'e.md');
  fs.writeFileSync(p, '');
  assert.deepEqual(await fsx.read(p), { success: true, content: '' });
});

test('read of a missing file fails with an error', async (t) => {
  const { root, fsx } = setup(t);
  const r = await fsx.read(join(root, 'nope.md'));
  assert.equal(r.success, false);
  assert.equal(typeof r.error, 'string');
});

test('write creates missing parent folders', async (t) => {
  const { root, fsx } = setup(t);
  assert.equal((await fsx.write(join(root, 'a/b/c.md'), 'x')).success, true);
  assert.equal(fs.readFileSync(join(root, 'a', 'b', 'c.md'), 'utf-8'), 'x');
});

test('mkdir creates nested folders', async (t) => {
  const { root, fsx } = setup(t);
  assert.equal((await fsx.mkdir(join(root, 'x/y'))).success, true);
  assert.ok(fs.statSync(join(root, 'x', 'y')).isDirectory());
});

test('getRoot is read on every call so switching vaults takes effect', async (t) => {
  const { base, root } = setup(t);
  const other = join(base, 'other');
  fs.mkdirSync(other);
  let current = root;
  const fsx = createVaultFs({ getRoot: () => current, trash: async () => {} });
  assert.equal((await fsx.list(other)).success, false);
  current = other;
  assert.equal((await fsx.list(other)).success, true);
  assert.equal((await fsx.list(root)).success, false);
});

// ---- confinement: other spellings of a path inside the vault, and Windows path syntax that points outside it ----

test('forward-slash spellings of paths inside the vault are accepted', async (t) => {
  const { root, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  fs.mkdirSync(join(root, 'sub'));
  const slashed = (p) => p.split('\\').join('/');
  assert.deepEqual(await fsx.read(slashed(join(root, 'a.md'))), { success: true, content: 'a' });
  assert.equal((await fsx.write(slashed(join(root, 'sub', 'b.md')), 'b')).success, true);
  assert.equal(fs.readFileSync(join(root, 'sub', 'b.md'), 'utf-8'), 'b');
  assert.equal((await fsx.list(slashed(root))).success, true);
});

test('an upper-case spelling of the root is still the root (Windows paths ignore case)', { skip: process.platform !== 'win32' }, async (t) => {
  const { root, trashed, fsx } = setup(t);
  fs.writeFileSync(join(root, 'a.md'), 'a');
  assert.deepEqual(await fsx.read(join(root.toUpperCase(), 'a.md')), { success: true, content: 'a' });
  assert.match((await fsx.read(root.toUpperCase())).error, /vault root/);
  assert.equal((await fsx.remove(root.toUpperCase())).success, false);
  assert.deepEqual(trashed, []);
});

test('Windows path syntax that leaves the vault is refused by every op', { skip: process.platform !== 'win32' }, async (t) => {
  const { base, root, trashed, fsx } = setup(t);
  fs.writeFileSync(join(base, 'out.md'), 'secret');
  fs.writeFileSync(join(root, 'a.md'), 'a');
  const drive = root.slice(0, 2);
  const otherDrive = drive.toUpperCase() === 'Z:' ? 'Y:' : 'Z:';
  const rows = {
    'drive-relative (C:out.md)': drive + 'out.md',
    'UNC path': '\\\\server\\share\\out.md',
    'extended-length prefix (\\\\?\\)': '\\\\?\\' + join(base, 'out.md'),
    'extended-length prefix on a path inside the vault': '\\\\?\\' + join(root, 'a.md'),
    'another drive letter': otherDrive + '\\out.md',
  };
  for (const [name, p] of Object.entries(rows)) {
    const results = await Promise.all([
      fsx.read(p), fsx.write(p, 'x'), fsx.list(p), fsx.mkdir(p), fsx.remove(p),
      fsx.rename(join(root, 'a.md'), p), fsx.rename(p, join(root, 'b.md')),
    ]);
    for (const r of results) {
      assert.equal(r.success, false, name);
      assert.match(r.error, /outside the vault/, name);
    }
  }
  assert.equal(fs.readFileSync(join(base, 'out.md'), 'utf-8'), 'secret');
  assert.equal(fs.readFileSync(join(root, 'a.md'), 'utf-8'), 'a');
  assert.deepEqual(trashed, []);
});

test('remove refuses the vault root however it is spelled', async (t) => {
  const { root, trashed, fsx } = setup(t);
  fs.mkdirSync(join(root, 'sub'));
  const spellings = [root + '/', root + '/.', join(root, 'sub', '..'), root.split('\\').join('/')];
  for (const p of spellings) {
    const r = await fsx.remove(p);
    assert.equal(r.success, false, p);
    assert.match(r.error, /vault root/, p);
  }
  assert.deepEqual(trashed, []);
  assert.ok(fs.existsSync(join(root, 'sub')));
});
