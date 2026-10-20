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

/** Non-http schemes that the renderer legitimately produces for child windows. */
const OPAQUE_SCHEMES = new Set(['about:', 'blob:', 'data:', 'chrome:', 'devtools:']);

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

function isInAppUrl(rawUrl) {
  if (!rawUrl) return false;
  if (rawUrl === 'about:blank') return true;
  const scheme = schemeOf(rawUrl);
  if (OPAQUE_SCHEMES.has(scheme)) return true;
  if (scheme !== 'https:') return false;
  const host = hostOf(rawUrl);
  return IN_APP_HOSTS.some((h) => host === h || host.endsWith('.' + h));
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
