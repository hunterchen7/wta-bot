import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { adminRequest } from '../api';
import { useAutoRefresh } from './useAutoRefresh';

type CacheEntry = { data: unknown; updatedAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const FRESH_FOR_MS = 30_000;
const KEEP_FOR_MS = 5 * 60_000;

function cached<T>(path: string): { data: T; fresh: boolean } | null {
  const entry = cache.get(path);
  if (!entry) return null;
  const age = Date.now() - entry.updatedAt;
  if (age > KEEP_FOR_MS) { cache.delete(path); return null; }
  return { data: entry.data as T, fresh: age <= FRESH_FOR_MS };
}

async function fetchAdminData<T>(path: string, force = false): Promise<T> {
  const existing = cached<T>(path);
  if (!force && existing?.fresh) return existing.data;
  const pending = inFlight.get(path) as Promise<T> | undefined;
  if (pending) return pending;
  const request = adminRequest<T>(path).then((data) => {
    cache.set(path, { data, updatedAt: Date.now() });
    return data;
  }).finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}

export function preloadAdminData(path: string) { void fetchAdminData(path).catch(() => undefined); }

export function useAdminData<T>(path: string, refreshIntervalMs: number | false = false) {
  const initial = cached<T>(path);
  const [data, setDataState] = useState<T | null>(() => initial?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const load = useCallback(async (force = true) => {
    const existing = cached<T>(path);
    if (existing) setDataState(existing.data);
    if (!existing || force) setLoading(true);
    try { setDataState(await fetchAdminData<T>(path, force)); setError(null); }
    catch (cause) { if (!existing) setError(cause instanceof Error ? cause.message : 'Could not load data.'); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => {
    const existing = cached<T>(path);
    if (existing?.fresh) { setDataState(existing.data); setLoading(false); return; }
    void load(false);
  }, [load, path]);
  const setData = useCallback((value: SetStateAction<T | null>) => {
    setDataState((current) => {
      const next = typeof value === 'function' ? (value as (current: T | null) => T | null)(current) : value;
      if (next === null) cache.delete(path); else cache.set(path, { data: next, updatedAt: Date.now() });
      return next;
    });
  }, [path]);
  const refreshInBackground = useCallback(() => load(true), [load]);
  useAutoRefresh(refreshInBackground, refreshIntervalMs);
  return { data, error, loading, reload: load, setData };
}
