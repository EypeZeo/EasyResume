import { browser } from 'wxt/browser';
import {
  listTargets,
  loadMoreTarget,
  listExhausted,
  nextPageTarget,
  observe,
  observeSelection,
  visible,
  diagnosePage,
} from '../lib/observe';
import { createBatchReader, type BatchStep } from '../lib/batch';
import {
  classifyRecruitingPage,
  observedRecruitingEntrypoints,
  type RecruitingPageStatus,
} from '../lib/navigation';

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
      listExhausted,
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      if (message?.type === 'PAGE_STATUS') {
        const page = classifyRecruitingPage(location.href);
        const result: RecruitingPageStatus = {
          page,
          entries: observedRecruitingEntrypoints(
            location.href,
            Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
              .filter(visible)
              .map((link) => ({ href: link.getAttribute('href')!, text: link.textContent ?? '' })),
          ),
          canRead: false,
          listCount: 0,
        };
        if (page.kind === 'list' || page.kind === 'detail') {
          try {
            result.listCount = listTargets(document, location.href).length;
            const observations = observe(document, location.href);
            result.canRead = observations.length > 0;
            if (observations.some((observation) => !observation.company))
              result.diagnostics = diagnosePage(document, location.href);
          } catch (error) {
            result.message = error instanceof Error ? error.message : '职位详情尚未就绪';
            result.diagnostics = diagnosePage(document, location.href);
          }
        }
        sendResponse(result);
        return;
      }
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
        sendResponse({
          observations,
          source: { href: location.href, platform: classifyRecruitingPage(location.href).platform },
          ...(message.type === 'COLLECT_CURRENT_PAGE'
            ? { diagnostics: diagnosePage(document, location.href) }
            : {}),
        });
      } catch (error) {
        sendResponse({
          error: error instanceof Error ? error.message : '读取失败',
          diagnostics: diagnosePage(document, location.href),
        });
      }
    });
  },
});
