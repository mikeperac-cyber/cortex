const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeExternalUrl(url) {
  if (typeof url !== 'string') return false; // new URL() would stringify anything, e.g. ['https://a.b']
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

module.exports = { isSafeExternalUrl };
