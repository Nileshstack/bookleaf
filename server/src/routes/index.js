import { Router } from 'express';
import healthRoutes from './health.routes.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

/** Mounted at /api/v1. */
const router = Router();

// Registered before the limiter so uptime monitors are never throttled.
router.use('/health', healthRoutes);

router.use(apiLimiter);

export default router;
