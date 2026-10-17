import { browser } from 'wxt/browser';
import {
  listTargets,
  loadMoreTarget,
  nextPageTarget,
  observe,
  observeSelection,
} from '../lib/observe';
import { createBatchReader, type BatchStep } from '../lib/batch';

export default defineContentScript({
  matches: [
    'https://www.zhipin.com/*',
    'https://zhipin.com/*',
    'https://www.zhaopin.com/*',
    'https://zhaopin.com/*',
    'https://sou.zhaopin.com/*',
    'https://jobs.zhaopin.com/*',
  ],
  main() {
    const batch = createBatchReader(document, () => location.href, {
      observe,
      listTargets,
      nextPageTarget,
      loadMoreTarget,
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      if (message?.type === 'BATCH_STEP') {
        void batch
          .step(message as BatchStep)
          .then(sendResponse)
          .catch((error) =>
            sendResponse({ error: error instanceof Error ? error.message : '读取失败，已暂停' }),
          );
        return true;
      }
      if (message?.type === 'BATCH_PREPARE' || message?.type === 'BATCH_STOP') {
        try {
          sendResponse(
            message.type === 'BATCH_PREPARE'
              ? batch.prepare(message.taskId, message.options)
              : batch.stop(message.taskId),
          );
        } catch (error) {
          sendResponse({ error: error instanceof Error ? error.message : '无法开始批量读取' });
        }
        return;
      }
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
