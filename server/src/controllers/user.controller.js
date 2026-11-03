import * as userService from '../services/user.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const listUsers = async (req, res) => {
  const { items, meta } = await userService.listUsers(req.validated.query);
  sendSuccess(res, items, { meta });
};
