export const PRO_CONTRACT_ERROR_CODES = Object.freeze({
  CONTRACT_INVALID: "CONTRACT_INVALID",
  CONTRACT_VERSION_UNSUPPORTED: "CONTRACT_VERSION_UNSUPPORTED",
  CONTRACT_TOO_LARGE: "CONTRACT_TOO_LARGE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_OFFLINE: "PROVIDER_OFFLINE",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
  RESPONSE_MISMATCH: "RESPONSE_MISMATCH",
  RESPONSE_EXPIRED: "RESPONSE_EXPIRED",
  HANDLE_UNKNOWN: "HANDLE_UNKNOWN",
  LOCAL_REVALIDATION_FAILED: "LOCAL_REVALIDATION_FAILED",
});

const cloneDetails = (details) => {
  if (details == null) return null;
  try {
    return structuredClone(details);
  } catch {
    return null;
  }
};

export class ProContractError extends Error {
  constructor(code, message, { path = "$", details = null, cause } = {}) {
    if (!Object.values(PRO_CONTRACT_ERROR_CODES).includes(code)) {
      throw new TypeError(`Unknown Pro contract error code: ${String(code)}`);
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new TypeError("ProContractError requires a non-empty message");
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProContractError";
    this.code = code;
    this.path = typeof path === "string" && path ? path : "$";
    this.details = cloneDetails(details);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      details: cloneDetails(this.details),
    };
  }
}

export const isProContractError = (error, code = null) =>
  error instanceof ProContractError && (code == null || error.code === code);
