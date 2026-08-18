function errorMiddleware(err, req, res, next) {
  console.error(err);

  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    message: err.message || "Internal server error",
    ...(err.details && { details: err.details }),
  });
}

module.exports = errorMiddleware;