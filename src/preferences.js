'use strict';

const api = window.desktopSettings;
const $ = (id) => document.getElementById(id);
const status = $('status');
let statusTimer = null;

function flash(message) {
  status.textContent = message;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = '';
  }, 2600);
}

function render(settings, meta) {
  $('startPage').value = settings.startPage === 'home' ? 'home' : 'last';
  $('launchAtLogin').checked = !!settings.launchAtLogin;
  $('closeToTray').checked = !!settings.closeToTray;
  $('notifications').checked = !!settings.notifications;
  $('askWhereToSave').checked = !!settings.askWhereToSave;
  $('zoom').value = String(Math.round(settings.zoomFactor * 100));
  $('zoomLabel').textContent = Math.round(settings.zoomFactor * 100) + '%';
  $('meta').textContent = `版本 ${meta.version} · Chromium ${meta.chrome} · Electron ${meta.electron} · ${meta.platform}`;
}

async function init() {
  const payload = await api.get();
  render(payload.settings, payload.meta);

  $('startPage').addEventListener('change', async (e) => {
    await api.set({ startPage: e.target.value });
    flash('已保存');
  });

  $('launchAtLogin').addEventListener('change', async (e) => {
    await api.set({ launchAtLogin: e.target.checked });
    flash(e.target.checked ? '将在登录时自动启动' : '已取消自动启动');
  });

  $('closeToTray').addEventListener('change', async (e) => {
    await api.set({ closeToTray: e.target.checked });
    flash(e.target.checked ? '关闭窗口后将保留在托盘' : '关闭窗口将退出应用');
  });

  $('notifications').addEventListener('change', async (e) => {
    await api.set({ notifications: e.target.checked });
    flash(e.target.checked ? '已允许通知' : '已关闭通知');
  });

  $('askWhereToSave').addEventListener('change', async (e) => {
    await api.set({ askWhereToSave: e.target.checked });
    flash(e.target.checked ? '下载前会询问保存位置' : '下载将直接保存到「下载」文件夹');
  });

  const zoom = $('zoom');
  zoom.addEventListener('input', () => {
    $('zoomLabel').textContent = zoom.value + '%';
  });
  zoom.addEventListener('change', async () => {
    await api.set({ zoomFactor: Number(zoom.value) / 100 });
    flash('缩放已更新');
  });

  $('clear').addEventListener('click', async () => {
    $('clear').disabled = true;
    const result = await api.clearData();
    $('clear').disabled = false;
    flash(result && result.ok ? '网站数据已清除' : '清除失败');
  });

  $('done').addEventListener('click', () => api.close());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });
}

init().catch((err) => {
  $('meta').textContent = '设置界面加载失败：' + err.message;
});
