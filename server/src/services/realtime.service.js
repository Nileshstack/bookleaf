import { logger } from '../utils/logger.js';

/**
 * Server-Sent Events hub: holds open streams per user and pushes events to
 * them.
 *
 * STUB: connections, heartbeats and publish() all work, but nothing
 * publishes ticket events yet. That arrives with the admin reply flow.
 * In-memory, so it only reaches clients connected to this instance; scaling
 * out means putting Redis pub/sub behind publishToUser().
 */

const HEARTBEAT_MS = 25_000; // under typical 30–60s proxy idle timeouts
const RETRY_MS = 5_000;

const streamsByUser = new Map(); // userId -> Set<res>

const write = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const openStream = (req, res, user) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx-style proxies buffering the stream
  });
  res.write(`retry: ${RETRY_MS}\n\n`);

  if (!streamsByUser.has(user.id)) streamsByUser.set(user.id, new Set());
  streamsByUser.get(user.id).add(res);

  write(res, 'ready', { userId: user.id, connectedAt: new Date().toISOString() });

  // Comment lines keep idle connections from being closed by proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    const streams = streamsByUser.get(user.id);
    streams?.delete(res);
    if (streams?.size === 0) streamsByUser.delete(user.id);
  });
};

export const publishToUser = (userId, event, data) => {
  const streams = streamsByUser.get(String(userId));
  if (!streams) return 0;
  for (const res of streams) {
    try {
      write(res, event, data);
    } catch (err) {
      logger.warn('SSE write failed', { userId: String(userId), error: err.message });
    }
  }
  return streams.size;
};

export const connectionCount = () => [...streamsByUser.values()].reduce((n, s) => n + s.size, 0);
