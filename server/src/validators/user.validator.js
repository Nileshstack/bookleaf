import { z } from 'zod';
import { ROLES } from '../models/index.js';
import { paginationQuery } from './common.validator.js';

export const listUsersQuery = z.object({
  role: z.enum(Object.values(ROLES)).optional(),
  ...paginationQuery,
});
