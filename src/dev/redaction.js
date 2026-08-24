import { DEV_LIMITS, clampLimit } from "./limits.js";

const REDACTED = "[REDACTED]";
const OMITTED_ACCESSOR = "[Accessor omitted]";

const SECRET_KEY_PARTS = Object.freeze([
  "authorization",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "sessiontoken",
  "sessionid",
  "password",
  "passwd",
  "clientsecret",
  "apikey",
  "apiSecret",
  "cookie",
  "setcookie",
  "csrf",
  "xsrf",
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  if (
    [
      "auth",
      "credential",
      "credentials",
      "session",
      "sid",
      "token",
      "secret",
      "xutsid",
    ].includes(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("cookie") ||
    normalized.endsWith("sid")
  ) {
    return true;
  }
  return SECRET_KEY_PARTS.some((part) => normalized.includes(part.toLowerCase()));
}

export function truncateDiagnosticString(value, maxLength = DEV_LIMITS.maxStringLength) {
  const text = String(value);
  const limit = clampLimit(maxLength, DEV_LIMITS.maxStringLength);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function redactSecretText(value, maxLength = DEV_LIMITS.maxStringLength) {
  let text = String(value);
  text = text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, REDACTED);
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    REDACTED,
  );
  text = text.replace(
    /([?&](?:access_token|refresh_token|id_token|token|session|sid|x-ut-sid|code|password|secret)=)[^&#\s]*/gi,
    `$1${REDACTED}`,
  );
  text = text.replace(
    /\b(?:access_token|refresh_token|id_token|token|session|sid|x-ut-sid|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    (match) => `${match.slice(0, Math.max(match.indexOf(":"), match.indexOf("=")) + 1)}${REDACTED}`,
  );
  return truncateDiagnosticString(text, maxLength);
}

function normalizeOptions(options = {}) {
  return {
    maxDepth: clampLimit(options.maxDepth, DEV_LIMITS.maxDepth),
    maxItems: clampLimit(options.maxItems, DEV_LIMITS.maxCollectionItems),
    maxKeys: clampLimit(options.maxKeys, DEV_LIMITS.maxObjectKeys),
    maxStringLength: clampLimit(
      options.maxStringLength,
      DEV_LIMITS.maxStringLength,
    ),
  };
}

function sanitizeInternal(value, options, depth, seen) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return redactSecretText(value, options.maxStringLength);
  }
  if (typeof value === "bigint") return truncateDiagnosticString(value, options.maxStringLength);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (depth >= options.maxDepth) return "[Maximum depth reached]";
  if (seen.has(value)) return "[Circular]";

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: truncateDiagnosticString(value.name || "Error", 100),
      message: redactSecretText(value.message || "", options.maxStringLength),
    };
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = [];
      for (const entry of value.slice(0, options.maxItems)) {
        const sanitized = sanitizeInternal(entry, options, depth + 1, seen);
        if (sanitized !== undefined) result.push(sanitized);
      }
      return result;
    }

    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return "[Unreadable object]";
    }

    const result = {};
    const keys = Object.keys(descriptors).sort().slice(0, options.maxKeys);
    for (const key of keys) {
      const safeKey = truncateDiagnosticString(key, 200);
      if (isSensitiveKey(key)) {
        result[safeKey] = REDACTED;
        continue;
      }
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) {
        result[safeKey] = OMITTED_ACCESSOR;
        continue;
      }
      const sanitized = sanitizeInternal(
        descriptor.value,
        options,
        depth + 1,
        seen,
      );
      if (sanitized !== undefined) result[safeKey] = sanitized;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/**
 * Converts arbitrary diagnostic input into a bounded, JSON-safe value without
 * invoking getters. Secret-looking keys and common token formats are redacted.
 */
export function sanitizeDiagnosticValue(value, options = {}) {
  return sanitizeInternal(value, normalizeOptions(options), 0, new WeakSet());
}

export const REDACTED_VALUE = REDACTED;
