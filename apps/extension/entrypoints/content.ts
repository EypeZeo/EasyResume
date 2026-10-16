import { browser } from 'wxt/browser';
import { observe, observeSelection } from '../lib/observe';

export default defineContentScript({
  matches: ['https://www.zhipin.com/*', 'https://zhipin.com/*'],
  main() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      if (!['COLLECT_CURRENT_PAGE', 'COLLECT_SELECTION'].includes(message?.type)) return;
      try {
        const observations =
          message.type === 'COLLECT_SELECTION'
            ? observeSelection(document, location.href, window.getSelection()?.toString() ?? '')
            : observe(document, location.href);
        sendResponse({ observations });
      } catch (error) {
        sendResponse({ error: error instanceof Error ? error.message : '读取失败' });
      }
    });
  },
});
