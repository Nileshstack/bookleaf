/**
 * Checks the seeded database for exact counts and duplicates:
 * `npm run seed && npm run seed && node scripts/verify-seed.js`.
 * Exits 1 on any mismatch.
 */
import { readFile } from 'node:fs/promises';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Book, Counter, Ticket, TicketMessage, User } from '../src/models/index.js';

const data = JSON.parse(await readFile(new URL('../src/seed/data.json', import.meta.url), 'utf8')).authors;
await connectDB();

const dupes = async (Model, field) =>
  (await Model.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])).map((d) => d._id);

const checks = [
  ['authors = 10', (await User.countDocuments({ role: 'author' })) === data.length],
  ['admins = 1', (await User.countDocuments({ role: 'admin' })) === 1],
  ['books = 18 (dataset)', (await Book.countDocuments()) === data.flatMap((a) => a.books).length],
  ['no duplicate emails', (await dupes(User, 'email')).length === 0],
  ['no duplicate bookIds', (await dupes(Book, 'bookId')).length === 0],
  ['no duplicate ISBNs', (await dupes(Book, 'isbn')).length === 0],
  ['no duplicate ticket numbers', (await dupes(Ticket, 'ticketNumber')).length === 0],
  ['seeded tickets BL-0001..BL-0007 present once each', (await Ticket.countDocuments({ ticketNumber: { $in: ['BL-0001', 'BL-0002', 'BL-0003', 'BL-0004', 'BL-0005', 'BL-0006', 'BL-0007'] } })) === 7],
  ['seeded thread messages = 8 (no duplicates)', (await TicketMessage.countDocuments({ ticketId: { $in: (await Ticket.find({ ticketNumber: /^BL-000[1-7]$/ }).distinct('_id')) } })) === 8],
  ['ticket counter >= 7', ((await Counter.findById('ticketNumber').lean())?.seq ?? 0) >= 7],
];

// Every book matches the dataset field by field.
for (const author of data) {
  const user = await User.findOne({ authorCode: author.author_id }).lean();
  for (const b of author.books) {
    const book = await Book.findOne({ bookId: b.book_id }).lean();
    const same =
      book &&
      String(book.authorId) === String(user._id) &&
      book.title === b.title &&
      book.status === b.status &&
      book.mrp === b.mrp &&
      book.royaltyPerCopy === b.author_royalty_per_copy &&
      book.totalCopiesSold === b.total_copies_sold &&
      book.totalRoyaltyEarned === b.total_royalty_earned &&
      book.royaltyPaid === b.royalty_paid &&
      book.royaltyPending === b.royalty_pending &&
      (book.lastRoyaltyPayoutDate?.toISOString().slice(0, 10) ?? null) === b.last_royalty_payout_date &&
      (book.publicationDate?.toISOString().slice(0, 10) ?? null) === b.publication_date;
    checks.push([`${b.book_id} matches dataset`, Boolean(same)]);
  }
}

for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
const failed = checks.filter(([, pass]) => !pass).length;
console.log(`\n${checks.length - failed}/${checks.length} seed checks passed`);
await disconnectDB();
process.exitCode = failed ? 1 : 0;
