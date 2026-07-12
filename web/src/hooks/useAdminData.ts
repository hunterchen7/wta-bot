import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '../api';

export function useAdminData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminRequest<T>(path)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load data.'); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
