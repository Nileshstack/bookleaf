import { env } from '../config/env.js';
import { msUntilExpiry } from './jwt.js';

export const AUTH_COOKIE = 'bl_token';

// In production the client (Vercel) and API (Render/Railway) live on
// different sites, so the cookie must be SameSite=None, which browsers only
// accept with Secure. Locally both run on localhost, so Lax is enough.
const baseOptions = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'none' : 'lax',
  path: '/',
});

export const setAuthCookie = (res, token) =>
  res.cookie(AUTH_COOKIE, token, { ...baseOptions(), maxAge: msUntilExpiry(token) });

export const clearAuthCookie = (res) => res.clearCookie(AUTH_COOKIE, baseOptions());
