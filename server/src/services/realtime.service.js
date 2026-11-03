import { logger } from '../utils/logger.js';

/**
 * Server-Sent Events hub: holds open streams per user (tagged with role) and
 * pushes events to one user or to everyone with a role, e.g. all admins.
 *
 * In-memory, so it only reaches clients connected to this instance; scaling
 * out means putting Redis pub/sub behind publishToUser/publishToRole.
 */

const HEARTBEAT_MS = 25_000; // under typical 30–60s proxy idle timeouts
const RETRY_MS = 5_000;

const clients = new Map(); // userId -> { role, streams: Set<res> }

const write = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const send = (userId, streams, event, data) => {
  for (const res of streams) {
    try {
      write(res, event, data);
    } catch (err) {
      logger.warn('SSE write failed', { userId, error: err.message });
    }
  }
  return streams.size;
};

export const openStream = (req, res, user) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx-style proxies buffering the stream
  });
  res.write(`retry: ${RETRY_MS}\n\n`);

  if (!clients.has(user.id)) clients.set(user.id, { role: user.role, streams: new Set() });
  clients.get(user.id).streams.add(res);

  write(res, 'ready', { userId: user.id, role: user.role, connectedAt: new Date().toISOString() });

  // Comment lines keep idle connections from being closed by proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    const client = clients.get(user.id);
    client?.streams.delete(res);
    if (client?.streams.size === 0) clients.delete(user.id);
  });
};

/** Returns how many streams received the event (0 if the user isn't connected). */
export const publishToUser = (userId, event, data) => {
  const client = clients.get(String(userId));
  return client ? send(String(userId), client.streams, event, data) : 0;
};

export const publishToRole = (role, event, data) => {
  let delivered = 0;
  for (const [userId, client] of clients) {
    if (client.role === role) delivered += send(userId, client.streams, event, data);
  }
  return delivered;
};

export const connectionCount = () => [...clients.values()].reduce((n, c) => n + c.streams.size, 0);
