import { aiClient } from '../ai/index.js';
import { isDBConnected } from '../config/db.js';

/**
 * Liveness + dependency snapshot. Returns 503 when the database is down so
 * a load balancer stops routing traffic; a missing AI key is reported but is
 * not a failure, because the app is designed to work without it.
 */
export const getHealth = (_req, res) => {
  const dbUp = isDBConnected();

  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    data: {
      status: dbUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        database: dbUp ? 'up' : 'down',
        // "degraded" while the circuit breaker is open: AI calls are paused and fallbacks are in use.
        ai: !aiClient.enabled ? 'disabled' : aiClient.status().circuit === 'open' ? 'degraded' : 'configured',
      },
    },
  });
};
