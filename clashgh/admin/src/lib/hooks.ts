import { useCallback, useEffect, useState } from 'react';

/** Tiny data hook: load on mount, expose reload, keep last data on error. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setLoading(true);
    return fn()
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, deps);
  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const id = setInterval(() => void reload(), pollMs);
    return () => clearInterval(id);
  }, [reload, pollMs]);
  return { data, error, loading, reload };
}

/** Run an action with busy/error/ok state and an optional confirm prompt. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, confirmText?: string, okText = 'Done') => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, run, clear: () => setMsg(null) };
}
