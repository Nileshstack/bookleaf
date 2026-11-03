import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * In-memory Server-Sent Events hub.
 *
 * Channels:
 *   user:<id>  one per author; only that author's ticket events
 *   admins     every admin connection
 *
 * Features:
 *   - SSE ids: every event gets an id, `<bootId>.<seq>`. EventSource sends
 *     the last one back as Last-Event-ID when it reconnects, and the hub
 *     replays what that channel missed from a short history buffer. If the
 *     gap can't be filled (server restarted, or history expired), `ready`
 *     says resync: true so the client refetches instead.
 *   - Heartbeat comments every SSE_HEARTBEAT_MS (25s), so proxies don't drop
 *     idle connections.
 *   - Cleanup on disconnect.
 *   - At most SSE_MAX_STREAMS_PER_USER streams per user; the oldest is closed.
 *   - closeAll() on shutdown, so open streams don't keep a stopping process alive.
 *
 * Scaling limitation: channels, history and connections live in this
 * process. With several API instances an event published on one instance
 * would never reach clients connected to another. publish() is the seam:
 * fan it out through Redis pub/sub and call deliverLocal() from the
 * subscriber, and move the history buffer to Redis Streams for replay.
 */

export const ADMINS_CHANNEL = 'admins';
export const userChannel = (userId) => `user:${userId}`;

const HISTORY_SIZE = 100; // per channel
const HISTORY_TTL_MS = 10 * 60 * 1000;
const RETRY_MS = 5_000;
const BOOT_ID = Date.now().toString(36);

let seq = 0;
const subscribers = new Map(); // channel -> Set<client>
const streamsByUser = new Map(); // userId -> client[] (oldest first)
const history = new Map(); // channel -> [{ seq, id, event, data, at }]
const evictedUpTo = new Map(); // channel -> highest seq dropped from history (size or age)

const frame = ({ id, event, data }) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const safeWrite = (client, chunk) => {
  try {
    client.res.write(chunk);
    return true;
  } catch (err) {
    logger.warn('SSE write failed', { userId: client.userId, error: err.message });
    return false;
  }
};

/** Drops expired entries, remembering the highest dropped seq so replay knows about the gap. */
const pruned = (channel) => {
  const now = Date.now();
  const list = history.get(channel) ?? [];
  const keep = list.filter((e) => now - e.at < HISTORY_TTL_MS);
  const dropped = list.length - keep.length;
  if (dropped) evictedUpTo.set(channel, Math.max(evictedUpTo.get(channel) ?? 0, list[dropped - 1].seq));
  history.set(channel, keep);
  return keep;
};

const remember = (channel, entry) => {
  const list = pruned(channel);
  list.push(entry);
  if (list.length > HISTORY_SIZE) {
    const removed = list.splice(0, list.length - HISTORY_SIZE);
    evictedUpTo.set(channel, Math.max(evictedUpTo.get(channel) ?? 0, removed.at(-1).seq));
  }
};

/** Delivers to clients connected to this process. Redis would call this from its subscriber. */
const deliverLocal = (channel, entry) => {
  let delivered = 0;
  for (const client of subscribers.get(channel) ?? []) if (safeWrite(client, frame(entry))) delivered += 1;
  return delivered;
};

/** Publishes an event to a channel. Returns the number of streams it reached locally. */
export const publish = (channel, event, data) => {
  seq += 1;
  const entry = { seq, id: `${BOOT_ID}.${seq}`, event, data, at: Date.now() };
  remember(channel, entry);
  return deliverLocal(channel, entry);
};

/**
 * Works out what to replay for a reconnecting client. `resync` is true when
 * the client may have missed events we can no longer send.
 */
const planReplay = (channels, lastEventId) => {
  if (!lastEventId) return { events: [], resync: false };

  const [boot, lastSeqRaw] = String(lastEventId).split('.');
  const lastSeq = Number(lastSeqRaw);
  if (boot !== BOOT_ID || !Number.isInteger(lastSeq)) return { events: [], resync: true };

  let resync = false;
  const events = [];
  for (const channel of channels) {
    // Something newer than the client's last event was already dropped: we can't fill the gap.
    if ((evictedUpTo.get(channel) ?? 0) > lastSeq) resync = true;
    events.push(...pruned(channel).filter((e) => e.seq > lastSeq));
  }
  return { events: events.sort((a, b) => a.seq - b.seq), resync };
};

const detach = (client) => {
  clearInterval(client.heartbeat);
  for (const channel of client.channels) {
    const set = subscribers.get(channel);
    set?.delete(client);
    if (set?.size === 0) subscribers.delete(channel);
  }
  const mine = streamsByUser.get(client.userId)?.filter((c) => c !== client) ?? [];
  if (mine.length) streamsByUser.set(client.userId, mine);
  else streamsByUser.delete(client.userId);
};

/**
 * Turns the response into an SSE stream subscribed to `channels`.
 * Authentication and channel choice happen before this (controllers).
 */
export const subscribe = (req, res, { userId, channels, lastEventId }) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx-style proxies buffering the stream
  });
  res.write(`retry: ${RETRY_MS}\n\n`);

  const client = { res, userId, channels, heartbeat: null };

  // Cap streams per user (each tab opens one); close the oldest.
  const mine = streamsByUser.get(userId) ?? [];
  while (mine.length >= env.sse.maxStreamsPerUser) {
    const oldest = mine.shift();
    detach(oldest);
    oldest.res.end();
  }
  streamsByUser.set(userId, [...mine, client]);
  for (const channel of channels) {
    if (!subscribers.has(channel)) subscribers.set(channel, new Set());
    subscribers.get(channel).add(client);
  }

  // Missed events first, then `ready`. Its id is the current position, so it
  // marks "caught up" and is where the next reconnect resumes from.
  const replay = planReplay(channels, lastEventId);
  for (const entry of replay.events) safeWrite(client, frame(entry));
  safeWrite(
    client,
    frame({
      id: `${BOOT_ID}.${seq}`,
      event: 'ready',
      data: { connectedAt: new Date().toISOString(), replayed: replay.events.length, resync: replay.resync },
    }),
  );

  client.heartbeat = setInterval(() => safeWrite(client, ': ping\n\n'), env.sse.heartbeatMs);
  req.on('close', () => detach(client));
};

/** Ends every stream, e.g. on shutdown, so server.close() can finish promptly. */
export const closeAll = () => {
  for (const clients of streamsByUser.values()) {
    for (const client of [...clients]) {
      detach(client);
      client.res.end();
    }
  }
};

export const stats = () => ({
  connections: [...streamsByUser.values()].reduce((n, list) => n + list.length, 0),
  channels: Object.fromEntries([...subscribers].map(([channel, set]) => [channel, set.size])),
});
