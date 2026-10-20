'use strict';

/**
 * Keeps the main window on screen across monitor changes and restarts.
 */

const { screen } = require('electron');

function clampToWorkArea(bounds) {
  const width = Math.max(380, Math.min(bounds.width || 1280, 10000));
  const height = Math.max(300, Math.min(bounds.height || 840, 10000));

  if (bounds.x === undefined || bounds.y === undefined) {
    return { width, height };
  }

  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const wa = d.workArea;
    const overlapX = Math.min(bounds.x + width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
    const overlapY = Math.min(bounds.y + height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
    return overlapX > 120 && overlapY > 80;
  });

  return visible ? { width, height, x: bounds.x, y: bounds.y } : { width, height };
}

/**
 * Derives a comfortable first-run size from the actual work area instead of a
 * hard-coded pixel size, so the window never opens larger than the screen on a
 * scaled display.
 */
function defaultBounds() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  return {
    width: Math.min(1280, Math.max(380, Math.round((workAreaSize.width || 1280) * 0.9))),
    height: Math.min(840, Math.max(300, Math.round((workAreaSize.height || 840) * 0.9)))
  };
}

function restore(stored) {
  if (!stored || !Number.isFinite(stored.width) || !Number.isFinite(stored.height)) {
    return defaultBounds();
  }
  return clampToWorkArea(stored);
}

function track(win, onChange) {
  let timer = null;

  const capture = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const normal = maximized ? win.getNormalBounds() : win.getBounds();
    onChange({
      bounds: { width: normal.width, height: normal.height, x: normal.x, y: normal.y },
      maximized
    });
  };

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(capture, 350);
  };

  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    capture();
  });
}

module.exports = { restore, track };
