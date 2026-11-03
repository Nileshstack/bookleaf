import { Router } from 'express';
import * as books from '../controllers/book.controller.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/index.js';
import { bookParams } from '../validators/book.validator.js';

// Author portal: "My Books". Scoped to req.user in the service.
const router = Router();

router.use(authorize(ROLES.AUTHOR));

router.get('/', books.listBooks);
router.get('/:bookId', validate({ params: bookParams }), books.getBook);

export default router;
