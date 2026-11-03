import * as authService from '../services/auth.service.js';
import { clearAuthCookie, setAuthCookie } from '../utils/authCookie.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const login = async (req, res) => {
  const { user, token } = await authService.login(req.validated.body);
  setAuthCookie(res, token);
  // The browser client relies on the httpOnly cookie. The token is also in the
  // body so API clients like Postman can send it as a Bearer header.
  sendSuccess(res, { user, token });
};

export const logout = (_req, res) => {
  clearAuthCookie(res);
  sendSuccess(res, { loggedOut: true });
};

export const me = async (req, res) => {
  sendSuccess(res, { user: await authService.getCurrentUser(req.user.id) });
};
