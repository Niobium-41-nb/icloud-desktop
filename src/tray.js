'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const { APPS } = require('./apps');

/**
 * Tray presence lets the signed-in session keep running (and keep showing
 * notifications) while the window is closed.
 */
function buildTray({ iconPath, actions }) {
  const image = nativeImage.createFromPath(iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('iCloud');
  tray.setContextMenu(buildContextMenu(actions));
  tray.on('click', actions.showWindow);
  tray.on('double-click', actions.showWindow);
  return tray;
}

function buildContextMenu(actions) {
  return Menu.buildFromTemplate([
    { label: '显示 iCloud', click: actions.showWindow },
    { type: 'separator' },
    ...APPS.map((entry) => ({
      label: entry.label,
      click: () => actions.openApp(entry.id)
    })),
    { type: 'separator' },
    { label: '打开下载文件夹', click: actions.openDownloadsFolder },
    { label: '在浏览器中打开', click: actions.openInBrowser },
    { type: 'separator' },
    { label: '设置…', click: actions.openPreferences },
    { label: '退出', click: actions.quit }
  ]);
}

module.exports = { buildTray };
