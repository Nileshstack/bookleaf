import { User } from '../models/index.js';
import { pageMeta, paginate } from './access.js';

export const listUsers = async ({ role, page, limit }) => {
  const filter = role ? { role } : {};
  const { skip } = paginate({ page, limit });
  const [users, total] = await Promise.all([
    User.find(filter).sort({ role: 1, name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items: users.map((u) => u.toJSON()), meta: pageMeta({ page, limit }, total) };
};
