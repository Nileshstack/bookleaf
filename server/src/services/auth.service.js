import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { signToken } from '../utils/jwt.js';

const invalidCredentials = () =>
  new AppError('Invalid email or password', { statusCode: 401, code: 'INVALID_CREDENTIALS' });

// Compared against when the email is unknown, so "no such user" takes as
// long as "wrong password" and response timing can't be used to enumerate
// accounts. Computed once, on first use.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ??= User.hashPassword('timing-equaliser-not-a-real-password'));

export const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    await bcrypt.compare(password, await dummyHash());
    throw invalidCredentials();
  }
  if (!(await user.verifyPassword(password))) throw invalidCredentials();

  return { user: user.toJSON(), token: signToken(user) };
};

export const getCurrentUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized('This account no longer exists');
  return user.toJSON();
};
