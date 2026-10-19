# Cortex Enrichment & Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Cortex from a demo-grade notes app into a reliable, fast, local-first second brain: fix what is broken, replace the N+1 vault scans with one live index, then build real backlinks/graph/search, a safe Markdown pipeline and an undo-safe editor on top of it.

**Architecture:** Main process owns the filesystem (confined, async, no cache) and a single in-memory `VaultIndex` kept fresh by `fs.watch`; the renderer asks the index for notes/backlinks/tags/graph/search over IPC instead of walking the vault. Pure logic (names, dates, note parsing, Markdown, editor edits) lives in `src/lib/*.js`, loadable by both Node tests and the renderer.

**Tech Stack:** Electron 28.3.3, plain JS (classic `<script>`s, no bundler), `node:test` (Node v24.20.0), `marked` (Task 10 only).

**Spec:** this document, § Workspace Analysis (derived from the request "analyze the workspace and suggest the best possible builds for feature-enrichment and optimization"; no separate spec exists).

## Workspace Analysis (the spec)

One project: `cortex/` — Electron "Obsidian alternative", ~138 KB of hand-written code (`src/js/app.js` 50 KB, five plugins 39 KB, CSS 25 KB, `electron/` 10 KB). **No tests, no git.** **V** = reproduced by running code this session; **R** = read in source.

| # | Finding | Evidence | Fixed in |
|---|---|---|---|
| F1 | **V** `prompt()` throws in Electron 28.3.3 ("prompt() is and will not be supported") → New File (Ctrl+N), New Folder, Rename and TaskFlow "Add" are all dead | `app.js:355,366,380`, `taskflow/plugin.js:117-119` | T2 |
| F2 | **V** `list:` cache keys never match `invalidateCache` → created/renamed/deleted files stay invisible in the tree for up to 30 s | `main.js:24-30` vs `135,151` | T1 (cache deleted) |
| F3 | **R** Create and rename silently overwrite existing notes (`writeFile` without exists check; `renameSync` replaces on Windows) | `app.js:359`, `main.js:179` | T1, T2 |
| F4 | **R** Every IPC handler trusts any path from the renderer; `open-external` accepts any URL | `main.js:110-186,260` | T1 |
| F5 | **R** Preview escapes only `& < >`, not quotes → attribute injection (`[x](a" onmouseover="…)`) runs script with full `window.cortex` (unconfined file write); no CSP | `app.js:697,714-715`, `index.html` | T1 (confinement), T10 |
| F6 | **R** Graph never draws edges (nodes keyed `Name.md`, links are `[[Name]]`), simulation runs forever, a click listener is added on every open, graph stays on screen when another panel is chosen | `app.js:954-964,1032-1055,775-800` | T8 |
| F7 | **R** "Backlinks" = full-text search of the file name; Tags panel opens only the first match; Welcome/DataForge stats read files after rendering (tags always 0, nested notes missed) | `app.js:875,839-844,128-170`, `dataforge:113-137` | T8 |
| F8 | **R** N+1 IPC: `cacheAllNotes` (every `openFile`), `initGraph` (every open and resize), welcome stats, DataForge stats each walk and read the whole vault sequentially; `search-files` re-reads the vault synchronously per query | `app.js:301,553,910`, `main.js:188-212` | T5–T8 |
| F9 | **R** Welcome's "Open Daily Note" writes to `undefined/Daily Notes/…` (`this.app` is not defined on `App`); all dates use UTC, so 00:00–03:00 in UTC+3 is "yesterday" | `app.js:174`, 8 `toISOString().split('T')[0]` | T3 |
| F10 | **R** Tab click resolves by file *name* (duplicate names collide); save results ignored; pending 500 ms autosave lost on close; no dirty indicator; `autosave:false` would make Ctrl+S a no-op | `app.js:679-680,591-594` | T4 |
| F11 | **R** Regex Markdown: task lists never render (list rule eats `- [ ]`), tables lack `<table>`, `_`/`*` mangle snake_case and bullets, preview wikilinks have no click handler, `target=_blank` opens a bare Electron window | `app.js:695-732` | T10, T11 |
| F12 | **R** Assigning `textarea.value` discards native undo (Tab, slash commands, wikilink insert); no list continuation or Ctrl+B/I | `app.js:523-551,643-650` | T12 |
| F13 | **R** Plugins: data only in `localStorage`; TaskFlow Edit/Delete/"+ Add", DataForge "Insert Template", DailySync habit checkboxes, `btnSettings`, `btnGraphRefresh` have no handlers; DataForge ignores `status:`/`created:` and its textarea markup is malformed (`dataforge:36-40`); Recall's "SM-2" is a fixed ×2.5 and "Hard" counts as failure; DailySync header is hard-coded "October 2026"; FocusPulse stops on panel close and re-renders "25:00" in break mode; closed panels leak DOM | plugin files | Roadmap B4 |
| F14 | **R** `src/assets/icon.png` is referenced but only `icon.svg` exists; fonts load from Google (offline = fallback fonts); Electron 28 is many majors behind; `get-recent-files`, `batch-read`, `select-vault` have no renderer callers; duplicate focus/layout CSS in `main.css:416-426` and `plugins.css:77-81` | `package.json:33`, `index.html:7-9` | T1 (dead IPC), Roadmap B5 |

README promises not delivered: syntax highlighting, explorer drag-and-drop, SM-2, real backlinks, graph connections, "Dataview" queries.

## Recommended builds

| Build | Theme | Why this order | Tasks | Size |
|---|---|---|---|---|
| **1** | Make the core work | Notes cannot be created from the UI today; two data-loss paths | 1–4 | M |
| **2** | One live vault index | Removes F8 and unlocks real backlinks/graph/search/rename-safety; everything later reads from it | 5–9 | L |
| **3** | Safe Markdown + editor | Closes F5/F11/F12; needs Build 2 for wikilink resolution | 10–12 | M |
| **4** | Plugins that deliver | Roadmap only — plan after Build 2 ships (needs the index API) | — | L |
| **5** | Ship & polish | Roadmap only | — | M |

Execute 1 → 2 → 3 in order; each build ends in a working app. Builds 4–5 are outlined at the end and get their own plans.

## Global Constraints

- Electron stays at `28.3.3` until Build 5; `contextIsolation: true` and `nodeIntegration: false` unchanged.
- No bundler or transpiler: renderer code is classic `<script>` files loaded from `src/index.html`. Shared pure modules in `src/lib/` export via `module.exports` when `module` is defined, else onto `window.CortexLib` (`Object.assign(window.CortexLib || {}, api)`).
- Unit tests: `npm test` → `node --test "test/unit/*.test.js"` (glob form is required on Node v24.20.0; the directory form fails). E2E: `npm run test:e2e`.
- Only new dependency in Builds 1–3: `marked` (Task 10).
- Every renderer-supplied path must resolve inside the current vault root, else `{ success: false, error: 'Path is outside the vault' }`.
- IPC results keep the shape `{ success: boolean, error?: string, … }`.
- Dates are the local calendar day via `CortexLib.localDateStr`; never `toISOString().split('T')[0]`.
- Target is Windows only (`electron-builder --win portable`); recursive `fs.watch` relies on that.
- In `src/index.html`, `src/lib/*.js` scripts load before the plugin scripts, which load before `js/app.js`.
- Entries whose name starts with `.` are never listed or indexed.
- User-controlled text (file names, tags, snippets) goes into the DOM via `textContent`/escaping, never raw into `innerHTML`.
- Commits: conventional-commit subject; end every message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies that no feature test would naturally cover, most likely first. Each is pinned by a test in its owning task.

1. **Create/rename onto an existing note must never overwrite** (user expects: refuse, or open the existing note). → T1 `rename refuses an existing destination…`, T2 scenario "existing name opens, content intact".
2. **A failed save (read-only file, vault switched under open tabs) must surface and keep the tab dirty.** → T4 scenarios `failed save`, `vault switch`.
3. **Non-ASCII note names** (Turkish `Çalışma.md`, `#çalışma`) resolve in wikilinks, tags, backlinks. → T5 `tags keep non-ASCII and nested`, T6 `resolve is case-insensitive for non-ASCII`.
4. **Switching vaults while the index is still scanning must not mix vaults.** → T6 `reset(B) during reset(A) leaves only B`.
5. **Files that vanish or are half-written when the watcher fires** (OneDrive sync, temp files) must not throw or crash the main process. → T6 `update: changed refreshes tags; … never throws`, T7 scenario deletes a file under watch.

## File Structure

| File | Responsibility |
|---|---|
| `electron/vault-fs.js` (new) | Confined async fs ops, no cache, trash on delete |
| `electron/security.js` (new) | `isSafeExternalUrl` |
| `electron/vault-index.js` (new) | In-memory index: notes, resolve, backlinks, tags, graph, search |
| `electron/main.js`, `preload.js` | Thin IPC; window lifecycle; watcher |
| `src/lib/names.js`, `dates.js`, `note-parse.js`, `markdown.js`, `editor-edits.js` (new) | Pure, unit-tested logic |
| `src/js/dialogs.js` (new) | In-app text prompt (`Dialogs.ask`) |
| `src/js/app.js`, plugins | UI glue; shrinks as logic moves out |
| `test/unit/*.test.js`, `test/e2e/{run,all}.js`, `test/e2e/*.scenario.js` (new) | Tests |

---

# Build 1 — Make the core work

### Task 1: Confined async vault filesystem

**Files:**
- Create: `.gitignore` (`node_modules/`, `dist/`), `electron/vault-fs.js`, `electron/security.js`, `test/unit/vault-fs.test.js`, `test/unit/security.test.js`
- Modify: `electron/main.js` (delete cache code `8-30` and unused `watcher`; replace handlers `108-186` with `vaultFs` delegates; delete the dead handlers `214-258` (`get-recent-files`, `batch-read`, `select-vault`); keep `search-files` until Task 8 but read files directly instead of `getCached` at `198`), `electron/preload.js` (drop `getRecentFiles`, `batchRead`, `selectVault` and the unused `cache`; `writeFile(p, c, opts)` passes `opts` through), `package.json` (`"test": "node --test \"test/unit/*.test.js\""`)

**Interfaces:**
- Produces: `createVaultFs({ getRoot: () => string, trash: (absPath: string) => Promise<void> })` → `{ read(p), write(p, content, opts?: { overwrite?: boolean }), list(dir), mkdir(p), remove(p), rename(from, to) }`, all async. Results: `{ success: true, … } | { success: false, error: string, exists?: true }`; `read` → `content: string`; `list` → `files: { name, isDirectory, path, ext }[]` (folders first, then `localeCompare`; dot-entries omitted).
- Produces: `isSafeExternalUrl(url: string): boolean` — true only for `http:`, `https:`, `mailto:`.
- Produces: `main.js` exports `setVault(absPath: string): void` (sets root, sends `vault:changed`); used by the "Open Vault" menu item.

- [ ] **Step 1: Baseline commit.** `git init`, add `.gitignore`, `git add -A`, commit `chore: baseline before enrichment work`.
- [ ] **Step 2: Write the failing tests.** `vault-fs.test.js` uses `fs.mkdtempSync` → `base`, `root = base/v`, a `trashed` array and fake `trash`:

```js
test('list reflects a file written after an earlier list', async () => {
  await fsx.list(root); await fsx.write(join(root, 'New.md'), 'x');
  assert.deepEqual((await fsx.list(root)).files.map(f => f.name), ['New.md']);
});
test('list: folders first, then by name, dot-entries hidden', async () => { /* b.md a.md Z/ .cortex/ */
  assert.deepEqual(names, ['Z', 'a.md', 'b.md']); });
test('every op rejects paths outside the vault', async () => {
  for (const r of await Promise.all([fsx.read(out), fsx.write(out, 'x'), fsx.list(out), fsx.mkdir(out), fsx.remove(out), fsx.rename(join(root, 'a.md'), out)]))
    assert.match(r.error, /outside the vault/); });
test('a sibling directory sharing the root prefix is outside', async () => { // base/v-evil/x.md
  assert.match((await fsx.read(join(base, 'v-evil', 'x.md'))).error, /outside the vault/); });
test('remove and rename refuse the vault root itself', async () => {
  assert.equal((await fsx.remove(root)).success, false); assert.equal((await fsx.rename(root, join(root, 'x'))).success, false); });
test('write overwrite:false refuses an existing file and keeps its content', async () => {
  const r = await fsx.write(p, 'new', { overwrite: false }); assert.equal(r.exists, true); assert.equal(read(p), 'old'); });
test('rename refuses an existing destination and leaves both intact', async () => { /* a.md, b.md */ assert.equal(r.exists, true); });
test('remove hands the path to trash and does not unlink', async () => { assert.deepEqual(trashed, [p]); assert.ok(fs.existsSync(p)); });
test('read of an empty file succeeds with content ""', async () => { assert.deepEqual(await fsx.read(p), { success: true, content: '' }); });
test('write creates missing parent folders', async () => { assert.equal((await fsx.write(join(root, 'a/b/c.md'), 'x')).success, true); });
```

`security.test.js`: `https://a.b`, `mailto:a@b.c` → true; `javascript:alert(1)`, `file:///c:/x`, `cmd:/c calc`, `not a url`, `''` → false.
- [ ] **Step 3: Run `npm test` — expect FAIL** ("Cannot find module …vault-fs").
- [ ] **Step 4: Implement `electron/vault-fs.js` and `electron/security.js`.** Confinement: `path.relative(root, path.resolve(p))` must not start with `..` or be absolute; root itself is allowed only for `list`/`mkdir`. Use `fs.promises`. Add the comment `shortcut: lexical check only, symlinks inside the vault are followed, upgrade to realpath if vaults are shared`.
- [ ] **Step 5: Rewire `main.js`/`preload.js`.** Handlers delegate to `vaultFs`; `delete-file` passes `shell.trashItem` as `trash`; `open-external` guards with `isSafeExternalUrl`; "Open Vault" menu calls `setVault`; remove the now-dead `get-recent-files`, `batch-read`, `select-vault` handlers.
- [ ] **Step 6: Run `npm test` — expect all PASS; run `npm start` — Explorer lists `Welcome.md`, no console errors.**
- [ ] **Step 7: Commit** `fix: confine vault IO, drop stale cache, trash on delete`.

### Task 2: In-app dialogs, safe creation, e2e harness

**Files:**
- Create: `src/lib/names.js`, `src/js/dialogs.js`, `test/unit/names.test.js`, `test/e2e/run.js`, `test/e2e/all.js`, `test/e2e/create-note.scenario.js`
- Modify: `electron/main.js` (env `CORTEX_VAULT` overrides the default vault path; `show: process.env.CORTEX_E2E !== '1'`), `src/index.html` (ask overlay `#askOverlay` with `#askInput`; script tags before `app.js`), `src/css/main.css`, `src/js/app.js:354-388` (createFile/createFolder/renameFile), `src/plugins/taskflow/plugin.js:116-129` (title via `Dialogs.ask`, column `todo`, priority `medium`), `package.json` (`"test:e2e": "node test/e2e/all.js"`)

**Interfaces:**
- Consumes: `cortex.writeFile(path, content, { overwrite: false }) → { success, exists? }` (T1).
- Produces: `CortexLib.normalizeName(input: string, ext: string): { ok: true, name: string } | { ok: false, error: string }`.
- Produces: `Dialogs.ask({ title: string, value?: string, placeholder?: string }): Promise<string | null>` — Enter/OK resolves the trimmed text, Esc/cancel/overlay click resolves `null`.
- Produces (e2e contract): a scenario module exports `{ seed?: Record<relPath, string>, run(ctx) }` where `ctx = { win, vault, js(code), sleep(ms), afterQuit(fn) }`. `run.js` creates a temp vault, writes `seed`, sets `CORTEX_VAULT` and `CORTEX_E2E=1`, requires `electron/main.js`, waits for `App.vaultPath` in the renderer, runs the scenario; `afterQuit(fn)` runs `fn` synchronously on app `quit` (a throw → exit code 1). `all.js` spawns `electron test/e2e/run.js <file>` per `test/e2e/*.scenario.js` and exits non-zero on the first failure.

- [ ] **Step 1: Write the failing tests.** `names.test.js`:

```js
const n = (s, e = '.md') => normalizeName(s, e);
test('adds .md once', () => { assert.equal(n('Idea').name, 'Idea.md'); assert.equal(n('Idea.md').name, 'Idea.md'); });
test('trims; keeps subfolders', () => { assert.equal(n('  spaced  ').name, 'spaced.md'); assert.equal(n('Projects/Plan').name, 'Projects/Plan.md'); });
test('accepts non-ASCII', () => assert.equal(n('Çalışma notları').name, 'Çalışma notları.md'));
test('folder names use ext ""', () => assert.equal(n('Archive', '').name, 'Archive'));
test('rejects traversal, illegal chars, reserved names, empty, trailing dot', () => {
  for (const bad of ['../x', 'a/../b', 'a:b', 'a|b', 'a?b', 'a\\b', 'CON', 'nul.md', '', '   ', 'x.']) assert.equal(n(bad, bad === 'x.' ? '' : '.md').ok, false, bad);
});
```

`create-note.scenario.js` (seed `Welcome.md`): call `App.createFile()` without awaiting, set `#askInput` to `Test Note`, dispatch Enter → assert `<vault>/Test Note.md` exists and starts with `# Test Note`, the tab is active, and `#fileTree` text contains `Test Note.md` (stale-cache regression). Then create `Welcome` again → `Welcome.md` content unchanged and it becomes the active tab.
- [ ] **Step 2: Run `npm test` — expect FAIL (names); build the harness; run `npm run test:e2e` — expect FAIL (`Dialogs` undefined).**
- [ ] **Step 3: Implement `normalizeName` (pure) and `Dialogs.ask` (overlay, focus trap on the input, Esc cancels).**
- [ ] **Step 4: Rewire `createFile` (uses `overwrite:false`; on `exists` open the existing note), `createFolder`, `renameFile` (validate via `normalizeName`, ext `''`, refuse when the destination exists) and TaskFlow `addTask`.**
- [ ] **Step 5: Run `npm test` and `npm run test:e2e` — expect PASS.**
- [ ] **Step 6: Commit** `fix: replace unsupported prompt(), never overwrite on create/rename; add e2e harness`.

### Task 3: Local dates and a single daily-note opener

**Files:**
- Create: `src/lib/dates.js`, `test/unit/dates.test.js`, `test/e2e/daily-note.scenario.js`
- Modify: `src/index.html` (script), `src/js/app.js:172-185` (replace `openDailyFromWelcome` with `openDailyNote`; Welcome button calls it), `src/plugins/dailysync/plugin.js` (date calls at `98,109,115,125,134`; `openTodayNote` → `this.app.openDailyNote()`; `createNote` uses `overwrite:false` and, when the note exists, opens it and leaves the textarea untouched), `src/plugins/recall/plugin.js:34,117`

**Interfaces:**
- Produces: `CortexLib.localDateStr(d?: Date): string` → `YYYY-MM-DD` in local time.
- Produces: `App.openDailyNote(): Promise<void>` — opens `<vault>/Daily Notes/<localDateStr()>.md`, creating it from the existing template if absent, never rewriting an existing note.

- [ ] **Step 1: Write the failing tests.** `dates.test.js` (first line `process.env.TZ = 'Europe/Istanbul'`):

```js
test('uses the local calendar day, not UTC', () => assert.equal(localDateStr(new Date('2026-10-19T22:30:00Z')), '2026-10-20'));
test('zero-pads month and day', () => assert.equal(localDateStr(new Date(2026, 0, 5, 12)), '2026-01-05'));
test('defaults to now', () => assert.match(localDateStr(), /^\d{4}-\d{2}-\d{2}$/));
```

`daily-note.scenario.js`: `await App.openDailyNote()` → file at `<vault>/Daily Notes/<date from CortexLib.localDateStr()>.md` exists, no `undefined` directory under `process.cwd()`; overwrite its content with `EDITED`, call again → content still `EDITED`.
- [ ] **Step 2: Run both suites — expect FAIL.**
- [ ] **Step 3: Implement `localDateStr`; add `openDailyNote` (exclusive create, then `openFile`); replace the 8 UTC call sites; delete `DailySync.openTodayNote`'s duplicate logic.**
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `fix: local-day dates, single non-destructive daily-note opener`.

### Task 4: Save integrity and tab identity

**Files:**
- Create: `test/e2e/save-integrity.scenario.js`, `test/e2e/close-flush.scenario.js`
- Modify: `src/js/app.js` (`renderTabs 315-327`, `onTabClick 674-683`, `saveFile 591-594`, `onGlobalKeydown` Ctrl+S `658-662`, `setupMenuListeners 63-69`), `src/index.html` (add `<span id="statusbarError">` to the status bar's left group), `electron/main.js` (`close` interception, `requestFlush`, async `setVault`), `electron/preload.js` (`onFlush`), `src/css/main.css` (`.editor-tab.modified::after` dot, `#statusbarError`)

**Interfaces:**
- Consumes: `setVault` (T1), e2e contract (T2).
- Produces: `cortex.onFlush(cb: () => Promise<void>)` — main sends `app:flush`, renderer awaits `cb()` then replies `app:flushed`.
- Produces (main): `requestFlush(): Promise<void>` (resolves on ack or after 3 s); `setVault(absPath): Promise<void>` now awaits `requestFlush()` before switching root; the window `close` event is held until a flush completes.
- Produces: `App.flushSaves(): Promise<boolean>` — saves every dirty tab, `true` only if all writes succeeded. `tab.modified` means "not yet on disk"; it is cleared only after `writeFile` returns `success`.

- [ ] **Step 1: Write the failing e2e scenarios.**
  - `save-integrity`, **tabs by path** (seed `a/Notes.md`, `b/Notes.md`): open both, click the first `.editor-tab` → `App.activeTab` is the `a/` path.
  - **failed save** (seed `Locked.md`): open it, `fs.chmodSync(file, 0o444)`, set the textarea value and dispatch `input`, `await App.flushSaves()` → `false`; `tab.modified === true`; `#statusbarError` text contains `Save failed`; restore mode in `finally`.
  - **vault switch** (seed `X.md`): open it, `await require('../../electron/main.js').setVault(otherTmpDir)` → `App.openTabs.length === 0` and `App.vaultPath === otherTmpDir`.
  - `close-flush`: open a note, set the textarea to `typed-just-now` and dispatch `input`, call `win.close()` immediately; in `afterQuit`, assert the file on disk contains `typed-just-now`.
- [ ] **Step 2: Run `npm run test:e2e` — expect FAIL on all four.**
- [ ] **Step 3: Implement.** Tabs carry `data-path`; `onTabClick` reads it. `saveFile` drops the `settings.autosave` guard, checks `success`, sets the error status on failure. `flushSaves` cancels pending debounces and awaits writes. Renderer `vault:changed` closes all tabs and calls `showWelcome()`. Main holds `close` with a `flushed` flag.
- [ ] **Step 4: Run `npm run test:e2e` and `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `fix: surface save failures, flush on close/vault switch, key tabs by path`.

---

# Build 2 — One live vault index

### Task 5: Note parser

**Files:**
- Create: `src/lib/note-parse.js`, `test/unit/note-parse.test.js`

**Interfaces:**
- Produces: `CortexLib.normalizeStem(s: string): string` → `s.normalize('NFC').toLowerCase().trim()`.
- Produces: `CortexLib.parseNote(content: string): { frontmatter: Record<string, string | string[]>, title: string, headings: { level: number, text: string }[], tags: string[], links: { target: string, alias: string | null, heading: string | null, line: number }[] }` — `line` is 0-based; tags are de-duplicated case-insensitively keeping first-seen casing; frontmatter `tags` are merged into `tags`; `title` is the first `# ` heading or `''`.

- [ ] **Step 1: Write the failing tests.**

```js
const p = parseNote;
test('wikilink forms', () => {
  assert.deepEqual(p('[[A]] [[B|x]] [[C#H]] ![[D]]').links.map(l => [l.target, l.alias, l.heading]),
    [['A', null, null], ['B', 'x', null], ['C', null, 'H'], ['D', null, null]]); });
test('same-note [[#H]] and empty [[]] links are skipped', () => assert.deepEqual(p('[[#H]] [[]]').links, []));
test('link line numbers are 0-based and CRLF-safe', () => assert.equal(p('a\r\nb [[X]]').links[0].line, 1));
test('code fences (``` and ~~~) and inline code hide links and tags', () => {
  const r = p('~~~\n[[In]] #in\n~~~\n`[[Also]] #also` [[Out]] #out');
  assert.deepEqual(r.links.map(l => l.target), ['Out']); assert.deepEqual(r.tags, ['out']); });
test('tags: dedupe case-insensitively, first casing wins', () => assert.deepEqual(p('#Project #project').tags, ['Project']));
test('tags keep non-ASCII and nested', () => assert.deepEqual(p('#çalışma #a/b').tags, ['çalışma', 'a/b']));
test('# heading and #123 are not tags; url fragments are not tags', () => assert.deepEqual(p('# Title\n#123 http://x/#frag').tags, []));
test('frontmatter: inline list, block list, scalar; merges tags', () => {
  const r = p('---\ntags: [a, b]\nstatus: "active"\naliases:\n  - X\n---\n# T #c');
  assert.deepEqual(r.frontmatter, { tags: ['a', 'b'], status: 'active', aliases: ['X'] }); assert.deepEqual(r.tags, ['a', 'b', 'c']); });
test('unclosed frontmatter is treated as body', () => assert.deepEqual(p('---\ntags: [a]\n').frontmatter, {}));
test('BOM is stripped; title and headings', () => { const r = p('\uFEFF# T\n## S'); assert.equal(r.title, 'T'); assert.deepEqual(r.headings, [{ level: 1, text: 'T' }, { level: 2, text: 'S' }]); });
test('normalizeStem folds case and Unicode form (decomposed C+cedilla == precomposed ç)', () =>
  assert.equal(normalizeStem('C\u0327alışma'), normalizeStem('çalışma')));
```
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement `parseNote` as a single pass over lines (fence-aware), then regexes for links (`/!?\[\[([^\]\n]+)\]\]/g`) and tags (`/(?:^|\s)#([\p{L}\p{N}_\-\/]+)/gu`, rejecting all-digit tags); minimal YAML subset for frontmatter.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: note parser (links, tags, headings, frontmatter)`.

### Task 6: `VaultIndex`

**Files:**
- Create: `electron/vault-index.js`, `test/unit/vault-index.test.js`

**Interfaces:**
- Consumes: `parseNote`, `normalizeStem` via `require('../src/lib/note-parse.js')`.
- Produces: `class VaultIndex` with `NoteMeta = { path: string, name: string, stem: string, mtimeMs: number, title: string, tags: string[], links: ParsedLink[], words: number }`:
  - `reset(root: string): Promise<void>` — clears, scans with 16 concurrent reads, skips dot-directories, non-`.md`, and unreadable entries (including a *directory* named `x.md`); a newer `reset` makes an in-flight older one discard its results.
  - `update(absPath: string): Promise<'added' | 'changed' | 'removed' | 'ignored'>` — never throws.
  - `notes(): NoteMeta[]`, `resolve(target: string): NoteMeta | null` (normalized-stem match; ties → shortest path, then alphabetical)
  - `backlinks(absPath): { path: string, stem: string, line: number, text: string }[]` (links that *resolve* to `absPath`; self excluded; `text` = the source line)
  - `tags(): { tag: string, count: number, paths: string[] }[]` (count desc, then tag)
  - `graph(): { nodes: { id: string, label: string }[], edges: { source: string, target: string }[] }` (ids are absolute paths; edges de-duplicated; self-links and unresolved targets dropped)
  - `search(query: string, limit = 50): { path: string, stem: string, snippet: string, score: number }[]` (all terms must match, case-insensitive; stem/title hit outranks heading outranks body; `''` → `[]`)

- [ ] **Step 1: Write the failing tests** (temp vault helper `mk({ 'a/Dup.md': … })`):

```js
test('reset indexes nested .md; ignores .txt, dot-dirs and a directory named weird.md', async () => {
  assert.deepEqual(idx.notes().map(n => n.name).sort(), ['Dup.md', 'Welcome.md']); });
test('resolve is case-insensitive for non-ASCII', () => assert.equal(idx.resolve('çalışma').name, 'Çalışma.md'));
test('resolve: duplicate stems pick the shortest path', () => assert.equal(idx.resolve('Dup').path, join(root, 'a/Dup.md')));
test('backlinks: alias and heading forms count, self excluded, line text returned', () => {
  assert.deepEqual(idx.backlinks(welcome).map(b => [b.stem, b.line, b.text]), [['Ref', 2, 'see [[Welcome|home]]']]); });
test('graph: deduped edges, unresolved dropped', () => assert.equal(idx.graph().edges.length, 1));
test('update: changed refreshes tags; removed drops backlinks; unknown/non-md is ignored; never throws', async () => {
  assert.equal(await idx.update(join(root, 'nope.md')), 'ignored'); assert.equal(await idx.update(join(root, 'x.txt')), 'ignored'); });
test('tags(): counts and order', () => assert.deepEqual(idx.tags().map(t => [t.tag, t.count]), [['alpha', 2], ['beta', 1]]));
test('search: AND terms, title outranks body, snippet contains the term, empty query', () => { assert.equal(res[0].stem, 'Meeting'); assert.match(res[0].snippet, /meeting/i); assert.deepEqual(idx.search(''), []); });
test('reset(B) during reset(A) leaves only B', async () => { const a = idx.reset(bigVaultA); await idx.reset(vaultB); await a; assert.deepEqual(idx.notes().map(n => n.name), ['B.md']); });
test('empty vault: all queries return empty results', () => assert.deepEqual(idx.graph(), { nodes: [], edges: [] }));
test('scale smoke: 2000 small notes index in under 10 s', async () => { const t = Date.now(); await idx.reset(big); assert.equal(idx.notes().length, 2000); assert.ok(Date.now() - t < 10000); });
```
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement.** Keep `content` per note in memory for `search` and add `// shortcut: whole vault kept in memory, upgrade to an on-disk index if vaults exceed ~100 MB`. Generation counter for the `reset` race. `update` stats the file: missing → remove; `.md` and readable → parse.
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: in-memory vault index with backlinks, tags, graph, search`.

### Task 7: Watcher and index IPC

**Files:**
- Create: `test/e2e/index-live.scenario.js`
- Modify: `electron/main.js`, `electron/preload.js`

**Interfaces:**
- Consumes: `VaultIndex` (T6), `setVault` (T4).
- Produces (IPC, all awaiting the initial scan): `index:notes`, `index:resolve(target)`, `index:backlinks(absPath)`, `index:tags`, `index:graph`, `index:search(query, limit?)`.
- Produces (preload): `cortex.index = { notes(), resolve(t), backlinks(p), tags(), graph(), search(q, limit?), onUpdated(cb), onFileChanged(cb) }`; `onUpdated`/`onFileChanged` return an unsubscribe function. `vault:index-updated` is debounced 150 ms; `vault:file-changed` carries the absolute path.
- Produces (main): index is `reset` on app ready and inside `setVault`; `fs.watch(root, { recursive: true })` with a 100 ms per-path debounce calls `index.update`; `ignored` results emit nothing; watcher `error` is logged, never thrown; the watcher is closed on vault switch and quit.

- [ ] **Step 1: Write the failing scenario** (seed `Welcome.md`): register `window.__upd = 0; cortex.index.onUpdated(() => __upd++)`; from Node write `Fresh.md` containing `[[Welcome]] #t`; poll ≤ 3 s until `cortex.index.notes()` has 2 entries; assert `backlinks(Welcome.md)` lists `Fresh`, `tags()` includes `t`, `__upd > 0`; delete `Fresh.md` while watched → poll until 1 entry and no exception in the main process.
- [ ] **Step 2: Run `npm run test:e2e` — expect FAIL (`cortex.index` undefined).**
- [ ] **Step 3: Implement the IPC handlers, watcher and preload bridge as specified.** Add `// shortcut: full notes() payload on each update, upgrade to deltas past ~5k notes`; `// fs.watch recursive: Windows/macOS only`.
- [ ] **Step 4: Run `npm run test:e2e` — expect PASS.**
- [ ] **Step 5: Commit** `feat: live vault index over IPC`.

### Task 8: Renderer on the index

**Files:**
- Create: `test/e2e/panels.scenario.js`
- Modify: `src/js/app.js` (`cacheAllNotes/extractAllTags/extractTags 553-589` deleted; `showWikilinkAutocomplete`, `updateWelcomeStats`, `renderSearchPanel`, `renderTagsPanel`, `renderBacklinks`, graph `894-1056`, `updatePanelContent/togglePanel 760-800`, `switchTab`, `openFile` drops `cacheAllNotes()`), `src/plugins/dataforge/plugin.js:113-137`, `electron/main.js` + `preload.js` (delete `search-files` / `searchFiles` once grep shows no callers), `src/css/main.css`

**Interfaces:**
- Consumes: `cortex.index.*` (T7).
- Produces: `App.refreshIndex(): Promise<void>` filling `App._notes: NoteMeta[]`, `App._tags: {tag,count,paths}[]`, `App._stemSet: Set<string>` (normalized stems); subscribed once to `onUpdated` (debounced 150 ms) to refresh the open panel.

- [ ] **Step 1: Write the failing scenario** (seed: `A.md` = `links to [[B]] #alpha`, `B.md` = `# B`, `Çalışma.md` = `see [[b]]`): `await App.refreshIndex()`; open `B.md`; `togglePanel('backlinks')` → panel text contains `A`, `links to [[B]]` and `Çalışma`; `togglePanel('tags')` lists `alpha` and expanding it lists `A`; search `links` shows a snippet; `App.updateWelcomeStats()` shows 3 notes; `togglePanel('graph')` → `#graphView` has class `visible`, then `togglePanel('fileExplorer')` → `#graphView` not visible and `#editorPane` display is not `none`.
- [ ] **Step 2: Run `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement.** Backlinks: `index.backlinks(activeTab)` rows show stem + context line, re-rendered from `switchTab` while the panel is open. Tags: each tag expands to its notes. Search: `index.search`, ≥ 2 chars, `textContent` only. Graph: `index.graph()`; one click handler attached via an `AbortController` stored in `_graphCleanup`; arrow functions so the active node highlights; stop the loop when max node speed < 0.05 and restart on Refresh (wire `btnGraphRefresh`); `hideGraphView()` from `updatePanelContent` and the collapse branch of `togglePanel`. DataForge "Quick Stats" shows note and tag counts from the index. Remove the `search-files` handler last.
- [ ] **Step 4: Run `npm run test:e2e` and `npm test` — expect PASS; `grep -rn "searchFiles\|cacheAllNotes" src electron` → no matches.**
- [ ] **Step 5: Commit** `feat: backlinks, tags, search, graph and stats from the vault index`.

### Task 9: Link-safe rename and external-change reload

**Files:**
- Create: `test/e2e/rename-links.scenario.js`
- Modify: `src/lib/note-parse.js` (+`rewriteLinks`), `test/unit/note-parse.test.js`, `electron/main.js` (`rename-file`), `src/js/app.js` (`renameFile`, `onExternalChange`)

**Interfaces:**
- Consumes: `index.backlinks`, `normalizeStem` (T5–T6), `cortex.index.onFileChanged` (T7), `App.flushSaves` (T4).
- Produces: `CortexLib.rewriteLinks(content: string, oldStem: string, newStem: string): string`.
- Produces: `rename-file` result `{ success: true, updated: string[] }` — absolute paths of notes whose links were rewritten (only when both names end `.md` and the stems differ). Backlinks are collected *before* the rename and include only notes whose link resolves to the renamed file, so duplicate-stem notes are never touched.
- Produces: `App.onExternalChange(path: string): Promise<void>` — open, **clean** tab whose disk content differs reloads (caret clamped, preview refreshed); open, **dirty** tab differing from disk is left alone and the status bar shows `Changed on disk`; own saves are no-ops because content is equal.

- [ ] **Step 1: Write the failing tests.**

```js
const r = rewriteLinks;
test('rewrites plain, alias, heading and embed forms', () => assert.equal(r('a [[Old]] [[old|x]] [[Old#H]] ![[Old]]', 'Old', 'New'), 'a [[New]] [[New|x]] [[New#H]] ![[New]]'));
test('does not touch longer names', () => assert.equal(r('[[Older]]', 'Old', 'New'), '[[Older]]'));
test('skips fenced and inline code', () => assert.equal(r('~~~\n[[Old]]\n~~~\n`[[Old]]` [[Old]]', 'Old', 'New'), '~~~\n[[Old]]\n~~~\n`[[Old]]` [[New]]'));
test('non-ASCII, case-insensitive match', () => assert.equal(r('[[çalışma]]', 'Çalışma', 'Yeni'), '[[Yeni]]'));
```

`rename-links` scenario (seed `Old.md`, `sub/Old.md`, `Ref.md` = `see [[Old|the old one]] and [[Old]]`): first rename `sub/Old.md` → `sub/Other.md` (links resolve to the shorter-path root `Old.md`) → `updated` is `[]` and `Ref.md` is unchanged. Then open `Ref`; `await App.flushSaves()`; `cortex.renameFile(Old.md, New.md)` → `updated` has `Ref.md`; disk `Ref.md` equals `see [[New|the old one]] and [[New]]`; within 2 s the open `Ref` tab content contains `[[New`. Then edit `Ref.md` from Node → clean tab reloads; make the tab dirty then edit on disk → tab content unchanged, `#statusbarError` contains `Changed on disk`.
- [ ] **Step 2: Run both suites — expect FAIL.**
- [ ] **Step 3: Implement `rewriteLinks` (reuse the fence/inline-code masking from `parseNote`), the main-process rename flow (backlinks → rename → rewrite+write each → `index.update`), and `onExternalChange` wired to `cortex.index.onFileChanged`.**
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `feat: rename rewrites wikilinks; open tabs follow external edits`.

---

# Build 3 — Safe Markdown and editor

### Task 10: Safe Markdown renderer and CSP

**Files:**
- Create: `src/lib/markdown.js`, `test/unit/markdown.test.js`, `test/e2e/csp.scenario.js`
- Modify: `package.json` (`npm i marked --save-exact`), `src/index.html` (CSP meta; `marked` UMD script from `../node_modules/marked/lib/` — confirm the file exists after install — then `lib/markdown.js`), `src/js/app.js` (delete `parseMarkdown 695-732`; `updatePreview` calls `CortexLib.renderMarkdown(md, { isResolved: t => this._stemSet.has(CortexLib.normalizeStem(t)) })`), `src/css/main.css` (table, task-list, `.wikilink.unresolved`)

**Interfaces:**
- Consumes: `normalizeStem` (T5), `App._stemSet` (T8).
- Produces: `CortexLib.renderMarkdown(md: string, opts?: { isResolved?: (target: string) => boolean }): string` — HTML safe for `innerHTML`. Contract used by Task 11: wikilink → `<a href="#" class="wikilink[ unresolved]" data-note="TARGET" [data-heading="H"]>ALIAS|TARGET</a>`; task item → `<input type="checkbox" data-task="N" [checked]>` (not disabled), `N` = 0-based index among task lines in source order outside code fences.
- Produces: `CortexLib.toggleTaskByIndex(content: string, n: number): string` — flips `[ ]`↔`[x]` on the n-th task line (`- * +` bullets, optional indent and `>` prefixes, `[X]` accepted); unchanged if out of range.
- CSP (verbatim): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'none'` (Build 5 removes the Google hosts).

- [ ] **Step 1: Write the failing tests.**

```js
const R = renderMarkdown;
test('raw HTML is escaped', () => { const h = R('<script>alert(1)</script>'); assert.match(h, /&lt;script&gt;/); assert.doesNotMatch(h, /<script/); });
test('javascript: links lose their anchor', () => assert.doesNotMatch(R('[x](javascript:alert(1))'), /javascript:/i));
test('quotes cannot break out of attributes', () => { for (const md of ['[x](a" onmouseover="alert`1`)', '![i](x" onerror="alert`1`)']) assert.doesNotMatch(R(md), /<[^>]*\son(mouseover|error)=/i); });
test('images: https kept, javascript: dropped', () => { assert.match(R('![a](https://x/y.png)'), /<img[^>]+src="https:\/\/x\/y\.png"/); assert.doesNotMatch(R('![a](javascript:alert(1))'), /<img/); });
test('task lists render checkboxes with data-task', () => { const h = R('- [ ] a\n- [x] b'); assert.equal((h.match(/type="checkbox"/g) || []).length, 2); assert.match(h, /data-task="0"/); assert.match(h, /data-task="1"[^>]*checked|checked[^>]*data-task="1"/); });
test('wikilinks: alias, heading, unresolved class', () => { const h = R('[[B|bee]] [[Gone#H]]', { isResolved: t => t === 'B' }); assert.match(h, /data-note="B"[^>]*>bee</); assert.match(h, /class="wikilink unresolved"/); assert.match(h, /data-heading="H"/); });
test('snake_case and * bullets are not italicised', () => { assert.match(R('my_var_name'), /my_var_name/); assert.match(R('* item'), /<li>item<\/li>/); });
test('tables get <table>; fenced code stays literal; frontmatter is hidden', () => { assert.match(R('| a |\n|---|\n| b |'), /<table>/); assert.match(R('~~~\n**x**\n~~~'), /\*\*x\*\*/); assert.doesNotMatch(R('---\ntags: [a]\n---\n# T'), /tags:/); });
test('empty input renders empty string', () => assert.equal(R(''), ''));
test('toggleTaskByIndex', () => {
  assert.equal(toggleTaskByIndex('- [ ] a\n- [x] b', 1), '- [ ] a\n- [ ] b');
  assert.equal(toggleTaskByIndex('~~~\n- [ ] no\n~~~\n- [ ] yes', 0), '~~~\n- [ ] no\n~~~\n- [x] yes');
  assert.equal(toggleTaskByIndex('  * [ ] a', 0), '  * [x] a'); assert.equal(toggleTaskByIndex('- [X] a', 0), '- [ ] a');
  assert.equal(toggleTaskByIndex('- [ ] a', 5), '- [ ] a'); });
```

`csp.scenario.js`: collect `console-message` events; open a note, render preview, open graph and each plugin panel via `App.openPlugin(...)`; assert no message contains `Content Security Policy`.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement.** `npm i marked --save-exact`; custom `html` renderer escapes raw HTML; link/image renderer allows only `http:`, `https:`, `mailto:`, `#…` and scheme-less relative URLs (images also `data:image/(png|jpeg|gif|webp);base64,`) and escapes attribute values; wikilink inline extension; number task checkboxes by a fence-aware source scan so they match `toggleTaskByIndex`; strip frontmatter first. If the rendered checkbox and the scan ever disagree, `toggleTaskByIndex` must verify the target line still matches the task pattern and otherwise leave content unchanged.
- [ ] **Step 4: Run `npm test` and `npm run test:e2e` — expect PASS; `npm start` and eyeball a note with a table, tasks and a wikilink.**
- [ ] **Step 5: Commit** `feat: marked-based safe Markdown pipeline; add CSP`.

### Task 11: Preview interactions

**Files:**
- Create: `test/e2e/preview.scenario.js`
- Modify: `src/js/app.js` (one delegated click listener on `#previewContent`), `electron/main.js` (`webContents.setWindowOpenHandler` → deny, open safe URLs via `shell.openExternal`; `will-navigate` → `preventDefault`)

**Interfaces:**
- Consumes: Task 10 output contract, `cortex.index.resolve` (T7), `isSafeExternalUrl` (T1), `Dialogs`/`createFile` exclusive create (T2).
- Produces: behaviour only — wikilink click opens the resolved note, or after `confirm("Create 'X'?")` creates `X.md` (`# X\n`, exclusive) and opens it; checkbox click calls `toggleTaskByIndex` on the active tab, updates textarea + tab, saves, re-renders; `http(s)`/`mailto` anchors go through `cortex.openExternal`.

- [ ] **Step 1: Write the failing scenario** (seed `A.md` = `[[B]] [[Missing]]\n- [ ] t1\n- [ ] t2\n[ext](https://example.com)`, `B.md`): open `A`; click `a.wikilink[data-note="B"]` → active tab ends `B.md`; back on `A`, click the checkbox with `data-task="1"` → within 1.5 s disk `A.md` contains `- [x] t2` and `- [ ] t1`; stub `window.confirm = () => true`, click `Missing` → `Missing.md` exists and is active; `js("window.open('https://example.com')")` → `BrowserWindow.getAllWindows().length === 1`.
- [ ] **Step 2: Run `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement the delegated handler and the main-process window guards.**
- [ ] **Step 4: Run `npm run test:e2e` — expect PASS.**
- [ ] **Step 5: Commit** `feat: clickable wikilinks, task toggles and guarded external links in preview`.

### Task 12: Undo-safe editor edits

**Files:**
- Create: `src/lib/editor-edits.js`, `test/unit/editor-edits.test.js`, `test/e2e/editor.scenario.js`
- Modify: `src/js/app.js` (`onEditorKeydown 596-651`, `insertSlashCommand 523-536`, `insertWikilink 538-551`; new `applyEdit`), `src/index.html` (script)

**Interfaces:**
- Produces (all pure): `Edit = { from: number, to: number, insert: string, selStart: number, selEnd: number }` — replace `text.slice(from, to)` with `insert`, then select `[selStart, selEnd]` in the *new* text.
  - `CortexLib.continueList(text, caret): Edit | null` — Enter at end of a `- `, `* `, `+ `, `1. `, `- [ ] `, `> ` line continues it (numbers increment, tasks restart as `- [ ] `, indentation kept); an empty item removes its prefix; caret mid-line or non-list line → `null`.
  - `CortexLib.indentSelection(text, start, end, outdent: boolean): Edit` — indents/outdents every touched line by 2 spaces (outdent also removes one leading tab); collapsed caret + indent inserts 2 spaces.
  - `CortexLib.toggleWrap(text, start, end, marker: string): Edit` — wraps the selection, unwraps if already wrapped, empty selection inserts `marker+marker` with the caret between.
- Produces: `App.applyEdit(edit: Edit)` — `setSelectionRange(from, to)` then `document.execCommand('insertText', false, insert)` (`'delete'` when `insert === ''`), then `setSelectionRange(selStart, selEnd)`; the normal `input` event fires so autosave and preview run. Ctrl+B → `**`, Ctrl+I → `*`, Tab/Shift+Tab → `indentSelection`, Enter → `continueList`.

- [ ] **Step 1: Write the failing tests** with `const apply = (t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to)`:

```js
test('continueList: bullet, number, task, nested', () => {
  assert.equal(apply('- a', continueList('- a', 3)), '- a\n- ');
  assert.equal(apply('1. a', continueList('1. a', 4)), '1. a\n2. ');
  assert.equal(apply('- [x] done', continueList('- [x] done', 10)), '- [x] done\n- [ ] ');
  assert.equal(apply('  - n', continueList('  - n', 5)), '  - n\n  - '); });
test('continueList: empty item exits the list; mid-line and plain lines are null', () => {
  assert.equal(apply('- ', continueList('- ', 2)), ''); assert.equal(continueList('- a b', 3), null); assert.equal(continueList('plain', 5), null); });
test('indentSelection: multi-line, outdent, collapsed caret', () => {
  assert.equal(apply('a\nb\nc', indentSelection('a\nb\nc', 0, 3, false)), '  a\n  b\nc');
  assert.equal(apply('  a', indentSelection('  a', 0, 3, true)), 'a');
  assert.equal(apply('a', indentSelection('a', 1, 1, false)), 'a  '); });
test('toggleWrap: wrap, unwrap, empty selection', () => {
  const w = toggleWrap('word', 0, 4, '**'); assert.equal(apply('word', w), '**word**'); assert.deepEqual([w.selStart, w.selEnd], [2, 6]);
  assert.equal(apply('**word**', toggleWrap('**word**', 2, 6, '**')), 'word');
  const e = toggleWrap('', 0, 0, '*'); assert.equal(apply('', e), '**'); assert.equal(e.selStart, 1); });
```

`editor.scenario.js`: focus the textarea, type `abc`, dispatch a Tab keydown → value gains two spaces; `document.execCommand('undo')` → value returns to the pre-Tab text (pins the lost-undo bug). If focus in the hidden e2e window makes this flaky, run this one scenario with `show: true`.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement the three functions and `applyEdit`; route Tab, Enter, Ctrl+B/I, slash-command and wikilink insertion through it (no more direct `textarea.value =`).**
- [ ] **Step 4: Run `npm test` and `npm run test:e2e` — expect PASS.**
- [ ] **Step 5: Commit** `feat: undo-safe editor edits with list continuation, indent and formatting shortcuts`.

---

# Roadmap — separate plans, written after Build 2 ships

**Build 4 — Plugins that deliver** (needs `cortex.index`; list/task/frontmatter extraction extends `parseNote`)
- `PluginStore` in `<vault>/.cortex/*.json` (atomic temp-file + rename) with one-time migration from the `cortex_*` `localStorage` keys; data becomes portable and backed up with the vault.
- TaskFlow: working Edit/Delete/"+ Add", due dates with overdue state, tags, escaped titles, per-column order, `- [ ]` tasks aggregated from notes.
- Recall: real SM-2 (ease factor, min 1.3, quality 0–5), "Again" re-queued in-session, card edit/delete, cards from `Q:: A` lines, Space/1–4 shortcuts.
- DataForge: real query language over the index (`tag:`, `path:`, frontmatter `key:value`, `created:`/`modified:` ranges, `-` negation, `sort:`), results table, wired "Insert Template" with `{{date}}`/`{{title}}`, templates read from `Templates/`.
- DailySync: journal *is* the daily note; month navigation, dots on days with notes, click-to-open, habits with add/toggle/streak.
- FocusPulse: timestamp-based timer that survives panel close (status-bar widget), notification, per-day sessions, long break every 4th, optional task link.
- Panel lifecycle: `close()` removes the element; no stacked Recall review panels.

**Build 5 — Ship & polish**
- Local fonts (`@fontsource-variable/*`), then drop the Google hosts from the CSP; `src/assets/icon.png` (≥ 256×256) generated from `icon.svg`.
- Electron to current stable (read release notes first), asar, NSIS installer, window-state persistence.
- Settings panel (`btnSettings`): theme (CSS variables), autosave, font size, vault.
- Quick switcher (Ctrl+O) and fuzzy command palette from the index; explorer drag-and-drop move (reuses Task 9 link rewriting); paste-image → `Attachments/`.
- Split `app.js` (≈1,200 lines) into `explorer`, `editor`, `panels`, `graph`, `commands` modules; dedupe CSS; lazy-load plugins; virtualize the file tree; accessibility pass.
- **Decision for you:** replace the `<textarea>` with CodeMirror 6 (syntax highlighting, live preview, folding, real undo) — needs a bundler (esbuild), which breaks the "no build step" constraint. Not planned until you choose.

## Self-review

- **Spec coverage:** F1→T2, F2→T1, F3→T1/T2, F4→T1, F5→T1/T10, F6→T8, F7→T8, F8→T5–T8, F9→T3, F10→T4, F11→T10/T11, F12→T12, F13→B4, F14→T1 + B5. No gaps.
- **Type consistency:** `NoteMeta`, `ParsedLink`, `Edit`, `normalizeStem`, `renderMarkdown`/`toggleTaskByIndex`, `cortex.index.*` names are identical wherever consumed (T6→T7→T8→T9→T11).
- **Not verified here:** F5's exploit chain (read, not run); the Electron focus behaviour the T12 undo scenario depends on; the `marked` UMD path and its checkbox markup (pinned by T10's tests once installed).
