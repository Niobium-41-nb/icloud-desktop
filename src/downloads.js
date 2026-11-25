'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeFilename(name) {
  let cleaned = String(name || 'download')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .replace(/[. ]+$/g, '');

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) {
    cleaned = '_' + cleaned;
  }

  cleaned = cleaned.slice(0, 180).replace(/[. ]+$/g, '');
  return cleaned || 'download';
}

function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function uniquePath(dir, filename, reserved = new Set()) {
  const parsed = path.parse(filename);
  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? '' : ` (${counter})`;
    const candidate = path.join(dir, `${parsed.name}${suffix}${parsed.ext}`);
    if (!reserved.has(pathKey(candidate))) {
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
      } catch {
        return candidate;
      }
    }
    counter += 1;
  }
}

function aggregateProgress(records) {
  let received = 0;
  let total = 0;
  for (const record of records) {
    if (!(record.total > 0)) return null;
    received += record.received;
    total += record.total;
  }
  if (total === 0) return null;
  return Math.min(1, received / total);
}

module.exports = { sanitizeFilename, pathKey, uniquePath, aggregateProgress };
