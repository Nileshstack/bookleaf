import { Router } from 'express';
import * as users from '../controllers/user.controller.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/index.js';
import { listUsersQuery } from '../validators/user.validator.js';

const router = Router();

// Admin-only: the author directory, and later the list of assignable agents.
router.use(authorize(ROLES.ADMIN));

router.get('/', validate({ query: listUsersQuery }), users.listUsers);

export default router;
