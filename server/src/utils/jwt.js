import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ALGORITHM = 'HS256';

/** The token carries only the user id and role; everything else is loaded fresh per request. */
export const signToken = (user) =>
  jwt.sign({ role: user.role }, env.jwt.secret, {
    subject: String(user._id),
    expiresIn: env.jwt.expiresIn,
    algorithm: ALGORITHM,
  });

// Pinning the algorithm blocks "alg: none" and algorithm-confusion tokens.
// Throws JsonWebTokenError / TokenExpiredError, which errorHandler maps to 401.
export const verifyToken = (token) => jwt.verify(token, env.jwt.secret, { algorithms: [ALGORITHM] });

/** Milliseconds until the token expires, used to align the cookie lifetime with the JWT. */
export const msUntilExpiry = (token) => jwt.decode(token).exp * 1000 - Date.now();
