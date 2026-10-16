import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'EasyResume · 只读职位助手',
    description: '由用户触发读取当前BOSS职位页面，发送到本地工作台核对。不点击沟通、不读取Cookie。',
    version: '0.2.0',
    version_name: '0.2.0-beta.1',
    permissions: ['storage', 'activeTab', 'sidePanel'],
    side_panel: { default_path: 'sidepanel.html' },
    host_permissions: ['http://127.0.0.1/*'],
  },
});
