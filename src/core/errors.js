/**
 * Stable error codes used across GrindPilot domain boundaries.
 *
 * Callers should branch on `code`, never on a human-readable message.
 */
export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_STATE: "INVALID_STATE",
  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",
  OPERATION_ABORTED: "OPERATION_ABORTED",
  STORAGE_KEY_NOT_ALLOWED: "STORAGE_KEY_NOT_ALLOWED",
  STORAGE_SIZE_EXCEEDED: "STORAGE_SIZE_EXCEEDED",
  STORAGE_REVISION_CONFLICT: "STORAGE_REVISION_CONFLICT",
  STORAGE_CORRUPT: "STORAGE_CORRUPT",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
});

const cloneDetails = (details) => {
  if (details == null) return null;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(details);
    } catch {
      // Error details must never prevent construction of the actual error.
    }
  }
  return details;
};

/**
 * Domain error with a machine-readable code and optional structured context.
 */
export class GrindPilotError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{details?: unknown, cause?: unknown, retryable?: boolean}} [options]
   */
  constructor(code, message, { details = null, cause, retryable = false } = {}) {
    if (typeof code !== "string" || !code.trim()) {
      throw new TypeError("GrindPilotError requires a non-empty code");
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new TypeError("GrindPilotError requires a non-empty message");
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrindPilotError";
    this.code = code;
    this.details = cloneDetails(details);
    this.retryable = Boolean(retryable);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: cloneDetails(this.details),
      retryable: this.retryable,
    };
  }
}

/**
 * Converts unknown thrown values at a boundary without losing a known domain
 * error's code or metadata.
 *
 * @param {unknown} error
 * @param {{code?: string, message?: string, details?: unknown, retryable?: boolean}} [fallback]
 * @returns {GrindPilotError}
 */
export const toGrindPilotError = (
  error,
  {
    code = ERROR_CODES.UNKNOWN,
    message = "An unexpected GrindPilot error occurred",
    details = null,
    retryable = false,
  } = {},
) => {
  if (error instanceof GrindPilotError) return error;
  const resolvedMessage =
    error instanceof Error && error.message.trim() ? error.message : message;
  return new GrindPilotError(code, resolvedMessage, {
    details,
    cause: error,
    retryable,
  });
};

export const isGrindPilotError = (error, code = null) =>
  error instanceof GrindPilotError && (code == null || error.code === code);
