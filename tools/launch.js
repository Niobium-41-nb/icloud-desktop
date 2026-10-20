'use strict';

/**
 * Launches the app with the Electron runtime.
 *
 * Some hosts (including Electron-based terminals and IDEs) export
 * ELECTRON_RUN_AS_NODE=1 for their child processes. If that leaks into our
 * launcher, the Electron binary degrades to plain Node and the app cannot
 * start, so it is stripped here.
 */

const { spawn } = require('child_process');
const path = require('path');

const electronBinary = require('electron');
const appDir = path.resolve(__dirname, '..');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = [appDir, ...process.argv.slice(2)];

const child = spawn(electronBinary, args, {
  cwd: appDir,
  env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 0 : code);
});
