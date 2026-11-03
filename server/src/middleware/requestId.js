import { randomUUID } from 'node:crypto';

/**
 * Tags every request with an id (or reuses an upstream X-Request-Id) so a
 * client-reported error can be matched to the server log line.
 */
export const requestId = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};
