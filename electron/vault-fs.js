const fs = require('fs/promises');
const path = require('path');

const OUTSIDE = 'Path is outside the vault';
const fail = (error, extra) => ({ success: false, error, ...extra });

function createVaultFs({ getRoot, trash }) {
  // shortcut: lexical check only, symlinks inside the vault are followed, upgrade to realpath if vaults are shared
  function confine(p, allowRoot = false) {
    if (typeof p !== 'string' || p === '') return { error: OUTSIDE };
    const abs = path.resolve(p);
    const rel = path.relative(path.resolve(getRoot()), abs);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return { error: OUTSIDE };
    if (rel === '' && !allowRoot) return { error: 'Operation not allowed on the vault root' };
    return { abs };
  }

  // failExtra is merged into every failure result (list uses it to keep `files: []` for callers that skip the success check)
  async function run(p, allowRoot, fn, failExtra) {
    const { abs, error } = confine(p, allowRoot);
    if (error) return fail(error, failExtra);
    try {
      return await fn(abs);
    } catch (err) {
      return fail(err.message, failExtra);
    }
  }

  const exists = (abs) => fs.lstat(abs).then(() => true, () => false);

  return {
    read: (p) => run(p, false, async (abs) => ({ success: true, content: await fs.readFile(abs, 'utf-8') })),

    write: (p, content, opts) => run(p, false, async (abs) => {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      try {
        // 'wx' makes the "must not exist" check atomic
        await fs.writeFile(abs, content, { encoding: 'utf-8', flag: opts?.overwrite === false ? 'wx' : 'w' });
      } catch (err) {
        if (err.code === 'EEXIST') return fail('File already exists', { exists: true });
        throw err;
      }
      return { success: true };
    }),

    list: (dir) => run(dir, true, async (abs) => {
      let items;
      try {
        items = await fs.readdir(abs, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return { success: true, files: [] };
        throw err;
      }
      const files = items
        .filter((item) => !item.name.startsWith('.'))
        .map((item) => ({
          name: item.name,
          isDirectory: item.isDirectory(),
          path: path.join(abs, item.name),
          ext: item.name.includes('.') ? item.name.split('.').pop() : '',
        }));
      files.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
      return { success: true, files };
    }, { files: [] }),

    mkdir: (p) => run(p, true, async (abs) => {
      await fs.mkdir(abs, { recursive: true });
      return { success: true };
    }),

    remove: (p) => run(p, false, async (abs) => {
      if (!(await exists(abs))) return { success: true };
      await trash(abs);
      return { success: true };
    }),

    rename: async (from, to) => {
      const src = confine(from);
      const dst = confine(to);
      if (src.error || dst.error) return fail(src.error || dst.error);
      // shortcut: case-insensitive name compare is Windows-only, revisit if a non-Windows target is added
      const caseOnly = src.abs.toLowerCase() === dst.abs.toLowerCase();
      try {
        if (!caseOnly && (await exists(dst.abs))) return fail('Destination already exists', { exists: true });
        // Windows refuses a folder rename while a file under it is open (e.g. the index reading it): give it a moment
        for (let attempt = 1; ; attempt++) {
          try {
            await fs.rename(src.abs, dst.abs);
            return { success: true };
          } catch (err) {
            if (attempt >= 5 || (err.code !== 'EPERM' && err.code !== 'EBUSY')) throw err;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

module.exports = { createVaultFs };
