import { Router } from 'express';
import * as books from '../controllers/book.controller.js';
import { validate } from '../middleware/validate.js';
import { bookParams } from '../validators/book.validator.js';

// Authors get their own books; admins get all. Scoping lives in the service.
const router = Router();

router.get('/', books.listBooks);
router.get('/:bookId', validate({ params: bookParams }), books.getBook);

export default router;
