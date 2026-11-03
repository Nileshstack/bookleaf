"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

export type SSEStatus = "connecting" | "open" | "reconnecting" | "closed";

type Handlers = Record<string, (data: unknown) => void>;

interface Options {
  enabled?: boolean;
  /** Called when the server says it couldn't replay everything we missed (ready.resync). */
  onResync?: () => void;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribes to a Server-Sent Events stream with the session cookie.
 *
 * - Named events are dispatched to `handlers`, as parsed JSON. Handlers are
 *   read through useEffectEvent, so passing new functions never reconnects.
 *   Only the URL or the set of event names does.
 * - The browser's EventSource reconnects by itself after network blips and
 *   sends Last-Event-ID, so the server replays what we missed. If the stream
 *   is closed for good (e.g. the server restarted, or an HTTP error), we open
 *   a new one with exponential backoff and pass the last id as ?lastEventId.
 * - The last id is kept in a ref, so a page that Next.js hides and shows
 *   again (Activity) resumes where it left off.
 */
export function useSSE(url: string, handlers: Handlers, { enabled = true, onResync }: Options = {}): SSEStatus {
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const lastEventIdRef = useRef<string | null>(null);
  const eventNames = Object.keys(handlers).sort().join(",");

  const dispatch = useEffectEvent((name: string, data: unknown) => handlers[name]?.(data));
  const resync = useEffectEvent(() => onResync?.());

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const remember = (e: MessageEvent) => {
      if (e.lastEventId) lastEventIdRef.current = e.lastEventId;
    };

    const connect = () => {
      const target = new URL(url, window.location.origin); // url may be relative in proxy mode
      if (lastEventIdRef.current) target.searchParams.set("lastEventId", lastEventIdRef.current);
      source = new EventSource(target.toString(), { withCredentials: true });
      setStatus(attempt === 0 ? "connecting" : "reconnecting");

      source.addEventListener("ready", (e) => {
        const msg = e as MessageEvent;
        attempt = 0;
        remember(msg);
        setStatus("open");
        try {
          if (JSON.parse(msg.data)?.resync) resync();
        } catch {
          /* ignore malformed ready payloads */
        }
      });

      for (const name of eventNames.split(",").filter(Boolean)) {
        source.addEventListener(name, (e) => {
          const msg = e as MessageEvent;
          remember(msg);
          try {
            dispatch(name, JSON.parse(msg.data));
          } catch (err) {
            console.error(`SSE handler for "${name}" failed`, err);
          }
        });
      }

      source.onerror = () => {
        if (disposed) return;
        if (source?.readyState === EventSource.CONNECTING) {
          setStatus("reconnecting"); // the browser is retrying by itself
          return;
        }
        // CLOSED: the browser gave up. Retry ourselves with backoff.
        source?.close();
        attempt += 1;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
      setStatus("closed");
    };
  }, [url, enabled, eventNames]);

  return status;
}
