import { useEffect } from 'react';

export const LIVE_REFRESH_INTERVAL_MS = 15_000;
export const STANDARD_REFRESH_INTERVAL_MS = 30_000;

export function useAutoRefresh(refresh: () => Promise<void>, intervalMs: number | false) {
  useEffect(() => {
    if (intervalMs === false) return;

    let refreshing = false;
    const run = async () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false || refreshing) return;
      refreshing = true;
      try {
        await refresh();
      } finally {
        refreshing = false;
      }
    };
    const onActive = () => { void run(); };
    const timer = window.setInterval(onActive, intervalMs);
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);
    window.addEventListener('online', onActive);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
      window.removeEventListener('online', onActive);
    };
  }, [intervalMs, refresh]);
}
