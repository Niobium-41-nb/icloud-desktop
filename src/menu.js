'use strict';

const { Menu, app } = require('electron');
const { APPS } = require('./apps');

/**
 * Builds the application menu. All native capabilities of the shell are
 * reachable from here, which also documents the keyboard shortcuts.
 *
 * @param {object} actions
 */
function buildMenu(actions) {
  const isMac = process.platform === 'darwin';

  const appItems = APPS.map((entry, index) => ({
    label: entry.label,
    accelerator: index === 0 ? 'Alt+0' : `Alt+${index}`,
    click: () => actions.openApp(entry.id)
  }));

  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: actions.openPreferences },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push(
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '打开 iCloud 首页',
          accelerator: 'Alt+Home',
          click: () => actions.openApp('home')
        },
        {
          label: '在默认浏览器中打开',
          click: actions.openInBrowser
        },
        { type: 'separator' },
        {
          label: '打开下载文件夹',
          click: actions.openDownloadsFolder
        },
        { type: 'separator' },
        {
          label: '关闭窗口',
          accelerator: 'CmdOrCtrl+W',
          click: actions.closeWindow
        },
        ...(isMac ? [] : [{ type: 'separator' }, { label: '退出', accelerator: 'CmdOrCtrl+Q', click: actions.quit }])
      ]
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴为纯文本' },
        { role: 'delete', label: '删除' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        {
          label: '查找…',
          accelerator: 'CmdOrCtrl+F',
          click: () => actions.sendKey('f', { control: true })
        }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', click: actions.forceReload },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => actions.setZoom(1) },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => actions.zoomBy(1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => actions.zoomBy(-1) },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', click: actions.toggleFullScreen },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: actions.toggleDevTools }
      ]
    },
    {
      label: '应用(&A)',
      submenu: appItems
    },
    {
      label: '窗口(&W)',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(isMac ? [{ role: 'zoom', label: '缩放' }] : []),
        { type: 'separator' },
        {
          label: '隐藏到托盘',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: actions.hideToTray
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: actions.openPreferences
        },
        { type: 'separator' },
        {
          label: 'iCloud 帮助',
          click: () => actions.openExternal('https://support.apple.com/zh-cn/icloud')
        },
        {
          label: '关于 iCloud 桌面版',
          click: actions.about
        }
      ]
    }
  );

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
