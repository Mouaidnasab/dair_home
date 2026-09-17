import { useCallback, useEffect, useRef, useState } from "react";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetch `load` once per `deps` change and then every `intervalMs` (0 = no polling).
 * Polling pauses while the tab is hidden and catches up as soon as it becomes visible again.
 */
export function usePolling<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: unknown[]): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    loadRef.current(c.signal)
      .then(d => {
        if (!c.signal.aborted) {
          setData(d);
          setError(null);
        }
      })
      .catch(e => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    if (!intervalMs) return () => controller.current?.abort();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => document.visibilityState === "visible" && run(), intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        run();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      controller.current?.abort();
    };
  }, [run, intervalMs]);

  return { data, error, loading, refresh: run };
}
