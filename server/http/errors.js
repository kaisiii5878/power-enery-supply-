/**
 * Operational error carrying an HTTP status; converted to a JSON envelope by
 * the centralized error handler. Keeps route code free of ad-hoc res.status().
 */
class HttpError extends Error {
  constructor(status, message, extras = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    Object.assign(this, extras);
  }
}

const badRequest = (message, extras) => new HttpError(400, message, extras);
const unauthorized = (message = "Sign in required.") => new HttpError(401, message);
const forbidden = (message = "Your account cannot perform this action.") => new HttpError(403, message);
const notFound = (message = "Not found.") => new HttpError(404, message);
const conflict = (message, extras) => new HttpError(409, message, extras);

/** Wraps domain assertions (which carry .status) into HttpError instances. */
function toHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error && Number.isInteger(error.status) && error.status >= 400) {
    const { status, message, ...rest } = error;
    return new HttpError(status, message, rest);
  }
  return error;
}

/** Express 5 forwards rejected promises, but asyncHandler keeps intent explicit. */
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, toHttpError, asyncHandler };
