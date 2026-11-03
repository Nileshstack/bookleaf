import { Book } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { refFilter, scopeToOwner } from './access.js';
import { isPublished, productionProgress, royaltyBreakdown } from './bookInsights.js';

const presentBook = (book, now) => ({
  ...book.toJSON(),
  isPublished: isPublished(book),
  royaltyBreakdown: royaltyBreakdown(book, now),
  production: productionProgress(book),
});

export const listBooks = async (user) => {
  const books = await Book.find(scopeToOwner(user)).sort({ publicationDate: -1, bookId: 1 });
  const now = new Date();
  return books.map((b) => presentBook(b, now));
};

export const getBook = async (ref, user) => {
  const book = await Book.findOne(scopeToOwner(user, refFilter(ref, 'bookId')));
  if (!book) throw AppError.notFound('Book');
  return presentBook(book, new Date());
};

/**
 * Resolves a book reference from a request body for the given author.
 * Returns null for "General / Account Level". A book that doesn't exist
 * and a book owned by someone else both fail as a field error.
 */
export const resolveOwnedBookId = async (ref, user) => {
  if (!ref) return null;
  const book = await Book.findOne(scopeToOwner(user, refFilter(ref, 'bookId'))).select('_id').lean();
  if (!book) {
    throw AppError.validation([{ field: 'bookId', message: 'Choose one of your own books, or General / Account Level' }]);
  }
  return book._id;
};
