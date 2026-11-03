import * as bookService from '../services/book.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const listBooks = async (req, res) => {
  sendSuccess(res, await bookService.listBooks(req.user));
};

export const getBook = async (req, res) => {
  sendSuccess(res, await bookService.getBook(req.validated.params.bookId, req.user));
};
