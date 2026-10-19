(function () {
  // YYYY-MM-DD for the LOCAL calendar day (toISOString() is UTC, which is "yesterday" for the first hours of the day east of Greenwich).
  function localDateStr(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  const api = { localDateStr };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
