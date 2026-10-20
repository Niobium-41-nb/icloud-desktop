'use strict';

/**
 * iCloud 桌面客户端 — Electron shell around the CloudOS web application served
 * by https://www.icloud.com.cn.
 *
 * The remote application stays the single source of truth for account, data and
 * UI. This process only supplies what a browser tab cannot: a persistent
 * identity, native window/tray lifecycle, OS-level downloads, notifications,
 * external-link isolation and deep links.
 */

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Menu, Tray, shell, dialog, session, nativeImage,
  nativeTheme, ipcMain, Notification, screen
} = require('electron');

// ---------------------------------------------------------------------------
// Identity — must be set before anything reads userData.
// ---------------------------------------------------------------------------
app.setName('iCloud');
app.setPath('userData', path.join(app.getPath('appData'), 'iCloudDesktop'));

const config = require('./config');
const windowState = require('./window-state');
const { buildMenu } = require('./menu');
const { buildTray } = require('./tray');
const { ORIGIN, APPS, urlFor, appForUrl } = require('./apps');
const { isInAppUrl } = require('./navigation');
const { log } = require('./log');

const APP_ID = 'com.icloud.desktop';
const ROOT = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(ROOT, 'assets', 'tray.png');
const PREFS_HTML = path.join(__dirname, 'preferences.html');
const ERROR_HTML = path.join(__dirname, 'error.html');

const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5, 1.75, 2, 2.5];
const HOME = ORIGIN + '/';

let mainWindow = null;
let prefsWindow = null;
let tray = null;
let quitting = false;
let trayHintShown = false;
let downloadSeq = 0;
const activeDownloads = new Map();

// ---------------------------------------------------------------------------
// Chromium configuration
// ---------------------------------------------------------------------------
// The web client autoplays MediaElement previews (Photos, Mail attachments).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * CloudOS feature-detects the browser from navigator.userAgent and rejects or
 * degrades "unsupported" clients. Present the exact Chromium build we ship,
 * under a Chrome identity, so the client sees a first-class Chromium browser
 * rather than an embedded runtime.
 */
function buildUserAgent() {
  const chrome = String(process.versions.chrome || '120.0.0.0').split('.')[0];
  const tokens = 'AppleWebKit/537.36 (KHTML, like Gecko)';
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${tokens} Chrome/${chrome}.0.0.0 Safari/537.36`;
  }
  if (process.platform === 'linux') {
    return `Mozilla/5.0 (X11; Linux x86_64) ${tokens} Chrome/${chrome}.0.0.0 Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tokens} Chrome/${chrome}.0.0.0 Safari/537.36`;
}

const USER_AGENT = buildUserAgent();
app.userAgentFallback = USER_AGENT;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function notify(title, body, onClick) {
  if (config.get('notifications') === false) return;
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: ICON_PATH });
  if (onClick) notification.on('click', onClick);
  notification.show();
}

function sanitizeFilename(name) {
  const cleaned = String(name || 'download')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 180) || 'download';
}

function currentZoom() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents.getZoomFactor();
  }
  return config.get('zoomFactor');
}

function updateProgressBar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let received = 0;
  let total = 0;
  let hasTotal = false;
  for (const record of activeDownloads.values()) {
    received += record.received || 0;
    if (record.total > 0) {
      total += record.total;
      hasTotal = true;
    }
  }
  if (!hasTotal) {
    mainWindow.setProgressBar(-1);
    return;
  }
  mainWindow.setProgressBar(Math.min(1, received / total), { mode: 'normal' });
}

// ---------------------------------------------------------------------------
// Navigation + window policy
// ---------------------------------------------------------------------------
function childWindowOptions() {
  return {
    width: 1024,
    height: 760,
    minWidth: 420,
    minHeight: 320,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: false,
      backgroundThrottling: false
    }
  };
}

function windowOpenPolicy(details) {
  const url = details.url || 'about:blank';
  if (isInAppUrl(url)) {
    return { action: 'allow', overrideBrowserWindowOptions: childWindowOptions() };
  }
  if (/^(https?|mailto|tel|sms):/i.test(url)) {
    shell.openExternal(url).catch(() => {});
  }
  return { action: 'deny' };
}

const policyApplied = new WeakSet();

/**
 * Applies the containment rules to every WebContents the app ever creates,
 * including popups spawned by Apple's sign-in flow. Idempotent: WebContents are
 * visited once from `web-contents-created`.
 */
function applyContentPolicy(contents) {
  if (policyApplied.has(contents)) return;
  policyApplied.add(contents);

  contents.setWindowOpenHandler(windowOpenPolicy);

  contents.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return;
    event.preventDefault();
    if (/^(https?|mailto|tel|sms):/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// ---------------------------------------------------------------------------
// Session: permissions, downloads, spellcheck
// ---------------------------------------------------------------------------
const GRANTED_PERMISSIONS = new Set([
  'notifications',
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
  'mediaKeySystem'
]);

function permissionDecision(permission) {
  if (permission === 'notifications') return config.get('notifications') !== false;
  return GRANTED_PERMISSIONS.has(permission);
}

function setupSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permissionDecision(permission));
  });

  ses.setPermissionCheckHandler((_wc, permission) => permissionDecision(permission));

  ses.on('will-download', onWillDownload);

  try {
    const available = ses.availableSpellCheckerLanguages || [];
    const preferred = ['zh-CN', 'zh-TW', 'en-US', 'en-GB'].filter((l) => available.includes(l));
    if (preferred.length) ses.setSpellCheckerLanguages(preferred);
  } catch {
    /* spellcheck is optional */
  }
}

function onWillDownload(_event, item) {
  const id = ++downloadSeq;
  const filename = sanitizeFilename(item.getFilename());
  const askWhereToSave = config.get('askWhereToSave') === true;
  const targetPath = askWhereToSave ? '' : uniquePath(app.getPath('downloads'), filename);

  if (askWhereToSave) {
    item.setSaveDialogOptions({
      title: '保存文件',
      defaultPath: path.join(app.getPath('downloads'), filename),
      buttonLabel: '保存'
    });
  } else {
    item.setSavePath(targetPath);
  }

  const record = {
    id,
    filename,
    received: 0,
    total: item.getTotalBytes()
  };
  activeDownloads.set(id, record);
  updateProgressBar();
  log('download start', { filename, targetPath: targetPath || '(ask)' });

  item.on('updated', () => {
    record.received = item.getReceivedBytes();
    record.total = item.getTotalBytes();
    updateProgressBar();
  });

  item.once('done', (_e, state) => {
    activeDownloads.delete(id);
    updateProgressBar();
    const savePath = item.getSavePath() || targetPath;
    log('download done', { filename, state, savePath });

    if (state === 'completed') {
      notify('下载完成', filename, () => {
        if (savePath) shell.showItemInFolder(savePath);
      });
    } else if (state === 'interrupted') {
      notify('下载失败', filename + ' 未能完成下载');
    }
  });
}

/**
 * Returns a path in `dir` that does not collide with an existing file, using
 * the same "(1)", "(2)" convention as browsers.
 */
function uniquePath(dir, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(dir, filename);
  let counter = 1;
  while (true) {
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${parsed.name} (${counter})${parsed.ext}`);
    counter += 1;
    if (counter > 999) return path.join(dir, `${Date.now()}-${filename}`);
  }
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
function applyZoom(factor) {
  const clamped = Math.min(2.5, Math.max(0.5, Number(factor) || 1));
  config.set({ zoomFactor: clamped });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(clamped);
  }
}

function zoomBy(direction) {
  const current = currentZoom();
  let index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  if (index === -1) index = ZOOM_STEPS.length - 1;
  if (direction > 0 && ZOOM_STEPS[index] <= current + 0.001) index = Math.min(ZOOM_STEPS.length - 1, index + 1);
  if (direction < 0 && ZOOM_STEPS[index] >= current - 0.001) index = Math.max(0, index - 1);
  applyZoom(ZOOM_STEPS[index]);
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function startUrl() {
  if (config.get('startPage') === 'last') {
    const last = config.get('lastUrl');
    if (last && isInAppUrl(last) && !last.startsWith('file:')) return last;
  }
  return HOME;
}

function createMainWindow() {
  const restored = windowState.restore(config.get('bounds'));
  log('createMainWindow', { restored, stored: config.get('bounds'), maximized: config.get('maximized') });

  mainWindow = new BrowserWindow({
    ...restored,
    minWidth: 380,
    minHeight: 300,
    show: false,
    title: 'iCloud',
    icon: ICON_PATH,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
      webviewTag: false,
      safeDialogs: true,
      zoomFactor: config.get('zoomFactor')
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (config.get('maximized')) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    log('ready-to-show', { visible: mainWindow.isVisible(), bounds: mainWindow.getBounds() });
  });

  mainWindow.on('show', () => log('window show', mainWindow.getBounds()));
  mainWindow.on('hide', () => log('window hide'));
  mainWindow.on('minimize', () => log('window minimize'));
  mainWindow.on('restore', () => log('window restore'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(config.get('zoomFactor'));
  });

  mainWindow.webContents.on('did-create-window', (child) => {
    if (child.removeMenu) child.removeMenu();
  });

  mainWindow.webContents.on('did-navigate', (_e, url, httpResponseCode) => {
    if (httpResponseCode >= 400) return;
    rememberUrl(url);
  });

  mainWindow.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) rememberUrl(url);
  });

  mainWindow.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    const app = appForUrl(mainWindow.webContents.getURL());
    const suffix = app && app.id !== 'home' ? ' — ' + app.label : '';
    mainWindow.setTitle((title || 'iCloud') + suffix);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // ERR_ABORTED: navigation superseded, not a failure
    if (!validatedUrl || validatedUrl.startsWith('file:')) return;
    const current = mainWindow.webContents.getURL();
    if (current.startsWith('file:')) return;
    mainWindow.loadFile(ERROR_HTML, {
      query: { code: String(code), desc: description || '', url: validatedUrl }
    });
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    const options = {
      type: 'error',
      title: 'iCloud 遇到了问题',
      message: '页面进程意外退出。',
      detail: `原因：${details.reason}`,
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      cancelId: 1
    };
    const choice = dialog.showMessageBoxSync(mainWindow, options);
    if (choice === 0) mainWindow.webContents.reload();
    else app.quit();
  });

  // Never let a page-level "unsaved changes" prompt trap the window.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (!ctrl || input.alt) return;

    if (input.key === '=' || input.key === '+') {
      event.preventDefault();
      zoomBy(1);
    } else if (input.key === '-' || input.key === '_') {
      event.preventDefault();
      zoomBy(-1);
    } else if (input.key === '0') {
      event.preventDefault();
      applyZoom(1);
    }
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    if (config.get('closeToTray') !== false) {
      event.preventDefault();
      mainWindow.hide();
      showTrayHint();
      return;
    }
    quitting = true;
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  windowState.track(mainWindow, ({ bounds, maximized }) => {
    config.set({ bounds, maximized });
  });

  mainWindow.loadURL(startUrl());
}

function rememberUrl(url) {
  if (!url || url.startsWith('file:') || !isInAppUrl(url)) return;
  if (url === config.get('lastUrl')) return;
  config.set({ lastUrl: url });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function showTrayHint() {
  if (trayHintShown) return;
  trayHintShown = true;
  notify('iCloud 仍在后台运行', '应用已最小化到托盘，同步与通知会继续工作。');
}

// ---------------------------------------------------------------------------
// Preferences window
// ---------------------------------------------------------------------------
function openPreferences() {
  try {
    if (prefsWindow && !prefsWindow.isDestroyed()) {
      prefsWindow.show();
      prefsWindow.focus();
      return;
    }

    log('openPreferences');

    prefsWindow = new BrowserWindow({
    width: 540,
    height: 780,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'iCloud 桌面版设置',
    icon: ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preferences-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (prefsWindow.removeMenu) prefsWindow.removeMenu();
  prefsWindow.loadFile(PREFS_HTML);
  prefsWindow.once('ready-to-show', () => prefsWindow.show());
  prefsWindow.on('closed', () => {
    prefsWindow = null;
  });
  } catch (err) {
    log('openPreferences failed', err);
  }
}

function applyLoginItem(enabled) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const settings = { openAtLogin: !!enabled };
  if (!app.isPackaged) {
    settings.path = process.execPath;
    settings.args = [path.resolve(ROOT)];
  }
  try {
    app.setLoginItemSettings(settings);
  } catch (err) {
    console.error('[login-item]', err.message);
  }
}

/**
 * A desktop shell has no terminal, so unexpected main-process errors are logged
 * instead of silently killing the app.
 */
function mountCrashLogging() {
  process.on('uncaughtException', (err) => log('uncaughtException', err));
  process.on('unhandledRejection', (reason) => log('unhandledRejection', reason));
}

function registerIpc() {  ipcMain.handle('settings:get', () => ({
    settings: config.all(),
    meta: {
      version: app.getVersion(),
      chrome: String(process.versions.chrome || '').split('.')[0],
      electron: process.versions.electron,
      platform: process.platform + ' ' + process.arch
    }
  }));

  ipcMain.handle('settings:set', (_event, patch) => {
    const allowed = {};
    if (!patch || typeof patch !== 'object') return config.all();

    if (typeof patch.startPage === 'string') allowed.startPage = patch.startPage === 'home' ? 'home' : 'last';
    if (typeof patch.closeToTray === 'boolean') allowed.closeToTray = patch.closeToTray;
    if (typeof patch.notifications === 'boolean') allowed.notifications = patch.notifications;
    if (typeof patch.askWhereToSave === 'boolean') allowed.askWhereToSave = patch.askWhereToSave;
    if (typeof patch.launchAtLogin === 'boolean') {
      allowed.launchAtLogin = patch.launchAtLogin;
      applyLoginItem(patch.launchAtLogin);
    }
    if (Number.isFinite(patch.zoomFactor)) allowed.zoomFactor = patch.zoomFactor;

    const next = config.set(allowed);
    if (allowed.zoomFactor !== undefined) applyZoom(allowed.zoomFactor);
    return next;
  });

  ipcMain.handle('app:clear-data', async () => {
    try {
      const ses = session.defaultSession;
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearHostResolverCache();
      config.set({ lastUrl: '' });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(HOME);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('prefs:close', () => {
    if (prefsWindow && !prefsWindow.isDestroyed()) prefsWindow.close();
  });
}

// ---------------------------------------------------------------------------
// Actions shared by menu + tray
// ---------------------------------------------------------------------------
const actions = {
  showWindow: () => showMainWindow(),

  openApp(id) {
    showMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const target = urlFor(id);
    const current = mainWindow.webContents.getURL();
    try {
      const currentPath = new URL(current).pathname.replace(/\/+$/, '') || '/';
      const targetPath = new URL(target).pathname.replace(/\/+$/, '') || '/';
      if (currentPath === targetPath) return;
    } catch {
      /* about:blank or file: — fall through to navigation */
    }
    mainWindow.loadURL(target);
  },

  openInBrowser() {
    shell.openExternal(ORIGIN).catch(() => {});
  },

  openExternal(url) {
    shell.openExternal(url).catch(() => {});
  },

  openDownloadsFolder() {
    shell.openPath(app.getPath('downloads')).catch(() => {});
  },

  reload() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  },

  forceReload() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
  },

  setZoom(factor) {
    applyZoom(factor);
  },

  zoomBy(direction) {
    zoomBy(direction);
  },

  toggleFullScreen() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  },

  toggleDevTools() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
  },

  sendKey(key, modifiers = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const input = {
      type: 'keyDown',
      key,
      code: 'Key' + key.toUpperCase(),
      control: !!modifiers.control,
      shift: !!modifiers.shift,
      alt: !!modifiers.alt,
      meta: !!modifiers.meta
    };
    mainWindow.webContents.sendInputEvent(input);
  },

  closeWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  },

  hideToTray() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.hide();
    showTrayHint();
  },

  openPreferences,

  about() {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: '关于 iCloud 桌面版',
      message: 'iCloud 桌面版',
      detail: [
        `版本 ${app.getVersion()}`,
        `Chromium ${process.versions.chrome}`,
        `Electron ${process.versions.electron}`,
        `Node ${process.versions.node}`,
        '',
        'iCloud 网页版（www.icloud.com.cn）的桌面外壳。',
        '账户、数据与界面均由 Apple 的 CloudOS 提供，本应用不代管任何凭据。'
      ].join('\n'),
      buttons: ['好']
    });
  },

  quit() {
    quitting = true;
    app.quit();
  }
};

// ---------------------------------------------------------------------------
// Deep links: icloud://photos, icloud://mail, ...
// ---------------------------------------------------------------------------
function handleDeepLink(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'icloud:') return false;

  const rawId = (parsed.hostname || parsed.pathname.replace(/^\/+/, '') || 'home').toLowerCase();
  const id = rawId.split('/')[0] || 'home';
  showMainWindow();
  actions.openApp(id);
  return true;
}

function registerProtocolClient() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      // Running from source: the protocol handler must re-launch electron + app.
      app.setAsDefaultProtocolClient('icloud', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('icloud');
    }
  } catch (err) {
    console.error('[protocol]', err.message);
  }
}

function consumeArgv(argv) {
  const list = (argv || []).map((a) => String(a));
  if (list.some((a) => a.toLowerCase() === '--preferences')) {
    openPreferences();
  }
  for (const arg of list) {
    if (arg.toLowerCase().startsWith('icloud://')) {
      handleDeepLink(arg);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log('single instance lock not acquired, quitting');
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    log('second-instance', argv.slice(1));
    showMainWindow();
    consumeArgv(argv);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    log('ready', {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      userData: app.getPath('userData'),
      argv: process.argv.slice(1)
    });
    config.load();
    mountCrashLogging();
    app.setAppUserModelId(APP_ID);
    registerIpc();
    setupSession();
    registerProtocolClient();

    Menu.setApplicationMenu(buildMenu(actions));

    tray = buildTray({ iconPath: TRAY_ICON_PATH, actions });
    log('tray created');

    if (config.get('launchAtLogin')) applyLoginItem(true);

    createMainWindow();
    consumeArgv(process.argv);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      else showMainWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    config.flush();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && quitting) app.quit();
  });

  app.on('web-contents-created', (_event, contents) => {
    applyContentPolicy(contents);
  });

  app.on('will-quit', () => {
    config.flush();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}
