// In-app dialogs. Electron 28 throws on window.prompt, so text input goes through #askOverlay instead.
const Dialogs = (() => {
  let current = null; // settles the open dialog; null when none is open

  // Resolves the trimmed text on Enter/OK, or null on Esc/Cancel/backdrop click.
  function ask({ title, value = '', placeholder = '' }) {
    if (current) current(null); // a newer dialog supersedes an open one
    const $ = (id) => document.getElementById(id);
    const overlay = $('askOverlay');
    const input = $('askInput');
    const ok = $('askOk');
    const cancel = $('askCancel');
    const opener = document.activeElement;

    $('askTitle').textContent = title;
    input.value = value;
    input.placeholder = placeholder;
    overlay.classList.add('visible');
    input.focus();
    input.select();

    return new Promise((resolve) => {
      const listeners = new AbortController();
      const done = (result) => {
        listeners.abort();
        current = null;
        overlay.classList.remove('visible');
        if (opener && opener.focus) opener.focus();
        resolve(result);
      };
      current = done;

      const { signal } = listeners;
      ok.addEventListener('click', () => done(input.value.trim()), { signal });
      cancel.addEventListener('click', () => done(null), { signal });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); }, { signal });
      // Capture phase so the global shortcuts in App never see keys meant for the dialog
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          done(null);
        } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !e.isComposing) {
          e.preventDefault(); e.stopPropagation();
          done(input.value.trim());
        } else if (e.key === 'Tab') {
          // focus trap: cycle input -> Cancel -> OK
          e.preventDefault();
          const order = [input, cancel, ok];
          const at = order.indexOf(document.activeElement);
          order[(at + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus();
        }
      }, { signal, capture: true });
    });
  }

  return { ask };
})();
