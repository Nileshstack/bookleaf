import { AppError } from '../utils/AppError.js';

const SOURCES = {
  params: { statusCode: 400, message: 'Invalid URL parameters' },
  query: { statusCode: 400, message: 'Invalid query parameters' },
  body: { statusCode: 422, message: 'Validation failed' },
};

const toDetails = (zodError) =>
  zodError.issues.flatMap((issue) =>
    // Strict schemas report all unknown keys in one issue; split them so each field gets its own entry.
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ field: [...issue.path, key].join('.'), message: 'Unknown field' }))
      : [{ field: issue.path.join('.') || null, message: issue.message }],
  );

/**
 * validate({ params, query, body }) runs the given Zod schemas and puts the
 * parsed, coerced and stripped values on req.validated. Controllers read only
 * from req.validated, never from the raw request. (Express 5's req.query is
 * read-only, so overwriting it in place isn't an option anyway.)
 */
export const validate = (schemas) => (req, _res, next) => {
  req.validated = {};

  for (const [source, { statusCode, message }] of Object.entries(SOURCES)) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) throw AppError.validation(toDetails(result.error), { message, statusCode });
    req.validated[source] = result.data;
  }

  next();
};
