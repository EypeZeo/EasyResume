import { browser } from 'wxt/browser';
import { localServer } from '../lib/observe';
import { pairingInfo } from '../lib/connection';

/** Only short-lived pairing offers cross this page boundary; never a stored token. */
export default defineContentScript({
  matches: ['http://127.0.0.1/*'],
  runAt: 'document_idle',
  main(ctx) {
    let pending = false;
    let requestId = '';
    let expires = 0;
    let finished = false;
    let attemptVersion = 0;
    let explicitPending = false;

    const tryConnect = async (allowHidden = false) => {
      if (pending) {
        if (allowHidden) explicitPending = true;
        return;
      }
      if (finished || (!allowHidden && document.visibilityState === 'hidden')) return;
      const version = attemptVersion;
      pending = true;
      try {
        const base = localServer(location.origin);
        const response = await fetch(`${base}/api/v1/health`, {
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return;
        const health = await response.json();
        if (version !== attemptVersion || health.name !== 'EasyResume' || health.protocol !== 1)
          return;
        const status = await browser.runtime.sendMessage({ type: 'WORKBENCH_BRIDGE_STATUS', base });
        if (version !== attemptVersion) return;
        if (status?.connected) {
          finished = true;
          return;
        }
        // Explicit disconnect / revoked pairings stay disconnected until user reconnects.
        if (!status?.needs_pairing) return;
        requestId = crypto.randomUUID();
        expires = Date.now() + 30000;
        window.dispatchEvent(
          new CustomEvent('easyresume:extension-request', {
            detail: { request_id: requestId },
          }),
        );
      } catch {
        // Opening another local application must not show errors or trigger pairing.
      } finally {
        pending = false;
        if (explicitPending) {
          explicitPending = false;
          finished = false;
          void tryConnect(true);
        }
      }
    };

    ctx.addEventListener(window, 'easyresume:extension-offer', (event) => {
      const detail = (event as CustomEvent).detail;
      if (finished || !requestId || expires <= Date.now() || detail?.request_id !== requestId)
        return;
      let input: string;
      try {
        if (typeof detail.info !== 'string' || detail.info.length > 2000) return;
        const info = pairingInfo(detail.info);
        if (info.base !== location.origin) return;
        input = detail.info;
      } catch {
        return;
      }
      requestId = '';
      void browser.runtime
        .sendMessage({ type: 'WORKBENCH_BRIDGE_PAIR', info: input })
        .then((result) => {
          if (result?.connected) {
            finished = true;
            window.dispatchEvent(new CustomEvent('easyresume:extension-connected'));
          }
        })
        .catch(() => {});
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message?.type !== 'WORKBENCH_RECONNECT' ||
        sender.id !== browser.runtime.id ||
        !sender.url?.startsWith(`chrome-extension://${browser.runtime.id}/`)
      )
        return;
      attemptVersion++;
      finished = false;
      requestId = '';
      expires = 0;
      // This message follows the user's Connect action; it may reach an inactive workbench tab.
      void tryConnect(true).then(() => sendResponse({ requested: true }));
      return true;
    });
    ctx.addEventListener(window, 'easyresume:workbench-ready', () => void tryConnect());
    ctx.addEventListener(document, 'visibilitychange', () => void tryConnect());
    ctx.addEventListener(window, 'focus', () => void tryConnect());
    void tryConnect();
    for (const delay of [1000, 3000, 10000]) ctx.setTimeout(() => void tryConnect(), delay);
  },
});
