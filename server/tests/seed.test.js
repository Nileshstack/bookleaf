import { Book, Ticket, TicketMessage, User } from '../src/models/index.js';
import { seedDatabase } from '../src/seed/seed.js';
import { closeTestDB, connectTestDB } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;

beforeAll(() => connectTestDB('seed'));
afterAll(closeTestDB);

const snapshot = async () => ({
  users: await User.countDocuments(),
  books: await Book.countDocuments(),
  tickets: await Ticket.countDocuments(),
  messages: await TicketMessage.countDocuments(),
});

test('seeds the dataset exactly, including in-production and zero-payout books', async () => {
  await seedDatabase();

  expect(await snapshot()).toEqual({ users: 11, books: 18, tickets: 7, messages: 8 });

  const bk013 = await Book.findOne({ bookId: 'BK013' }).lean();
  expect(bk013).toMatchObject({ status: 'In Production - Cover Design', mrp: null, royaltyPerCopy: null, publicationDate: null });
  expect(await Book.findOne({ bookId: 'BK005' }).lean()).toMatchObject({ royaltyPaid: 0, royaltyPending: 2546 });

  const admin = await User.findOne({ email: 'admin@bookleaf.com' }).select('+passwordHash');
  expect(await admin.verifyPassword('Admin@123')).toBe(true);
  const author = await User.findOne({ email: 'ananya.reddy@email.com' }).select('+passwordHash');
  expect(await author.verifyPassword('Author@123')).toBe(true);
});

test('re-running is idempotent and resets demo tickets, including their ages', async () => {
  // Simulate demo drift: an admin closes a ticket, ages it, adds a message, and a password changes.
  const ananya = await Ticket.findOne({ ticketNumber: 'BL-0005' });
  await Ticket.collection.updateOne(
    { _id: ananya._id },
    { $set: { status: 'Closed', isUnresolved: false, createdAt: new Date('2020-01-01') } },
  );
  await TicketMessage.create({ ticketId: ananya._id, senderRole: 'admin', senderId: ananya.authorId, body: 'drift' });
  await User.updateOne({ email: 'ananya.reddy@email.com' }, { $set: { passwordHash: 'x' } });

  await seedDatabase();

  expect(await snapshot()).toEqual({ users: 11, books: 18, tickets: 7, messages: 8 });

  const reset = await Ticket.findOne({ ticketNumber: 'BL-0005' }).lean();
  expect(reset).toMatchObject({ status: 'Open', isUnresolved: true, priority: 'Critical', priorityRank: 0 });
  // Regression: createdAt is immutable in Mongoose and was silently kept on re-runs.
  const ageHours = (Date.now() - reset.createdAt.getTime()) / HOUR;
  expect(ageHours).toBeGreaterThan(71);
  expect(ageHours).toBeLessThan(73);

  const author = await User.findOne({ email: 'ananya.reddy@email.com' }).select('+passwordHash');
  expect(await author.verifyPassword('Author@123')).toBe(true);
});
