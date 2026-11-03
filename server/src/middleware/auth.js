import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { AUTH_COOKIE } from '../utils/authCookie.js';
import { verifyToken } from '../utils/jwt.js';

/** An explicit Authorization header (Postman, scripts) wins over the browser cookie. */
const extractToken = (req) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  return match?.[1] ?? req.cookies?.[AUTH_COOKIE] ?? null;
};

/**
 * Verifies the JWT and loads the user. The DB lookup costs one indexed read
 * per request. In return, a deleted account or a changed role takes effect
 * immediately instead of when the token expires.
 */
export const authenticate = async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized();

  const payload = verifyToken(token);
  const user = await User.findById(payload.sub).lean();
  if (!user) throw AppError.unauthorized('This account no longer exists');

  req.user = {
    id: String(user._id),
    role: user.role,
    name: user.name,
    email: user.email,
    authorCode: user.authorCode,
  };
  next();
};

/** Role gate. Must run after authenticate. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (!roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
