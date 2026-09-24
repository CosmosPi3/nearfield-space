const STATUS_BY_CODE = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  UPSTREAM_RATE_LIMIT: 429,
  UPSTREAM_ERROR: 502,
  VIDEO_UNAVAILABLE: 422,
  EXTRACTION_FAILED: 422,
  INTERNAL_ERROR: 500,
};

class AppError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = STATUS_BY_CODE[code] || 500;
    if (cause) this.cause = cause;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) console.error(err);
    return res.status(err.status).json(err.toJSON());
  }
  console.error(err);
  return res.status(500).json(new AppError('INTERNAL_ERROR', 'Unexpected server error').toJSON());
}

module.exports = { AppError, errorMiddleware };
