import { useEffect } from 'react';
import { post } from './api';

/** Give the installed bridge a short-lived code, never the workbench session credential. */
export function useExtensionBridge(online: boolean) {
  useEffect(() => {
    if (!online || location.hostname !== '127.0.0.1' || location.protocol !== 'http:') return;
    let lastRequest = 0;
    let busy = false;
    let mounted = true;
    const listener = async (event: Event) => {
      const id = (event as CustomEvent).detail?.request_id;
      if (
        typeof id !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(id) ||
        busy ||
        Date.now() - lastRequest < 10000
      )
        return;
      busy = true;
      lastRequest = Date.now();
      try {
        const pairing = await post('/pairing');
        if (mounted)
          window.dispatchEvent(
            new CustomEvent('easyresume:extension-offer', {
              detail: {
                request_id: id,
                info: JSON.stringify({
                  base: location.origin,
                  code: pairing.code,
                  protocol: 1,
                  expires_at: pairing.expires_at,
                }),
              },
            }),
          );
      } catch {
        // The bridge retries; manual pairing remains available in Settings.
      } finally {
        busy = false;
      }
    };
    window.addEventListener('easyresume:extension-request', listener);
    window.dispatchEvent(new CustomEvent('easyresume:workbench-ready'));
    return () => {
      mounted = false;
      window.removeEventListener('easyresume:extension-request', listener);
    };
  }, [online]);
}
