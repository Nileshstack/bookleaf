import { z } from 'zod';
import { isObjectId } from '../utils/ids.js';

/**
 * A resource can be addressed by Mongo id or by its human-readable code
 * (BL-0003, BK013). The code form is what authors and support staff
 * actually quote to each other, and it's handy in Postman.
 */
const refOrCode = (codePattern, hint) =>
  z
    .string()
    .trim()
    .refine((v) => isObjectId(v) || codePattern.test(v), { message: `Must be an id or ${hint}` })
    .transform((v) => (isObjectId(v) ? v : v.toUpperCase()));

export const ticketRef = refOrCode(/^BL-\d{4,}$/i, 'a ticket number like BL-0001');
export const bookRef = refOrCode(/^BK\d{3,}$/i, 'a book code like BK001');

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
