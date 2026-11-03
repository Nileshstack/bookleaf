import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { loginBody } from '../validators/auth.validator.js';

const router = Router();

router.post('/login', authLimiter, validate({ body: loginBody }), auth.login);
// Public on purpose: logging out must still work when the token has already
// expired. Otherwise the user is stuck with a stale cookie.
router.post('/logout', auth.logout);
router.get('/me', authenticate, auth.me);

export default router;
