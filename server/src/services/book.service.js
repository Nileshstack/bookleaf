import { Book } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { refFilter, scopeToOwner } from './access.js';

export const listBooks = async (user) => {
  const books = await Book.find(scopeToOwner(user)).sort({ publicationDate: -1, bookId: 1 });
  return books.map((b) => b.toJSON());
};

export const getBook = async (ref, user) => {
  const book = await Book.findOne(scopeToOwner(user, refFilter(ref, 'bookId')));
  if (!book) throw AppError.notFound('Book');
  return book.toJSON();
};
