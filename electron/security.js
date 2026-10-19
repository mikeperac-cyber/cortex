const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeExternalUrl(url) {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

module.exports = { isSafeExternalUrl };
