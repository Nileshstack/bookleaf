import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

/** Mounted at /api/v1. */
const router = Router();

// Registered before the limiter so uptime monitors are never throttled.
router.use('/health', healthRoutes);

router.use(apiLimiter);

// Login and logout are public; /auth/me authenticates inside its own router.
router.use('/auth', authRoutes);

export default router;
