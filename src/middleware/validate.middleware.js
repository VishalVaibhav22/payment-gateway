function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const error = new Error("Validation failed");
      error.statusCode = 400;
      error.details = result.error.issues;

      return next(error);
    }

    req.body = result.data;

    next();
  };
}

module.exports = validate;