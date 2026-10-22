(function () {
  const HEADING = '## Captures';

  // "- HH:MM text" (local 24 h time) for one quick capture: whitespace runs become one space; '' when there is nothing to capture.
  function captureLine(text, now = new Date()) {
    const body = String(text ?? '').replace(/\s+/g, ' ').trim();
    const p = (n) => String(n).padStart(2, '0');
    return body ? '- ' + p(now.getHours()) + ':' + p(now.getMinutes()) + ' ' + body : '';
  }

  // Exactly the text to append to a note holding `existing` so `line` ends up under "## Captures": existing text is never rewritten,
  // the heading is added once (as a whole line, trailing spaces allowed), and a CRLF note stays CRLF.
  // shortcut: appends at the end of the file, so a Captures section that is not the last one gets the line after the sections below it.
  function captureAppendix(existing, line) {
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';
    const hasHeading = existing.split(/\r?\n/).some((l) => l.trimEnd() === HEADING);
    const open = existing === '' || existing.endsWith('\n') ? '' : eol;
    const heading = hasHeading ? '' : (existing === '' ? '' : eol) + HEADING + eol;
    return open + heading + line + eol;
  }

  const api = { captureLine, captureAppendix };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
