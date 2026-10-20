const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Backlinks, tags, search, welcome stats and the graph all come from the vault index: real link resolution (case-insensitive,
// non-ASCII stems), snippets, live re-render when the index changes, no injected markup, and one graph loop / click handler.
module.exports = {
  seed: { 'A.md': 'links to [[B]] #alpha', 'B.md': '# B', 'Çalışma.md': 'see [[b]]' },

  async run({ win, vault, js, sleep }) {
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => { if (level >= 3) errors.push(message); });
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const panelText = () => js('document.getElementById("fileTree").textContent');
    const waitPanel = async (parts, what) => {
      let last;
      try {
        await poll(async () => { last = await panelText(); return parts.every((p) => last.includes(p)); }, what);
      } catch (err) {
        throw new Error(`${err.message}; the panel shows ${JSON.stringify(last)}`);
      }
    };
    const graphVisible = () => js('document.getElementById("graphView").classList.contains("visible")');
    const editorShown = () => js('getComputedStyle(document.getElementById("editorPane")).display !== "none"');

    await js('window.alert = () => {}; window.confirm = () => true; 0');

    // The index data the renderer keeps
    await js('App.refreshIndex()');
    assert.deepEqual(await js('App._notes.map((n) => n.stem)'), ['A', 'B', 'Çalışma']);
    assert.deepEqual(await js('[...App._stemSet].sort()'), ['a', 'b', 'çalışma']);
    assert.deepEqual(await js('App._tags.map((t) => [t.tag, t.count])'), [['alpha', 1]]);

    // Welcome stats: notes and distinct tags from the index
    await js('App.updateWelcomeStats()');
    const stats = await js(`[...document.querySelectorAll('#welcomeStats .welcome-stat')].map((s) =>
      s.querySelector('.welcome-stat-label').textContent.trim() + '=' + s.querySelector('.welcome-stat-value').textContent.trim())`);
    assert.deepEqual(stats.slice(0, 2), ['Notes=3', 'Tags=1']);

    // Backlinks of B: both linking notes with their context line ([[b]] and [[B]] resolve alike)
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'B.md'))})`);
    await js('App.togglePanel("backlinks")');
    await waitPanel(['2 backlinks', 'A', 'links to [[B]]', 'Çalışma', 'see [[b]]'], 'the backlinks of B');

    // Tags: each tag lists its notes when expanded, and nothing opens by itself
    await js('App.togglePanel("tags")');
    await waitPanel(['#alpha (1)'], 'the tag alpha');
    const shownTagNotes = () => js('[...document.querySelectorAll("#fileTree .tag-note")].filter((e) => e.offsetParent !== null).map((e) => e.textContent)');
    assert.deepEqual(await shownTagNotes(), [], 'tag notes shown before expanding');
    await js('document.querySelector("#fileTree .tag-item").click()');
    assert.deepEqual(await shownTagNotes(), ['A']);
    assert.ok((await js('App.activeTab')).endsWith('/B.md'), 'expanding a tag opened a note');

    // Search: snippet rows; a note written from outside shows up live, its markup stays text, focus stays in the box
    await js('App.togglePanel("search")');
    await js(`(() => {
      const input = document.getElementById('searchInput');
      input.focus();
      input.value = 'links';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await poll(() => js('document.getElementById("searchResults").textContent.includes("links to [[B]] #alpha")'), 'the search snippet');
    fs.writeFileSync(path.join(vault, 'Evil.md'), '<img src=x onerror="window.__xss = 1"> links');
    await poll(() => js('document.getElementById("searchResults").textContent.includes("<img src=x")'), 'the new note in the search results');
    assert.equal(await js('document.querySelectorAll("#searchResults img").length'), 0, 'note text was parsed as HTML');
    assert.equal(await js('window.__xss'), undefined);
    assert.equal(await js('document.activeElement && document.activeElement.id'), 'searchInput', 'the re-render took focus from the search box');
    assert.equal(await js('document.getElementById("searchInput").value'), 'links');
    await js(`(() => {
      const input = document.getElementById('searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await poll(() => js('document.getElementById("searchResults").children.length === 0'), 'cleared results');

    // Graph: one live loop and click handler, stops when settled, editor back when another panel is chosen
    // The hidden test window paints about once a second (and Windows timers tick at ~15 ms): count frames and run each one as
    // soon as the page is idle instead, so the ~500 frames a layout takes to settle pass in well under a second
    await js(`(() => {
      window.__frames = 0;
      const queue = [];
      const channel = new MessageChannel();
      channel.port1.onmessage = () => queue.shift()(performance.now());
      window.requestAnimationFrame = (f) => { window.__frames++; queue.push(f); channel.port2.postMessage(0); return window.__frames; };
    })()`);
    const settled = async (what) => {
      let before = -1;
      await poll(async () => {
        const now = await js('window.__frames');
        const still = now === before;
        before = now;
        if (!still) await sleep(250);
        return still;
      }, what, 15000);
    };
    await js('App.togglePanel("graph")');
    assert.equal(await graphVisible(), true, 'graph not shown');
    await poll(() => js('App._graphCleanup instanceof AbortController'), 'the graph to start');
    await js('window.__g1 = App._graphCleanup; 0');
    await settled('the graph loop to stop');
    assert.ok((await js('window.__frames')) > 1, 'the graph never animated');

    await js('App.togglePanel("fileExplorer")');
    assert.equal(await graphVisible(), false, 'graph still visible after choosing the file explorer');
    assert.equal(await editorShown(), true, 'editor pane not back');
    assert.equal(await js('window.__g1.signal.aborted'), true, 'hiding the graph left its loop and click handler alive');

    await js('App.togglePanel("graph")');
    await poll(() => js('App._graphCleanup instanceof AbortController && App._graphCleanup !== window.__g1'), 'the graph to start again');
    await js('window.__g2 = App._graphCleanup; document.getElementById("btnGraphRefresh").click(); 0');
    await poll(() => js('App._graphCleanup instanceof AbortController && App._graphCleanup !== window.__g2'), 'Refresh to restart the graph');
    assert.equal(await js('window.__g2.signal.aborted && !App._graphCleanup.signal.aborted'), true, 'Refresh left two graph loops');

    await js('window.__g3 = App._graphCleanup; App.togglePanel("graph"); 0'); // the same button again collapses the panel
    assert.equal(await graphVisible(), false, 'graph still visible after collapsing its panel');
    assert.equal(await editorShown(), true, 'editor pane not back after collapsing');
    assert.equal(await js('window.__g3.signal.aborted'), true, 'collapsing left the graph loop alive');

    // Wikilink suggestions match non-ASCII stems and show them as text
    await js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = '[[çal';
      t.selectionStart = t.selectionEnd = t.value.length;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    assert.deepEqual(await js('[...document.querySelectorAll(".wikilink-item .wikilink-name")].map((e) => e.textContent)'), ['Çalışma']);

    assert.deepEqual(errors, [], 'renderer errors');
  },
};
