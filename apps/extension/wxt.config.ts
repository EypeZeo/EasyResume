import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'EasyResume · 只读职位助手',
    description: '读取 BOSS、智联当前职位或按需批量整理到 EasyResume，支持暂停和自动重连。',
    version: '0.2.0',
    version_name: '0.2.0-beta.3',
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    action: { default_icon: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png' } },
    permissions: ['storage', 'activeTab', 'sidePanel'],
    side_panel: { default_path: 'sidepanel.html' },
    host_permissions: ['http://127.0.0.1/*'],
  },
});
