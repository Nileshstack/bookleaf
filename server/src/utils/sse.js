/**
 * Resume point for a reconnecting SSE client. EventSource sends the
 * Last-Event-ID header by itself; fetch-based clients can pass
 * ?lastEventId= instead. Anything malformed means "start fresh".
 */
export const lastEventIdOf = (req) => {
  const value = req.get('last-event-id') ?? req.query?.lastEventId;
  return typeof value === 'string' && /^[a-z0-9]{1,16}\.\d{1,12}$/i.test(value) ? value : null;
};
