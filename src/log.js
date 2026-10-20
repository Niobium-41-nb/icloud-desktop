'use strict';

/**
 * Tiny append-only diagnostics log in the user data directory.
 *
 * A desktop shell has no terminal attached, so lifecycle and failure events are
 * written to `<userData>/shell.log` (rotated at ~256 KB) to keep support and
 * crash reports actionable.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_BYTES = 256 * 1024;
const FILE = path.join(app.getPath('userData'), 'shell.log');

let ready = false;

function ensureDir() {
  if (ready) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    ready = true;
  } catch {
    /* logging must never break startup */
  }
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(FILE);
    if (stat.size > MAX_BYTES) {
      fs.renameSync(FILE, FILE + '.1');
    }
  } catch {
    /* file may not exist yet */
  }
}

function log(...parts) {
  ensureDir();
  const line =
    new Date().toISOString() +
    ' ' +
    parts
      .map((p) => {
        if (p instanceof Error) return p.stack || p.message;
        if (typeof p === 'object') {
          try {
            return JSON.stringify(p);
          } catch {
            return String(p);
          }
        }
        return String(p);
      })
      .join(' ');
  try {
    rotateIfNeeded();
    fs.appendFileSync(FILE, line + '\n');
  } catch {
    /* ignore */
  }
  if (process.env.ICLOUD_DESKTOP_DEBUG) {
    // eslint-disable-next-line no-console
    console.error('[shell]', line);
  }
}

module.exports = { log, FILE };
