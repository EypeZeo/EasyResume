import { browser } from 'wxt/browser';
import { localServer, type Observation } from '../lib/observe';

type Connection = { base: string; token: string; installation: string };

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      sender.id !== browser.runtime.id ||
      !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
    )
      return;
    void handle(message).then(sendResponse).catch((error) => sendResponse({
      error: error instanceof Error ? error.message : '本地连接失败',
    }));
    return true;
  });
  async function handle(message: any): Promise<any> {
    if (message?.type === 'STATUS') {
      const { connection } = await browser.storage.local.get<{ connection?: Connection }>(
        'connection',
      );
      return {
        connected: !!connection,
        base: connection?.base,
        installation: connection?.installation,
        sending: false,
      };
    }
    if (message?.type === 'PAIR') {
      const base = localServer(message.base);
      const response = await fetch(`${base}/api/v1/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: String(message.code),
          protocol: 1,
          label: 'Chrome / Edge 只读采集',
        }),
      });
      const body = await response.json();
      if (!response.ok || body.protocol !== 1)
        throw new Error(body.detail || '配对失败或协议不兼容');
      await browser.storage.local.set({
        connection: { base, token: body.token, installation: body.installation_id },
      });
      return { connected: true };
    }
    if (message?.type === 'DISCONNECT') {
      await browser.storage.local.remove('connection');
      return { disconnected: true };
    }
    if (message?.type === 'READ') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (
        !tab?.id ||
        (tab.url && !tab.url.startsWith('https://www.zhipin.com/') &&
          !tab.url.startsWith('https://zhipin.com/'))
      )
        throw new Error('请先打开BOSS职位列表或详情页');
      try {
        return await browser.tabs.sendMessage(tab.id, { type: 'COLLECT_CURRENT_PAGE' });
      } catch {
        throw new Error('请刷新招聘页面，使新安装的只读扩展生效');
      }
    }
    if (message?.type === 'SAVE') {
      const { connection } = await browser.storage.local.get<{ connection?: Connection }>(
        'connection',
      );
      if (!connection) throw new Error('请先在工作台生成配对码');
      const observations: Observation[] = message.observations;
      if (!Array.isArray(observations) || observations.length > 20)
        throw new Error('一次最多保存当前页20条观察');
      let count = 0;
      for (const observation of observations) {
        const url = new URL(observation.url);
        if (!['www.zhipin.com', 'zhipin.com'].includes(url.hostname) || url.protocol !== 'https:')
          throw new Error('观察来源不匹配');
        const response = await fetch(`${localServer(connection.base)}/api/v1/observations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(observation),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || '保存失败，请重新配对');
        count++;
      }
      return { saved: count };
    }
    throw new Error('不支持的操作；此扩展没有发送或审批能力');
  }
});
