# Cortex Daily-Flow Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five features that most improve a second brain's daily loop — find, capture, navigate, connect, resume — on top of the Build 2 vault index.

**Architecture:** Pure logic lives in `src/lib/*.js` (fuzzy ranking, capture text, mention finding/linking, workspace sanitising) and is unit-tested in Node. Main gains one confined IPC op (`append-file`), one index query (`mentions`) and one rewrite op (`link-mention`) on the existing `vaultFs`/`VaultIndex`. The renderer adds a switcher overlay, a quick-capture command, an Outline panel, an "Unlinked mentions" section in the Backlinks panel and per-vault workspace restore.

**Tech Stack:** Electron 28.3.3, plain JS classic `<script>`s, `node:test`, the existing e2e harness. No new dependencies.

**Spec:** this document, § Feature Selection (derived from the request "improve with the best 5 features that match the product's purpose"; no separate spec exists). Code facts come from `docs/superpowers/plans/2026-10-20-cortex-enrichment-optimization.md` § "Build 1 — execution notes" and § "Build 2 — execution notes" (executed; **where that text and the code differ, the code wins**).

## Feature Selection (the spec)

Cortex is a local-first "second brain": Markdown notes, `[[wikilinks]]`, an index-backed Backlinks/Graph/Tags/Search, and five plugins. Its daily loop is **capture → find → connect → navigate → resume**; each feature below closes one gap in it and reuses what Builds 1–2 built.

| # | Feature | Gap it closes | Reuses |
|---|---|---|---|
| 1 | **Quick switcher** (Ctrl+O): fuzzy-open any note, recents first | Opening a note means expanding the tree or typing in Search | `cortex.index.notes()`; pulled forward from the Build 5 roadmap (its "fuzzy command palette" bullet stays) |
| 2 | **Quick capture** (Ctrl+Shift+N): one line → today's daily note under `## Captures`, without leaving the current note | A thought needs 4 steps to land in the vault | `Dialogs.ask`, daily-note template, `vaultFs` |
| 3 | **Outline panel**: the active note's headings, click to jump, live while typing | Long notes cannot be navigated | `parseNote().headings` |
| 4 | **Unlinked mentions** in the Backlinks panel with a one-click **Link** | Backlinks only show links you already made; a graph grows by linking | `VaultIndex`, `rewriteLinks`-style disk rewrite |
| 5 | **Workspace restore**: reopen yesterday's tabs, active tab, side panel and layout, per vault | Every launch starts empty | `openFile`, index, `localStorage` |

Considered, not chosen: vault-wide tasks view, search operators, templates (Build 4 roadmap owns them); note aliases, local graph, unresolved-links/orphans report (good next candidates; aliases touch `resolve`, rename and backlinks); OS-wide capture hotkey (needs a tray); CodeMirror (Build 5 decision).

Independent of Build 3 (Tasks 10–12). Shared regions are `switchTab` and `onGlobalKeydown`; after Build 3's Task 12, nothing here may write `textarea.value` directly (Outline moves the caret with `setSelectionRange`; mention linking rewrites the file on disk).

## Global Constraints

- Electron stays at `28.3.3`; `contextIsolation: true`, `nodeIntegration: false`, no new dependencies, no bundler.
- Renderer code is classic `<script>`s in `src/index.html`; `src/lib/*.js` load before plugins, which load before `js/app.js`. Shared pure modules export via `module.exports` when `module` is defined, else `window.CortexLib = Object.assign(window.CortexLib || {}, api)`.
- Unit tests: `npm test` (`node --test "test/unit/*.test.js"`). E2E: `npm run test:e2e`; scenarios export `{ seed, run(ctx) }`, poll for conditions (a fixed wait is allowed only for a negative check), stub `window.alert/confirm`, never touch the real Recycle Bin, and nothing ever runs `npm start` (it seeds the user's real `~/Documents/CortexVault`).
- Every renderer-supplied path must resolve inside the vault root (`vaultFs` confines); IPC results keep `{ success: boolean, error?: string, … }`; `cortex.index.*` returns bare payloads.
- Dates are the local calendar day via `CortexLib.localDateStr`. Windows only. Entries starting with `.` are never listed or indexed.
- User-controlled text (note names, headings, snippets, captured text) reaches the DOM via `textContent`, never `innerHTML`.
- Tab identity: tabs hold `/` paths (`App.normPath`), looked up with `findTab`/`tabsAt`; compare any index path (native `\`) with `CortexLib.pathKey(App.normPath(p))`. Every autosave goes through `App.scheduleSave`. A note changed on disk is picked up by `App.onExternalChange` — write through the disk, flush the open tab first.
- Commits: conventional-commit subject; end every message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Capture never loses or overwrites text:** the daily note open with unsaved edits, two captures fired together, the note not existing yet, a note without `## Captures`. → T2.
2. **Switcher with real vaults:** non-ASCII names typed without diacritics (`calisma` → `Çalışma`), duplicate stems in different folders, an empty vault, Enter on no results opens nothing, keyboard-only use. → T1.
3. **Linking a mention changes exactly that occurrence:** mentions inside code, links, URLs or frontmatter are ignored; a note edited since the list was built refuses instead of corrupting; the note's own tab is flushed first. → T4.
4. **Restore never resurrects or wipes:** deleted/renamed notes are skipped silently (no alert), garbage in storage never throws, and switching vaults restores each vault's own tabs without overwriting the other's. → T5.
5. **Outline matches what is typed:** headings inside code fences are not listed, CRLF notes jump to the right line, and refreshing the panel never steals focus from the editor. → T3.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/fuzzy.js` (new) | `fuzzyScore`, `rankNotes` — pure |
| `src/lib/capture.js` (new) | `captureLine`, `captureAppendix` — pure |
| `src/lib/workspace.js` (new) | `sanitizeWorkspace` — pure |
| `src/lib/note-parse.js` | + heading `line`, + `findMentions`, `linkMention` |
| `electron/vault-fs.js`, `main.js`, `preload.js` | + `append`, `append-file`, `link-mention`, `index:mentions` |
| `electron/vault-index.js` | + `mentions()` |
| `src/js/app.js`, `src/index.html`, `src/css/main.css` | switcher overlay, capture, Outline panel, mentions section, restore, `App.notice` |
| `test/unit/*.test.js`, `test/e2e/*.scenario.js` | tests |

---

### Task 1: Quick switcher

**Files:**
- Create: `src/lib/fuzzy.js`, `test/unit/fuzzy.test.js`, `test/e2e/switcher.scenario.js`
- Modify: `src/index.html` (script after `lib/note-parse.js`; `#switcherOverlay` after the command palette), `src/js/app.js`, `src/css/main.css`

**Interfaces:**
- Produces: `CortexLib.fuzzyScore(query: string, text: string): number` — folds case, Unicode form, diacritics (NFD, marks stripped) and dotless `ı`→`i` on both sides; `0` unless the query is a subsequence of the text; empty query → `1`; contiguous match > scattered; match at the start or after a word break (` -_/.`) > mid-word; shorter text wins ties.
- Produces: `CortexLib.rankNotes(query: string, notes: { path: string, stem: string, rel: string, key: string }[], recent: string[], limit = 20): typeof notes` — `rel` is the vault-relative `/` path, `key` the caller's identity key, `recent` keys MRU-first. Non-empty query: score = `max(2 * fuzzyScore(q, stem), fuzzyScore(q, rel))`, drop zeros, sort by score, then recency, then stem, then `rel`. Empty query: recents (known keys only, in order) then the rest A–Z by stem.
- Produces: `App.openSwitcher()`, `App.closeSwitcher()`, `App.recordRecent(path: string)` (MRU list of `pathKey(normPath(path))`, max 30, persisted in `localStorage['cortex_recent:' + vaultPath]` inside try/catch, called from `switchTab`).

- [ ] **Step 1: Write the failing unit tests.**

```js
const { fuzzyScore, rankNotes } = require('../../src/lib/fuzzy');
test('fuzzyScore: subsequence only; empty query matches', () => {
  assert.equal(fuzzyScore('xyz', 'meeting'), 0); assert.ok(fuzzyScore('mtg', 'meeting') > 0); assert.ok(fuzzyScore('', 'a') > 0); });
test('fuzzyScore: contiguous > scattered, word start > mid-word, shorter wins', () => {
  assert.ok(fuzzyScore('meet', 'meeting') > fuzzyScore('meet', 'm e e t'));
  assert.ok(fuzzyScore('plan', 'project plan') > fuzzyScore('plan', 'airplane'));
  assert.ok(fuzzyScore('plan', 'plan') > fuzzyScore('plan', 'plan b')); });
test('fuzzyScore: case, diacritics, dotless i', () => {
  assert.ok(fuzzyScore('calisma', 'Çalışma') > 0); assert.ok(fuzzyScore('CAL', 'C\u0327alışma') > 0);
  assert.ok(fuzzyScore('istanbul', 'Istanbul') > 0 && fuzzyScore('istanbul', 'İstanbul') > 0); });
const N = (stem, rel = stem + '.md') => ({ path: '/v/' + rel, stem, rel, key: rel.toLowerCase() });
const [A, B, D1, D2] = [N('Alpha'), N('Beta'), N('Dup'), N('Dup', 'sub/Dup.md')];
test('rankNotes: empty query = recents MRU-first (unknown keys ignored), then A-Z', () =>
  assert.deepEqual(rankNotes('', [A, B, D1], ['zzz', 'dup.md', 'beta.md']).map(n => n.stem), ['Dup', 'Beta', 'Alpha']));
test('rankNotes: stem hit outranks folder-only hit; non-matches drop', () =>
  assert.deepEqual(rankNotes('dup', [N('Other', 'dup/Other.md'), D1, A], []).map(n => n.rel), ['Dup.md', 'dup/Other.md']));
test('rankNotes: duplicate stems stay separate rows; recency breaks ties; limit applies', () => {
  assert.deepEqual(rankNotes('dup', [D1, D2], ['sub/dup.md']).map(n => n.rel), ['sub/Dup.md', 'Dup.md']);
  assert.equal(rankNotes('', [A, B, D1], [], 2).length, 2); });
```

`switcher.scenario.js` (seed `Çalışma.md`, `Alpha.md`, `Beta.md`, `Dup.md`, `sub/Dup.md`, `a&b.md`): `App.openSwitcher()` → `#switcherOverlay` visible and `#switcherInput` focused; typing `calisma` lists `Çalışma` first; Enter opens it (`App.activeTab` ends `Çalışma.md`); `dup` lists two rows whose second line shows `Dup.md` and `sub/Dup.md`; a row for `a&b` has text exactly `a&b` (textContent); open `Beta` then `Alpha`, reopen with an empty query → rows start `Alpha`, `Beta`; ArrowDown+Enter opens the second row; `zzzz` shows "No matching notes" and Enter opens nothing (tab count unchanged); Escape closes; a `keydown` `Ctrl+O` on `document` opens it; empty vault variant is covered by the unit empty-query test.
- [ ] **Step 2: Run `npm test` and `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement `fuzzy.js`; the overlay (input, list, ArrowUp/Down, Enter, Escape, click; rows are stem plus a dim `rel` line built with `textContent`; selected row scrolls into view); `Ctrl+O` in `onGlobalKeydown` and Escape closing it; a "Quick Open" palette command; `recordRecent` in `switchTab`.** The notes come from `App._notes` (rebuilt into `{path, stem, rel, key}` on open).
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `feat: quick switcher with fuzzy search and recents`.

### Task 2: Quick capture

**Files:**
- Create: `src/lib/capture.js`, `test/unit/capture.test.js`, `test/e2e/capture.scenario.js`
- Modify: `electron/vault-fs.js` (+`append`), `test/unit/vault-fs.test.js`, `electron/main.js` (`append-file`), `electron/preload.js` (`cortex.appendFile`), `src/index.html` (script; `<span id="statusbarNotice">` in the status bar), `src/js/app.js`, `src/css/main.css`

**Interfaces:**
- Produces: `vaultFs.append(p: string, text: string): Promise<{ success: true } | { success: false, error: string }>` — confined like `write` (parents created, UTF-8, `fs.appendFile`); a directory or the vault root fails.
- Produces: `CortexLib.captureLine(text: string, now = new Date()): string` → `- HH:MM text` (local 24 h time), whitespace runs collapsed to one space, trimmed; `''` for blank input.
- Produces: `CortexLib.captureAppendix(existing: string, line: string): string` — exactly the text to append: a leading newline unless `existing` is empty or ends with `\n`; when no line of `existing` equals `## Captures` (trailing spaces allowed) first `## Captures` preceded by a blank line (no blank line when `existing` is empty); then `line` and a newline; `\r\n` throughout iff `existing` contains `\r\n`.
- Produces: `App.ensureDailyNote(): Promise<string | null>` (create-if-absent, `overwrite:false`, today's `Daily Notes/YYYY-MM-DD.md`, existing template; `null` after an alert on failure — `openDailyNote` becomes this plus the existing open); `App.captureToDaily(text: string): Promise<boolean>` (one at a time through a promise chain; `flushTab` the note's open tab first; read, append `captureAppendix`; alert and `false` on failure); `App.quickCapture(): Promise<void>` (`Dialogs.ask({ title: 'Quick capture' })`; on failure re-asks with the same text in `value`); `App.notice(text: string, ms = 2500)` (shows `text` in `#statusbarNotice`, then clears it).

- [ ] **Step 1: Write the failing tests.**

```js
const at = new Date(2026, 9, 21, 9, 5);
test('captureLine: local HH:MM, one line, trimmed; blank -> ""', () => {
  assert.equal(captureLine('  idea\nsecond\tline ', at), '- 09:05 idea second line'); assert.equal(captureLine('   ', at), ''); });
test('captureAppendix: adds the heading once and never touches existing text', () => {
  assert.equal(captureAppendix('# D\n', '- a'), '\n## Captures\n- a\n');
  assert.equal(captureAppendix('# D\n\n## Captures\n- x\n', '- a'), '- a\n');
  assert.equal(captureAppendix('# D\n## Captures', '- a'), '\n- a\n');
  assert.equal(captureAppendix('# D', '- a'), '\n\n## Captures\n- a\n');
  assert.equal(captureAppendix('', '- a'), '## Captures\n- a\n'); });
test('captureAppendix: CRLF notes stay CRLF', () => assert.equal(captureAppendix('# D\r\n', '- a'), '\r\n## Captures\r\n- a\r\n'));
test('append: creates parents, appends, refuses outside the vault and directories', async () => { /* in vault-fs.test.js, house style */ });
```

`capture.scenario.js` (no seed): `App.captureToDaily('first')` creates `Daily Notes/<today>.md` containing the daily template, one `## Captures` heading and `- HH:MM first`; a second call appends under the same heading; `Promise.all([captureToDaily('p'), captureToDaily('q')])` leaves both lines and still one heading; with that note open and **dirty** (textarea changed, not saved) a capture keeps both the typed text and the capture on disk and in the tab (poll), and `#statusbarError` never shows "Changed on disk"; a failing write (read-only daily file) alerts, returns `false`, and the typed text is untouched; `#statusbarNotice` shows the notice after success and clears. Keyboard: a `Ctrl+Shift+N` keydown opens the ask dialog.
- [ ] **Step 2: Run `npm test` and `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement `vaultFs.append`, `append-file`/`cortex.appendFile`, `capture.js`, the App methods, `Ctrl+Shift+N` (`e.key === 'N'`) and a "Quick Capture" palette command.**
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `feat: quick capture to today's daily note`.

### Task 3: Outline panel

**Files:**
- Create: `test/e2e/outline.scenario.js`
- Modify: `src/lib/note-parse.js` (heading `line`), `test/unit/note-parse.test.js`, `src/index.html` (activity-bar button `data-panel="outline"`, title "Outline"), `src/js/app.js` (`renderOutline`, `jumpToLine`, `updatePanelContent` title + branch, refresh hooks), `src/css/main.css`

**Interfaces:**
- Produces: `parseNote(content).headings: { level: number, text: string, line: number }[]` — `line` is the 0-based line in the original content (frontmatter counted, fenced headings never listed).
- Produces: `App.renderOutline(container: HTMLElement): void` (rows indented by level, `textContent`; empty states "Open a note to see its outline." / "No headings."), `App.jumpToLine(line: number): void` (caret to the start of that line of `#editorTextarea`, focus, scrolled into view, cursor status updated). The panel re-renders from `switchTab` and from `onEditorInput` (300 ms debounce) while it is open, reading the **textarea value** so unsaved text is included.

- [ ] **Step 1: Write the failing tests.**

```js
test('headings carry their 0-based original line; frontmatter counts, fenced headings are skipped', () =>
  assert.deepEqual(parseNote('---\nt: 1\n---\n~~~\n# no\n~~~\n## Yes').headings, [{ level: 2, text: 'Yes', line: 6 }]));
// update the existing 'BOM is stripped; title and headings' expectation to include line: 0 and line: 1
```

`outline.scenario.js` (seed `N.md` = `# Top\r\ntext\r\n## Sub\r\n~~~\r\n# not\r\n~~~\r\n### Deep`, `E.md` = `no headings`): open `N`, `togglePanel('outline')` → rows `Top`, `Sub`, `Deep` (not `not`) with level classes; clicking `Sub` puts `selectionStart` at the start of that line of `textarea.value` (CRLF note) and focuses the textarea; setting `textarea.value += '\n#### New'` and dispatching `input` adds a row within 1.5 s while `document.activeElement` stays the textarea; switching to `E` shows "No headings."; closing every tab shows "Open a note to see its outline."
- [ ] **Step 2: Run `npm test` and `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Add `line` to the heading push in `parseNote`; implement the panel, `jumpToLine` (offset from `textarea.value.split('\n')` — LF numbering equals the original's) and the refresh hooks.**
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `feat: outline panel with jump-to-heading`.

### Task 4: Unlinked mentions

**Files:**
- Create: `test/e2e/mentions.scenario.js`
- Modify: `src/lib/note-parse.js` (+`findMentions`, `linkMention`), `test/unit/note-parse.test.js`, `electron/vault-index.js` (+`mentions`), `test/unit/vault-index.test.js`, `electron/main.js` (`index:mentions`, `link-mention`), `electron/preload.js` (`cortex.index.mentions`, `cortex.linkMention`), `src/js/app.js` (`renderBacklinks`, `linkMention`), `src/css/main.css`

**Interfaces:**
- Produces: `CortexLib.findMentions(content: string, stem: string): { line: number, col: number }[]` — 0-based, original coordinates (frontmatter lines counted, `\r` excluded); whole-word, case/Unicode-insensitive (`normalizeStem` on same-length slices) occurrences of `stem`; ignores frontmatter, fenced/inline code (`maskCode`), `[[…]]`/`![[…]]` spans, markdown link/image targets `](…)` and bare `http(s)://` runs; `[]` when `stem` is shorter than 3 characters. `// shortcut: same-length slice compare, upgrade if Unicode folding changes length`.
- Produces: `CortexLib.linkMention(content: string, m: { line: number, col: number }, stem: string): string | null` — replaces that occurrence with `[[stem]]` (exact-case match) or `[[stem|matched text]]`; `null` unless `(line, col)` is still in `findMentions(content, stem)`; EOLs preserved.
- Produces: `VaultIndex.mentions(absPath: string, limit = 200): { path: string, stem: string, line: number, col: number, text: string }[]` — other notes only, sorted by stem then position, `text` the source line without `\r`. `// shortcut: scans every note's content per call, upgrade to an inverted index past ~5k notes`.
- Produces: IPC `index:mentions(absPath)` → `{ success, mentions }`; `cortex.index.mentions(path)` bare array. IPC `link-mention(sourcePath, line, col, targetPath)` → `{ success: true } | { success: false, error, stale?: true }`: waits for the index, requires a `.md` source and a target the index knows, reads the source fresh, `linkMention`, writes through `vaultFs`, then `index.update(source)`, `notify('vault:file-changed', source)`, `scheduleIndexUpdated()`; bridge `cortex.linkMention(sourcePath, line, col, targetPath)`.
- Produces: `App.linkMention(m)` — `flushTab` the source's open tab (abort with an alert if it cannot save), call the bridge; `stale` → alert "That note changed — the list was refreshed." and re-render; success → `App.notice('Linked in ' + m.stem)`. The Backlinks panel renders "N backlinks" then "Unlinked mentions (N)" (each row `panelRow` plus a **Link** button that does not open the note); the section also shows when there are no backlinks.

- [ ] **Step 1: Write the failing tests.**

```js
test('findMentions: whole words, any case, any number per line, original coordinates', () => {
  assert.deepEqual(findMentions('---\na: b\n---\nI read Target; target! Targets no', 'Target'), [{ line: 3, col: 7 }, { line: 3, col: 15 }]); });
test('findMentions: skips links, code, URLs, link targets, frontmatter; short stems', () => {
  assert.deepEqual(findMentions('[[Target]] [[Target|x]] `Target` ![[Target]] [t](http://x/Target) https://x/Target\n~~~\nTarget\n~~~', 'Target'), []);
  assert.deepEqual(findMentions('---\ntitle: Target\n---\nbody', 'Target'), []); assert.deepEqual(findMentions('ab ab', 'ab'), []); });
test('findMentions: non-ASCII and CRLF', () => assert.deepEqual(findMentions('x\r\nsee çalışma', 'Çalışma'), [{ line: 1, col: 4 }]));
test('linkMention: exact case -> [[Stem]], other case keeps the text as alias, stale -> null', () => {
  assert.equal(linkMention('see Target now', { line: 0, col: 4 }, 'Target'), 'see [[Target]] now');
  assert.equal(linkMention('see target now', { line: 0, col: 4 }, 'Target'), 'see [[Target|target]] now');
  assert.equal(linkMention('see [[Target]] now', { line: 0, col: 6 }, 'Target'), null);
  assert.equal(linkMention('a\r\nsee Target', { line: 1, col: 4 }, 'Target'), 'a\r\nsee [[Target]]'); });
```
Plus `vault-index.test.js`: `mentions()` returns line/col/text for another note, excludes the target itself, honours `limit`, and `[]` for an unknown path.

`mentions.scenario.js` (seed `Target.md`, `Src.md` = `I read about target today. See [[Target]] too.`, `Other.md` = `nothing here`): open `Target`, `togglePanel('backlinks')` → one backlink row (`Src`) and "Unlinked mentions (1)" with one `Src` row; clicking **Link** gives disk `Src.md` = `I read about [[Target|target]] today. See [[Target]] too.`, the mention section disappears (poll) and the backlink row remains; a mention whose note was edited on disk first alerts the stale message and leaves the file untouched; with `Src` open and dirty, **Link** keeps the typed text and links the mention; `#statusbarNotice` confirms.
- [ ] **Step 2: Run `npm test` and `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement `findMentions`/`linkMention` (reuse `maskCode` and the frontmatter helper; build link/URL spans with same-length filler like `rewriteLinks`), `mentions`, the two IPC handlers and bridge entries (`needString` validation, `Number.isInteger` for line/col), and the panel section.**
- [ ] **Step 4: Run both suites — expect PASS.**
- [ ] **Step 5: Commit** `feat: unlinked mentions with one-click linking`.

### Task 5: Workspace restore

**Files:**
- Create: `src/lib/workspace.js`, `test/unit/workspace.test.js`, `test/e2e/restore.scenario.js`
- Modify: `src/index.html` (script after `lib/names.js`), `src/js/app.js` (`saveWorkspace`, `restoreWorkspace`, `setLayout` extracted from `cycleLayout`, hooks in `renderTabs`/`switchTab`/`togglePanel`/`cycleLayout`, `confirmFlush`, `init`, `onVaultChanged`)

**Interfaces:**
- Produces: `CortexLib.sanitizeWorkspace(raw: unknown): { tabs: string[], active: string | null, panel: string | null, layout: 'split' | 'editor' | 'preview' }` — `raw` is a JSON string or a parsed value; anything else yields `{ tabs: [], active: null, panel: null, layout: 'split' }`; never throws. Tabs: strings only, de-duplicated by `pathKey`, at most 20; `active` must be one of them (else the last tab, or `null`); `panel` ∈ `fileExplorer|search|graph|backlinks|tags|starred|outline` else `null`; `layout` whitelisted.
- Produces: `App.saveWorkspace(): void` (writes `localStorage['cortex_workspace:' + vaultPath]` in try/catch; no-op while `this._restoring`; debounced 300 ms from the hooks and written **immediately** at the top of `confirmFlush`, before a vault switch or close); `App.restoreWorkspace(): Promise<boolean>` (sanitises the stored value, opens in order only tabs whose `pathKey(normPath(p))` is in `App._notes`, with no alert for missing ones; then `switchTab(active)`, `setLayout`, the panel; `true` if a tab was restored). Called at the end of `init` (before `showWelcome`) and after `refreshIndex()` in `onVaultChanged`; `_restoring` is set for the whole restore and for the tab teardown in `onVaultChanged`.

- [ ] **Step 1: Write the failing tests.**

```js
test('sanitizeWorkspace: garbage never throws and yields the empty workspace', () => {
  const empty = { tabs: [], active: null, panel: null, layout: 'split' };
  for (const raw of [null, undefined, 42, '{bad', '[]', '"x"', { tabs: 'a' }, []]) assert.deepEqual(sanitizeWorkspace(raw), empty); });
test('sanitizeWorkspace: keeps strings, dedupes by pathKey, caps at 20, repairs active/panel/layout', () => {
  const w = sanitizeWorkspace(JSON.stringify({ tabs: ['C:/v/A.md', 7, 'c:/V/a.MD', 'C:/v/B.md'], active: 'gone', panel: 'evil', layout: 'x' }));
  assert.deepEqual(w, { tabs: ['C:/v/A.md', 'C:/v/B.md'], active: 'C:/v/B.md', panel: null, layout: 'split' });
  assert.equal(sanitizeWorkspace({ tabs: Array.from({ length: 30 }, (_, i) => 'C:/v/' + i + '.md') }).tabs.length, 20); });
test('sanitizeWorkspace: valid panel and layout pass through', () =>
  assert.deepEqual(sanitizeWorkspace({ tabs: ['a'], active: 'a', panel: 'outline', layout: 'editor' }), { tabs: ['a'], active: 'a', panel: 'outline', layout: 'editor' }));
```

`restore.scenario.js` (seed `A.md`, `B.md`, `C.md`): open A, B, C, switch to B, `togglePanel('outline')`, set layout `editor`; delete `C.md` from disk; `App.saveWorkspace()` (immediate path), close every tab, `await App.restoreWorkspace()` → tabs `A`, `B` in order, active `B`, panel `outline`, layout `editor`, **no alert**; `localStorage` set to `{bad` → `restoreWorkspace()` resolves `false`, opens nothing, logs no renderer error; switch vault with `require('../../electron/main.js').setVault(other)` (a second seeded vault containing `A.md`): the other vault restores nothing, the first vault's stored workspace is unchanged (read the key), and switching back restores `A`, `B`.
- [ ] **Step 2: Run `npm test` and `npm run test:e2e` — expect FAIL.**
- [ ] **Step 3: Implement `workspace.js` (require `./names.js` for `pathKey` under Node, `window.CortexLib.pathKey` in the page), the App methods and hooks.**
- [ ] **Step 4: Run both suites — expect PASS; run `restore` and `index-live` 3 times each (vault switching).**
- [ ] **Step 5: Commit** `feat: restore tabs, panel and layout per vault`.

---

## Self-review

- **Coverage:** each of the five features has a task; the shared helper `App.notice` is introduced in T2 and reused in T4; the Outline panel name is in T5's panel whitelist; T3 changes `parseNote` output (existing test updated in the same task) before T4 builds on `maskCode`.
- **Types:** `rel`/`key` rows (T1), `{line, col}` mentions (T4), heading `line` (T3) and the workspace shape (T5) are each defined once and used by name elsewhere.
- **Review Focus:** items 1–5 are pinned in T2, T1, T4, T5, T3 respectively.
- **Proportion:** code appears only for pure-function tests; bodies are left to the implementer.
