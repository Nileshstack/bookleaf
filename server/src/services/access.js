import { ROLES } from '../models/index.js';
import { isObjectId } from '../utils/ids.js';

export const isAdmin = (user) => user.role === ROLES.ADMIN;

/**
 * Ownership is enforced inside the database query, not checked after the
 * fetch. An author's filter always carries their own authorId, so:
 *  - list endpoints can never return someone else's records, and
 *  - a single-record lookup for another author's ticket finds nothing and
 *    returns the same 404 as a ticket that doesn't exist. Answering 403
 *    would confirm that the id is real.
 */
export const scopeToOwner = (user, filter = {}) =>
  isAdmin(user) ? filter : { ...filter, authorId: user.id };

/** Turns a validated ref (Mongo id or human code) into a query filter. */
export const refFilter = (ref, codeField) => (isObjectId(ref) ? { _id: ref } : { [codeField]: ref });

export const paginate = ({ page, limit }) => ({ skip: (page - 1) * limit, limit });

export const pageMeta = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});
