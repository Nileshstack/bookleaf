"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ApiError } from "./api";

interface ResourceState<T> {
  data: T | undefined;
  error: ApiError | null;
  /** True only for the first load or a non-silent reload. Silent reloads keep the current data on screen. */
  loading: boolean;
  reload: (opts?: { silent?: boolean }) => void;
  /** Local update, e.g. appending a message pushed over SSE. */
  mutate: (updater: (current: T | undefined) => T | undefined) => void;
}

/**
 * Minimal fetch-on-mount hook with abort, loading/error state and reload.
 *
 * With Cache Components, Next.js hides visited pages instead of unmounting
 * them, and re-runs their effects when they're shown again. So this refetches
 * whenever a page becomes visible, and lists are fresh on return.
 */
export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): ResourceState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const silentRef = useRef(false);

  const run = useEffectEvent((signal: AbortSignal) => fetcher(signal));
  const startLoading = useEffectEvent(() => {
    if (!silentRef.current) setLoading(true);
    silentRef.current = false;
  });

  useEffect(() => {
    const controller = new AbortController();
    startLoading();

    run(controller.signal)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof ApiError ? err : new ApiError({ status: 0, code: "UNKNOWN_ERROR", message: (err as Error).message }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's explicit inputs
  }, [nonce, ...deps]);

  const reload = useCallback((opts?: { silent?: boolean }) => {
    silentRef.current = Boolean(opts?.silent);
    setNonce((n) => n + 1);
  }, []);

  const mutate = useCallback((updater: (current: T | undefined) => T | undefined) => setData(updater), []);

  return { data, error, loading, reload, mutate };
}
