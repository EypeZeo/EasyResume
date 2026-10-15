import { browser } from 'wxt/browser';
import { observe } from '../lib/observe';

export default defineContentScript({
  matches: ['https://www.zhipin.com/*', 'https://zhipin.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      if (message?.type !== 'COLLECT_CURRENT_PAGE') return;
      try {
        sendResponse({ observations: observe(document, location.href) });
      } catch (error) {
        sendResponse({ error: error instanceof Error ? error.message : '读取失败' });
      }
    });
  },
});
