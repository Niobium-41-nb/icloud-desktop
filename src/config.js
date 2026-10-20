'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  /** Last known window geometry; empty until the first run has been tracked. */
  bounds: {},
  maximized: false,
  /** Page zoom, 0.5 .. 2.5 */
  zoomFactor: 1,
  /** Hiding to the tray on close keeps background sync and notifications alive. */
  closeToTray: true,
  launchAtLogin: false,
  notifications: true,
  /** Ask for a location on every download; off = save to Downloads (Chrome default). */
  askWhereToSave: false,
  /** 'home' = always start on the iCloud home screen, 'last' = resume last route */
  startPage: 'last',
  lastUrl: ''
};

let state = { ...DEFAULTS };
let flushTimer = null;

function coerce(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;

  if (raw.bounds && typeof raw.bounds === 'object') {
    const b = raw.bounds;
    const bounds = {};
    for (const key of ['width', 'height', 'x', 'y']) {
      if (Number.isFinite(b[key])) bounds[key] = Math.round(b[key]);
    }
    out.bounds = bounds;
  }
  out.maximized = !!raw.maximized;
  if (Number.isFinite(raw.zoomFactor)) {
    out.zoomFactor = Math.min(2.5, Math.max(0.5, raw.zoomFactor));
  }
  out.closeToTray = raw.closeToTray !== false;
  out.launchAtLogin = !!raw.launchAtLogin;
  out.notifications = raw.notifications !== false;
  out.askWhereToSave = raw.askWhereToSave === true;
  out.startPage = raw.startPage === 'home' ? 'home' : 'last';
  out.lastUrl = typeof raw.lastUrl === 'string' ? raw.lastUrl : '';
  return out;
}

function load() {
  try {
    state = coerce(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    state = { ...DEFAULTS };
  }
  return state;
}

function all() {
  return { ...state, bounds: { ...state.bounds } };
}

function get(key) {
  return state[key];
}

function set(patch) {
  state = coerce({ ...state, ...patch });
  scheduleFlush();
  return all();
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[config] failed to persist settings:', err.message);
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 400);
}

module.exports = { load, all, get, set, flush, DEFAULTS, FILE };
