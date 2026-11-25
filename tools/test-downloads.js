'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const downloads = require('../src/downloads');

let pass = 0;
function check(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  pass++;
}

check('invalid characters', downloads.sanitizeFilename('a:b/c?.txt'), 'a_b_c_.txt');
check('leading dots', downloads.sanitizeFilename('../report.txt'), '_report.txt');
check('trailing dots and spaces', downloads.sanitizeFilename('report. '), 'report');
check('reserved device name', downloads.sanitizeFilename('CON.txt'), '_CON.txt');
check('reserved device name without extension', downloads.sanitizeFilename('lpt1'), '_lpt1');
check('empty name', downloads.sanitizeFilename('...'), 'download');
check('maximum name length', downloads.sanitizeFilename('x'.repeat(300)).length, 180);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icloud-downloads-test-'));
try {
  const first = path.join(dir, 'report.pdf');
  fs.writeFileSync(first, 'existing');
  check('existing file is numbered', downloads.uniquePath(dir, 'report.pdf'), path.join(dir, 'report (1).pdf'));
  fs.writeFileSync(path.join(dir, 'report (1).pdf'), 'existing');
  check('numbering continues', downloads.uniquePath(dir, 'report.pdf'), path.join(dir, 'report (2).pdf'));

  const reservedPath = path.join(dir, 'parallel.txt');
  const reserved = new Set([downloads.pathKey(reservedPath)]);
  check('in-flight path is reserved', downloads.uniquePath(dir, 'parallel.txt', reserved), path.join(dir, 'parallel (1).txt'));

  if (process.platform === 'win32') {
    const caseReserved = new Set([downloads.pathKey(path.join(dir, 'Case.TXT'))]);
    check('Windows reservations ignore case', downloads.uniquePath(dir, 'case.txt', caseReserved), path.join(dir, 'case (1).txt'));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

check('known download progress', downloads.aggregateProgress([
  { received: 25, total: 100 },
  { received: 25, total: 100 }
]), 0.25);
check('unknown total is indeterminate', downloads.aggregateProgress([
  { received: 25, total: 100 },
  { received: 50, total: 0 }
]), null);
check('no downloads clears progress', downloads.aggregateProgress([]), null);
check('progress is clamped', downloads.aggregateProgress([{ received: 120, total: 100 }]), 1);

console.log(`ok — ${pass} download assertions passed`);
