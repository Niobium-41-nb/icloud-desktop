'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  clearData: () => ipcRenderer.invoke('app:clear-data'),
  close: () => ipcRenderer.invoke('prefs:close')
});
