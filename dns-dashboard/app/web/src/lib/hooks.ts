import { useCallback, useEffect, useRef, useState } from 'react';
import { type Overview, getJson } from './api';

/** Live overview via Server-Sent Events, falling back to polling when the stream drops. */
export function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      const tick = () => getJson<Overview>('api/overview').then(setData).catch(() => undefined);
      void tick();
      poll = setInterval(tick, 10_000);
    };
    const connect = () => {
      es = new EventSource('api/events');
      es.addEventListener('overview', (e) => {
        setData(JSON.parse((e as MessageEvent).data));
        setLive(true);
        if (poll) {
          clearInterval(poll);
          poll = undefined;
        }
      });
      es.onerror = () => {
        setLive(false);
        es?.close();
        startPolling();
        if (!closed) retry = setTimeout(connect, 15_000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      clearInterval(poll);
      clearTimeout(retry);
    };
  }, []);

  return { data, live };
}

/** Fetches JSON for `path` (null = skip), optionally refreshing on an interval. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (p: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await getJson<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (pathRef.current === p) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    void load(path);
    if (!refreshMs) return;
    const id = setInterval(() => void load(path, true), refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs, load]);

  const reload = useCallback(() => (pathRef.current ? load(pathRef.current, true) : Promise.resolve()), [load]);
  return { data, error, loading, reload };
}

/** Re-renders every `ms` – for countdowns and "x minutes ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useHashRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'overview';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => (window.location.hash = `/${r}`)];
}
