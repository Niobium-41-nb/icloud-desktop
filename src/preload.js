'use strict';

/**
 * Runs inside the CloudOS page. The surface is intentionally tiny: the page is
 * third-party code (Apple's), so it gets no privileged bridge into the shell.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('icloudDesktop', Object.freeze({
  isDesktopShell: true,
  platform: process.platform,
  chromeVersion: String(process.versions.chrome || '').split('.')[0]
}));
