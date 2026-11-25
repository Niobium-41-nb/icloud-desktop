'use strict';

/**
 * Navigation policy for the embedded CloudOS client.
 *
 * The shell only hosts Apple's own origins. Everything else is handed to the
 * user's default browser so that the app never turns into a general purpose
 * browser with a stolen window (and so that phishing links cannot masquerade
 * inside the iCloud chrome).
 */

/** Top-level navigations that may stay inside the application window. */
const IN_APP_HOSTS = [
  'icloud.com.cn',
  'icloud.com',
  'idmsa.apple.com',
  'appleid.apple.com',
  'appleid.cdn-apple.com'
];

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function schemeOf(rawUrl) {
  try {
    return new URL(rawUrl).protocol;
  } catch {
    return '';
  }
}

function isTrustedHttpsUrl(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return IN_APP_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

function isInAppUrl(rawUrl) {
  if (!rawUrl) return false;
  if (rawUrl === 'about:blank') return true;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === 'blob:') {
    try {
      return isTrustedHttpsUrl(new URL(rawUrl.slice('blob:'.length)));
    } catch {
      return false;
    }
  }
  return isTrustedHttpsUrl(url);
}

/** Links that should always open in the user's browser. */
function isExternalUrl(rawUrl) {
  if (!rawUrl) return false;
  const scheme = schemeOf(rawUrl);
  if (scheme === 'mailto:' || scheme === 'tel:' || scheme === 'sms:') return true;
  if (scheme !== 'https:' && scheme !== 'http:') return false;
  return !isInAppUrl(rawUrl);
}

module.exports = { IN_APP_HOSTS, isInAppUrl, isExternalUrl, hostOf };
