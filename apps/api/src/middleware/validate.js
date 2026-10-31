/** Replaces `req.body` with the schema's parsed output. A ZodError is turned into a 400 by errorHandler. */
export const validateBody = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};
