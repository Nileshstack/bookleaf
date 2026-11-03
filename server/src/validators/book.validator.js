import { z } from 'zod';
import { bookRef } from './common.validator.js';

export const bookParams = z.object({ bookId: bookRef });
