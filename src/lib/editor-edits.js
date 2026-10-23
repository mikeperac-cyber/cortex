// Pure editor edits. Each returns an Edit { from, to, insert, selStart, selEnd }: replace text.slice(from, to) with insert,
// then select [selStart, selEnd] in the new text. App.applyEdit performs it without losing the native undo stack.
(function () {
  const LIST_ITEM = /^(\s*)(?:([-*+>])|(\d+)([.)]))( +)(\[[ xX]\] +)?/;

  // Enter at the end of a list / quote line: the next line gets the same prefix (numbers + 1, tasks unticked); an empty item ends the list
  function continueList(text, caret) {
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    const lineEnd = text.indexOf('\n', caret);
    if (caret !== (lineEnd === -1 ? text.length : lineEnd)) return null;
    const line = text.slice(lineStart, caret);
    const m = line.match(LIST_ITEM);
    if (!m) return null;
    if (m[0].length === line.length) return { from: lineStart, to: caret, insert: '', selStart: lineStart, selEnd: lineStart };
    const [, indent, mark, num, sep, gap, task] = m;
    const insert = '\n' + indent + (mark || String(Number(num) + 1) + sep) + gap + (task ? '[ ] ' : '');
    const at = caret + insert.length;
    return { from: caret, to: caret, insert, selStart: at, selEnd: at };
  }

  // Two spaces in or out on every line the selection touches (out also takes one leading tab); a bare caret indents in place
  function indentSelection(text, start, end, outdent) {
    if (!outdent && start === end) return { from: start, to: end, insert: '  ', selStart: start + 2, selEnd: start + 2 };
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const last = end > start && text[end - 1] === '\n' ? end - 1 : end; // a selection ending at a line start leaves that line alone
    const to = text.indexOf('\n', last) === -1 ? text.length : text.indexOf('\n', last);
    const lines = text.slice(from, to).split('\n');
    const out = lines.map((l) => (outdent ? (l[0] === '\t' ? l.slice(1) : l.replace(/^ {1,2}/, '')) : '  ' + l));
    const insert = out.join('\n');
    const selStart = Math.max(from, start + out[0].length - lines[0].length);
    const selEnd = Math.max(selStart, end + insert.length - (to - from));
    return { from, to, insert, selStart, selEnd };
  }

  // marker around the selection; unwraps when the markers sit just outside it or at its ends; a bare caret gets an empty pair
  function toggleWrap(text, start, end, marker) {
    const m = marker.length;
    const sel = text.slice(start, end);
    if (start !== end && start >= m && text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
      return { from: start - m, to: end + m, insert: sel, selStart: start - m, selEnd: end - m };
    }
    if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
      return { from: start, to: end, insert: sel.slice(m, -m), selStart: start, selEnd: end - 2 * m };
    }
    return { from: start, to: end, insert: marker + sel + marker, selStart: start + m, selEnd: end + m };
  }

  const api = { continueList, indentSelection, toggleWrap };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
