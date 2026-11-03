import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import bookRoutes from './book.routes.js';
import ticketRoutes from './ticket.routes.js';
import userRoutes from './user.routes.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { authenticate } from '../middleware/auth.js';

/** Mounted at /api/v1. */
const router = Router();

// Registered before the limiter so uptime monitors are never throttled.
router.use('/health', healthRoutes);

router.use(apiLimiter);

// Login and logout are public; /auth/me authenticates inside its own router.
router.use('/auth', authRoutes);

// Everything below requires a valid token. Unknown paths answer 401 rather
// than 404 to anonymous callers, so the route map isn't exposed.
router.use(authenticate);

router.use('/books', bookRoutes);
router.use('/tickets', ticketRoutes);
router.use('/users', userRoutes);

export default router;
