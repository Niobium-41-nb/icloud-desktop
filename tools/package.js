'use strict';

/**
 * Builds a portable Windows distribution into ./dist.
 *
 *   node tools/package.js
 *
 * The result is a self-contained folder containing iCloud.exe. Renaming the
 * Electron binary and stamping its version resource is what makes Windows
 * attribute taskbar identity, jump lists and toast notifications to "iCloud"
 * instead of "Electron".
 */

const path = require('path');
const fs = require('fs');

async function main() {
  const { packager } = require('@electron/packager');
  const pkg = require('../package.json');
  const appDir = path.resolve(__dirname, '..');
  const outDir = path.join(appDir, 'dist');

  const paths = await packager({
    dir: appDir,
    name: 'iCloud',
    platform: 'win32',
    arch: 'x64',
    out: outDir,
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(appDir, 'assets', 'icon.ico'),
    appVersion: pkg.version,
    buildVersion: pkg.version,
    appCopyright: 'iCloud desktop shell',
    win32metadata: {
      CompanyName: 'iCloud Desktop',
      FileDescription: 'iCloud 桌面客户端',
      ProductName: 'iCloud',
      InternalName: 'iCloud',
      OriginalFilename: 'iCloud.exe',
      'LegalCopyright': 'iCloud desktop shell'
    },
    ignore: [
      /^\/_re(\/|$)/,
      /^\/dist(\/|$)/,
      /^\/tools(\/|$)/,
      /^\/docs(\/|$)/,
      /^\/\.git(\/|$)/,
      /^\/.*\.md$/,
      /^\/package-lock\.json$/
    ]
  });

  for (const out of paths) {
    const exe = path.join(out, 'iCloud.exe');
    const size = fs.existsSync(exe) ? (fs.statSync(exe).size / (1024 * 1024)).toFixed(1) + ' MB' : 'missing';
    console.log('packaged: ' + out + '  (iCloud.exe ' + size + ')');

    // Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI, which corrupts
    // the Chinese strings. Ship the scripts with a UTF-8 BOM.
    for (const name of ['install.ps1', 'uninstall.ps1']) {
      const source = path.join(appDir, 'tools', 'installer', name);
      const target = path.join(out, name);
      const text = fs.readFileSync(source, 'utf8');
      fs.writeFileSync(target, '\uFEFF' + text, 'utf8');
    }
    console.log('         installer: install.ps1 / uninstall.ps1');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
