'use strict';

/**
 * The CloudOS application routes exposed by www.icloud.com.cn.
 *
 * Verified against the live origin: every path below answers 200 with the
 * CloudOS shell document. The locale/session layer then decides whether the
 * signed-in account may open it.
 */

const ORIGIN = 'https://www.icloud.com.cn';

const APPS = [
  { id: 'home', label: '首页', path: '/', aliases: ['start', 'home', 'cloudos'] },
  { id: 'photos', label: '照片', path: '/photos/', aliases: ['photo', 'photos'] },
  { id: 'drive', label: 'iCloud 云盘', path: '/drive/', aliases: ['files', 'file', 'iclouddrive', 'drive'] },
  { id: 'mail', label: '邮件', path: '/mail/', aliases: ['mail', 'mail2', 'email'] },
  { id: 'notes', label: '备忘录', path: '/notes/', aliases: ['note', 'notes'] },
  { id: 'contacts', label: '通讯录', path: '/contacts/', aliases: ['contact', 'contacts'] },
  { id: 'calendar', label: '日历', path: '/calendar/', aliases: ['calendar', 'cal'] },
  { id: 'reminders', label: '提醒事项', path: '/reminders/', aliases: ['reminder', 'reminders', 'todo'] },
  { id: 'find', label: '查找', path: '/find/', aliases: ['find', 'findmy', 'find-my-iphone', 'devices'] },
  { id: 'icloudplus', label: 'iCloud+', path: '/icloudplus/', aliases: ['plus', 'icloudplus', 'storage'] },
  { id: 'settings', label: '设置', path: '/settings/', aliases: ['settings', 'preferences', 'account'] }
];

function urlFor(id) {
  const app = APPS.find(
    (a) => a.id === id || a.aliases.includes(String(id || '').toLowerCase())
  );
  return ORIGIN + (app ? app.path : '/');
}

function appForUrl(rawUrl) {
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') return APPS[0];
  const cleaned = pathname.replace(/\/+$/, '');
  return (
    APPS.find((a) => a.path !== '/' && (a.path.replace(/\/+$/, '') === cleaned || cleaned.startsWith(a.path))) ||
    null
  );
}

module.exports = { ORIGIN, APPS, urlFor, appForUrl };
