import request from 'supertest';
import { Book, Ticket, TicketMessage, User } from '../../src/models/index.js';

export const PASSWORD = 'Author@123';

/**
 * Two authors with one book and one ticket each, plus an admin. The admin
 * has left an internal note on Priya's ticket, so tests can check it never
 * reaches her.
 */
export const createWorld = async () => {
  const passwordHash = await User.hashPassword(PASSWORD);

  const [priya, rohit, admin] = await User.create([
    { role: 'author', name: 'Priya Sharma', email: 'priya.sharma@email.com', authorCode: 'AUTH001', passwordHash },
    { role: 'author', name: 'Rohit Kapoor', email: 'rohit.kapoor@email.com', authorCode: 'AUTH002', passwordHash },
    { role: 'admin', name: 'BookLeaf Support', email: 'admin@bookleaf.com', passwordHash },
  ]);

  const [priyaBook, rohitBook] = await Book.create([
    { authorId: priya._id, bookId: 'BK001', title: 'Whispers of the Ganges', isbn: '978-93-5XXXX-01-1', status: 'Published & Live' },
    { authorId: rohit._id, bookId: 'BK003', title: 'Code & Karma', isbn: '978-93-5XXXX-03-5', status: 'Published & Live' },
  ]);

  // Created one at a time so ticket numbers are deterministic (BL-0001, BL-0002).
  const priyaTicket = await Ticket.create({
    authorId: priya._id,
    bookId: priyaBook._id,
    subject: 'Royalty question',
    description: 'When is my next payout?',
    category: 'Royalty & Payments',
    priority: 'Medium',
  });
  const rohitTicket = await Ticket.create({
    authorId: rohit._id,
    bookId: rohitBook._id,
    subject: 'ISBN mismatch',
    description: 'Amazon shows a different ISBN.',
    category: 'ISBN & Metadata Issues',
    priority: 'High',
  });

  await TicketMessage.create([
    { ticketId: priyaTicket._id, senderRole: 'admin', senderId: admin._id, body: 'Public reply to Priya' },
    { ticketId: priyaTicket._id, senderRole: 'admin', senderId: admin._id, body: 'SECRET internal note', isInternalNote: true },
  ]);

  return { priya, rohit, admin, priyaBook, rohitBook, priyaTicket, rohitTicket };
};

/** Logs in through the real endpoint and returns the Bearer token. */
export const loginAs = async (app, email, password = PASSWORD) => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token;
};

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
