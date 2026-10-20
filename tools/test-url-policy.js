'use strict';

/**
 * Pure-logic checks for the URL policy and route table (no Electron needed).
 *
 *   node _re/test-nav.js
 */

const assert = require('assert');
const path = require('path');
const nav = require(path.join(__dirname, '..', 'src', 'navigation.js'));
const apps = require(path.join(__dirname, '..', 'src', 'apps.js'));

let pass = 0;
function check(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  pass++;
}

// --- in-app navigations ----------------------------------------------------
check('home', nav.isInAppUrl('https://www.icloud.com.cn/'), true);
check('photos', nav.isInAppUrl('https://www.icloud.com.cn/photos/'), true);
check('global origin', nav.isInAppUrl('https://www.icloud.com/mail/'), true);
check('auth iframe origin', nav.isInAppUrl('https://idmsa.apple.com/appleauth/auth/authorize/signin'), true);
check('appleid origin', nav.isInAppUrl('https://appleid.apple.com/x'), true);
check('about:blank popup', nav.isInAppUrl('about:blank'), true);
check('blob child', nav.isInAppUrl('blob:https://www.icloud.com.cn/abc'), true);

// --- must NOT stay in the app window ---------------------------------------
check('support.apple.com', nav.isInAppUrl('https://support.apple.com/zh-cn/icloud'), false);
check('external', nav.isInAppUrl('https://example.com/'), false);
check('phishing lookalike', nav.isInAppUrl('https://www.icloud.com.cn.evil.example/'), false);
check('suffix trick', nav.isInAppUrl('https://evil-icloud.com.cn/'), false);
check('http downgrade', nav.isInAppUrl('http://www.icloud.com.cn/'), false);
check('file url', nav.isInAppUrl('file:///C:/x.html'), false);
check('javascript', nav.isInAppUrl('javascript:alert(1)'), false);

// --- external classification ----------------------------------------------
check('mailto', nav.isExternalUrl('mailto:a@b.c'), true);
check('tel', nav.isExternalUrl('tel:+8610000'), true);
check('support external', nav.isExternalUrl('https://support.apple.com/'), true);
check('icloud not external', nav.isExternalUrl('https://www.icloud.com.cn/photos/'), false);

// --- routes ----------------------------------------------------------------
const expectedIds = [
  'home', 'photos', 'drive', 'mail', 'notes', 'contacts',
  'calendar', 'reminders', 'find', 'icloudplus', 'settings'
];
check('route count', apps.APPS.length, expectedIds.length);
assert.deepStrictEqual(apps.APPS.map((a) => a.id), expectedIds);
pass++;

check('urlFor photos', apps.urlFor('photos'), 'https://www.icloud.com.cn/photos/');
check('urlFor alias files', apps.urlFor('files'), 'https://www.icloud.com.cn/drive/');
check('urlFor unknown', apps.urlFor('nope'), 'https://www.icloud.com.cn/');
check('appForUrl mail', apps.appForUrl('https://www.icloud.com.cn/mail/').id, 'mail');
check('appForUrl home', apps.appForUrl('https://www.icloud.com.cn/').id, 'home');
check('appForUrl none', apps.appForUrl('https://www.icloud.com.cn/unknown/'), null);
check('every route unique', new Set(apps.APPS.map((a) => a.path)).size, expectedIds.length);

console.log(`ok — ${pass} assertions passed`);
