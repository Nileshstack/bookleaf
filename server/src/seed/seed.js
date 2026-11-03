/**
 * Idempotent seed: `npm run seed` can run any number of times and always
 * ends in the same state. It never drops collections:
 *   - users are upserted by email, books by bookId
 *   - demo tickets are upserted by their fixed ticket numbers (BL-0001..)
 *     and their threads and cached drafts are rebuilt
 *   - demo passwords are reset every run so the documented credentials always work
 */
import { readFile } from 'node:fs/promises';
import { connectDB, disconnectDB } from '../config/db.js';
import { AiDraft, Book, Counter, Ticket, TicketMessage, User, ROLES } from '../models/index.js';
import { sampleTickets } from './sampleTickets.js';

const AUTHOR_PASSWORD = 'Author@123';
const ADMIN = { name: 'BookLeaf Support', email: 'admin@bookleaf.com', password: 'Admin@123' };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// "2023-06-20" → Date at UTC midnight; null stays null.
const toDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

const loadDataset = async () => {
  const raw = await readFile(new URL('./data.json', import.meta.url), 'utf8');
  return JSON.parse(raw).authors;
};

/** Flags rows where the dataset's own numbers don't add up. Warns, never fails. */
const checkRoyaltyMath = (authors) => {
  const issues = [];
  for (const { books } of authors) {
    for (const b of books) {
      if (b.author_royalty_per_copy != null && b.total_copies_sold * b.author_royalty_per_copy !== b.total_royalty_earned) {
        issues.push(`${b.book_id}: copies × royalty/copy ≠ total earned`);
      }
      if (b.total_royalty_earned - b.royalty_paid !== b.royalty_pending) {
        issues.push(`${b.book_id}: earned − paid ≠ pending`);
      }
    }
  }
  return issues;
};

const seedUsers = async (authors) => {
  const [authorHash, adminHash] = await Promise.all([
    User.hashPassword(AUTHOR_PASSWORD),
    User.hashPassword(ADMIN.password),
  ]);

  await User.bulkWrite(
    [
      ...authors.map((a) => ({
        updateOne: {
          filter: { email: a.email.toLowerCase() },
          update: {
            $set: {
              role: ROLES.AUTHOR,
              name: a.name,
              authorCode: a.author_id,
              phone: a.phone,
              city: a.city,
              joinedDate: toDate(a.joined_date),
              passwordHash: authorHash,
            },
          },
          upsert: true,
        },
      })),
      {
        updateOne: {
          filter: { email: ADMIN.email },
          update: { $set: { role: ROLES.ADMIN, name: ADMIN.name, passwordHash: adminHash } },
          upsert: true,
        },
      },
    ],
    { ordered: true },
  );

  const users = await User.find({ email: { $in: [...authors.map((a) => a.email.toLowerCase()), ADMIN.email] } });
  return {
    admin: users.find((u) => u.role === ROLES.ADMIN),
    authorsByCode: new Map(users.filter((u) => u.authorCode).map((u) => [u.authorCode, u])),
  };
};

const seedBooks = async (authors, authorsByCode) => {
  const ops = authors.flatMap((a) =>
    a.books.map((b) => ({
      updateOne: {
        filter: { bookId: b.book_id },
        update: {
          $set: {
            authorId: authorsByCode.get(a.author_id)._id,
            title: b.title,
            isbn: b.isbn,
            genre: b.genre,
            publicationDate: toDate(b.publication_date),
            status: b.status,
            mrp: b.mrp,
            royaltyPerCopy: b.author_royalty_per_copy,
            totalCopiesSold: b.total_copies_sold,
            totalRoyaltyEarned: b.total_royalty_earned,
            royaltyPaid: b.royalty_paid,
            royaltyPending: b.royalty_pending,
            lastRoyaltyPayoutDate: toDate(b.last_royalty_payout_date),
            printPartner: b.print_partner,
            availableOn: b.available_on,
          },
        },
        upsert: true,
      },
    })),
  );
  await Book.bulkWrite(ops, { ordered: true });

  const books = await Book.find({ bookId: { $in: ops.map((op) => op.updateOne.filter.bookId) } });
  return new Map(books.map((b) => [b.bookId, b]));
};

const seedTickets = async ({ admin, authorsByCode, booksByCode }) => {
  const now = Date.now();

  for (const [index, t] of sampleTickets.entries()) {
    const ticketNumber = Ticket.formatTicketNumber(index + 1);
    const author = authorsByCode.get(t.authorCode);
    const createdAt = new Date(now - t.daysAgo * DAY);
    const lastActivity = t.messages.at(-1)?.hoursAfter ?? 0;

    // timestamps:false so we control createdAt (the queue sorts by age).
    // The Ticket query hook still derives priorityRank from priority.
    const ticket = await Ticket.findOneAndUpdate(
      { ticketNumber },
      {
        $set: {
          authorId: author._id,
          bookId: t.bookCode ? booksByCode.get(t.bookCode)._id : null,
          subject: t.subject,
          description: t.description,
          attachments: t.attachments ?? [],
          status: t.status,
          category: t.category,
          aiCategory: null,
          categoryOverridden: false,
          priority: t.priority,
          aiPriority: null,
          priorityOverridden: false,
          aiReasoning: null,
          aiStatus: 'pending',
          aiError: null,
          assignedTo: t.assigned ? admin._id : null,
          createdAt,
          updatedAt: new Date(createdAt.getTime() + lastActivity * HOUR),
        },
      },
      { upsert: true, returnDocument: 'after', timestamps: false, runValidators: true },
    );

    // Rebuild the thread from scratch so re-runs never duplicate messages.
    await TicketMessage.deleteMany({ ticketId: ticket._id });
    await AiDraft.deleteMany({ ticketId: ticket._id });

    for (const m of t.messages) {
      const sender = m.from === ROLES.ADMIN ? admin : author;
      await TicketMessage.create({
        ticketId: ticket._id,
        senderRole: m.from,
        senderId: sender._id,
        body: m.body,
        isInternalNote: Boolean(m.internal),
        createdAt: new Date(createdAt.getTime() + m.hoursAfter * HOUR),
      });
    }
  }

  // New tickets created through the app must continue after the seeded ones.
  await Counter.ensureAtLeast('ticketNumber', sampleTickets.length);
};

const printSummary = async (authors) => {
  const [users, books, tickets, messages, notes] = await Promise.all([
    User.countDocuments(),
    Book.countDocuments(),
    Ticket.countDocuments(),
    TicketMessage.countDocuments(),
    TicketMessage.countDocuments({ isInternalNote: true }),
  ]);
  const inProduction = await Book.countDocuments({ status: { $ne: 'Published & Live' } });
  const neverPaid = await Book.countDocuments({ status: 'Published & Live', royaltyPaid: 0 });

  console.log('\nDatabase totals');
  console.table({
    users: { count: users },
    books: { count: books, note: `${inProduction} in production, ${neverPaid} published with ₹0 paid` },
    tickets: { count: tickets },
    ticketMessages: { count: messages, note: `${notes} internal notes` },
  });

  console.log('\nLogin credentials');
  console.table([
    { role: 'admin', name: ADMIN.name, email: ADMIN.email, password: ADMIN.password, books: '-' },
    ...authors.map((a) => ({
      role: 'author',
      name: a.name,
      email: a.email,
      password: AUTHOR_PASSWORD,
      books: a.books.map((b) => b.book_id).join(', '),
    })),
  ]);
};

const run = async () => {
  const authors = await loadDataset();

  const issues = checkRoyaltyMath(authors);
  if (issues.length) console.warn(`Dataset warnings:\n  ${issues.join('\n  ')}`);

  await connectDB();

  // Build declared indexes (and drop stale ones) before writing data.
  for (const model of [User, Book, Ticket, TicketMessage, AiDraft]) await model.syncIndexes();

  const { admin, authorsByCode } = await seedUsers(authors);
  console.log(`✔ users: ${authorsByCode.size} authors + 1 admin`);

  const booksByCode = await seedBooks(authors, authorsByCode);
  console.log(`✔ books: ${booksByCode.size}`);

  await seedTickets({ admin, authorsByCode, booksByCode });
  console.log(`✔ tickets: ${sampleTickets.length} demo tickets (BL-0001..${Ticket.formatTicketNumber(sampleTickets.length)})`);

  await printSummary(authors);
};

run()
  .then(() => disconnectDB())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await disconnectDB().catch(() => {});
    process.exitCode = 1;
  });
