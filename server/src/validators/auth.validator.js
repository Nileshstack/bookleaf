import { z } from 'zod';

export const loginBody = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address' })),
  // No complexity rules at login: that would only reveal the password policy.
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(128),
});
