import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";

export const PRO_CONTRACT_SCHEMA_VERSION = 1;

export const PRO_CONTRACT_LIMITS = Object.freeze({
  MAX_BYTES: 512 * 1024,
  MAX_DEPTH: 16,
  MAX_ARRAY_LENGTH: 5_000,
  MAX_OBJECT_KEYS: 128,
  MAX_STRING_BYTES: 240,
  // Compatibility alias for callers written before limits were clarified as
  // UTF-8 byte limits. Both names intentionally have the same value.
  MAX_STRING_LENGTH: 240,
  MAX_ID_LENGTH: 128,
  MAX_FEATURES: 64,
});

const FORBIDDEN_KEY_TOKENS = [
  "authorization", "cookie", "cookies", "credential", "credentials",
  "password", "secret", "secrets", "token", "tokens", "accesstoken",
  "refreshtoken", "idtoken", "session", "sessionid", "sessiontoken",
  "headers", "endpoint", "url", "uri", "href", "html", "script",
  "selector", "expression", "workflow", "steps", "command", "module",
  "wasm", "function", "itemid", "resourceid", "definitionid", "assetid",
  "baseplayerid", "playerid",
];

export const PRO_CONTRACT_FORBIDDEN_KEYS = Object.freeze(
  [...new Set(FORBIDDEN_KEY_TOKENS)].sort(),
);

const forbiddenKeys = new Set(PRO_CONTRACT_FORBIDDEN_KEYS);
const encoder = new TextEncoder();
const URL_SHAPED = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

const fail = (message, path, code = PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, details = null) => {
  throw new ProContractError(code, message, { path, details });
};

const normalizedKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "");

export const isPlainObject = (value) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const utf8ByteLength = (value) => encoder.encode(String(value)).byteLength;

const safeOwnDataEntries = (value, path, { array = false } = {}) => {
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = [];
  for (const key of keys) {
    if (typeof key === "symbol") fail("Symbol keys are not allowed in Pro contracts", path);
    if (array && key === "length") continue;
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable) fail("Non-enumerable fields are not allowed in Pro contracts", `${path}.${key}`);
    if (!Object.hasOwn(descriptor, "value")) fail("Accessor fields are not allowed in Pro contracts", `${path}.${key}`);
    if (array && !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      fail("Arrays cannot contain named fields", `${path}.${key}`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
};

const validateJsonNode = (value, {
  path,
  depth,
  maxDepth,
  maxArrayLength,
  maxObjectKeys,
  maxStringBytes,
  seen,
}) => {
  if (value == null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Contract numbers must be finite", path);
    return;
  }
  if (typeof value === "string") {
    if (CONTROL_CHARACTERS.test(value)) fail("Control characters are forbidden in Pro contracts", path);
    if (utf8ByteLength(value) > maxStringBytes) fail("Contract string exceeds its UTF-8 byte limit", path);
    if (URL_SHAPED.test(value.trim())) fail("URL-shaped strings are forbidden in Pro contracts", path);
    return;
  }
  if (typeof value !== "object") fail("Contract value is not plain JSON", path);
  if (depth >= maxDepth) fail("Contract exceeds its maximum depth", path);
  if (seen.has(value)) fail("Contract contains a circular reference", path);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > maxArrayLength) fail("Contract array exceeds its limit", path);
    const entries = safeOwnDataEntries(value, path, { array: true });
    if (entries.length !== value.length) fail("Sparse arrays are not allowed", path);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("Sparse arrays are not allowed", `${path}[${index}]`);
      validateJsonNode(descriptor.value, {
        path: `${path}[${index}]`, depth: depth + 1, maxDepth,
        maxArrayLength, maxObjectKeys, maxStringBytes, seen,
      });
    }
  } else {
    if (!isPlainObject(value)) fail("Contract objects must have a plain prototype", path);
    const entries = safeOwnDataEntries(value, path);
    if (entries.length > maxObjectKeys) fail("Contract object has too many fields", path);
    for (const [key, child] of entries) {
      if (forbiddenKeys.has(normalizedKey(key))) {
        fail("Forbidden field in Pro contract", `${path}.${key}`);
      }
      validateJsonNode(child, {
        path: `${path}.${key}`, depth: depth + 1, maxDepth,
        maxArrayLength, maxObjectKeys, maxStringBytes, seen,
      });
    }
  }
  seen.delete(value);
};

export const assertPlainJson = (value, {
  path = "$",
  maxBytes = PRO_CONTRACT_LIMITS.MAX_BYTES,
  maxDepth = PRO_CONTRACT_LIMITS.MAX_DEPTH,
  maxArrayLength = PRO_CONTRACT_LIMITS.MAX_ARRAY_LENGTH,
  maxObjectKeys = PRO_CONTRACT_LIMITS.MAX_OBJECT_KEYS,
  maxStringBytes = PRO_CONTRACT_LIMITS.MAX_STRING_BYTES,
  maxStringLength = null,
} = {}) => {
  const resolvedMaxStringBytes = maxStringLength == null ? maxStringBytes : maxStringLength;
  for (const [name, limit] of Object.entries({ maxBytes, maxDepth, maxArrayLength, maxObjectKeys, maxStringBytes: resolvedMaxStringBytes })) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError(`${name} must be a positive integer`);
  }
  validateJsonNode(value, {
    path, depth: 0, maxDepth, maxArrayLength, maxObjectKeys,
    maxStringBytes: resolvedMaxStringBytes,
    seen: new Set(),
  });
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail("Contract is not JSON serializable", path);
  }
  if (encoded === undefined) fail("Contract is not JSON serializable", path);
  const bytes = encoder.encode(encoded).byteLength;
  if (bytes > maxBytes) {
    fail(
      "Contract exceeds its byte limit",
      path,
      PRO_CONTRACT_ERROR_CODES.CONTRACT_TOO_LARGE,
      { maxBytes, actualBytes: bytes },
    );
  }
  return value;
};

export const jsonByteLength = (value) => {
  assertPlainJson(value);
  return utf8ByteLength(JSON.stringify(value));
};

export const assertContractSize = (value, {
  path = "$",
  maxBytes = PRO_CONTRACT_LIMITS.MAX_BYTES,
} = {}) => {
  assertPlainJson(value, { path, maxBytes });
  return value;
};

export const assertExactKeys = (value, {
  required = [],
  optional = [],
  path = "$",
} = {}) => {
  if (!isPlainObject(value)) fail("Expected a plain object", path);
  const entries = safeOwnDataEntries(value, path);
  const requiredSet = new Set(required);
  const allowed = new Set([...requiredSet, ...optional]);
  for (const [key] of entries) {
    if (!allowed.has(key)) fail(`Unknown field: ${key}`, `${path}.${key}`);
  }
  for (const key of requiredSet) {
    if (!Object.hasOwn(value, key)) fail(`Missing required field: ${key}`, `${path}.${key}`);
  }
  return value;
};

export const assertSchemaVersion = (value, { path = "$.schemaVersion" } = {}) => {
  if (value !== PRO_CONTRACT_SCHEMA_VERSION) {
    fail(
      `Unsupported Pro contract schema version: ${String(value)}`,
      path,
      PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
      { supported: PRO_CONTRACT_SCHEMA_VERSION },
    );
  }
  return value;
};

export const normalizeBoundedString = (value, {
  path = "$",
  maxLength = PRO_CONTRACT_LIMITS.MAX_STRING_LENGTH,
  allowEmpty = false,
} = {}) => {
  if (typeof value !== "string") fail("Expected a string", path);
  if (CONTROL_CHARACTERS.test(value)) fail("Control characters are forbidden in Pro contracts", path);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) fail("Expected a non-empty string", path);
  if (utf8ByteLength(normalized) > maxLength) fail("String exceeds its UTF-8 byte limit", path);
  if (URL_SHAPED.test(normalized)) fail("URL-shaped strings are forbidden in Pro contracts", path);
  return normalized;
};

export const normalizeSafeId = (value, {
  path = "$",
  maxLength = PRO_CONTRACT_LIMITS.MAX_ID_LENGTH,
} = {}) => {
  const normalized = normalizeBoundedString(value, { path, maxLength });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) fail("Expected a safe identifier", path);
  return normalized;
};

export const normalizeFiniteInteger = (value, {
  path = "$",
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
} = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`Expected an integer from ${min} to ${max}`, path);
  }
  return value;
};

export const normalizeNullableFiniteInteger = (value, options = {}) =>
  value == null ? null : normalizeFiniteInteger(value, options);

export const normalizeTimestamp = (value, { path = "$", nullable = false } = {}) => {
  if (nullable && value == null) return null;
  return normalizeFiniteInteger(value, { path, min: 0 });
};

export const normalizeBoolean = (value, { path = "$" } = {}) => {
  if (typeof value !== "boolean") fail("Expected a boolean", path);
  return value;
};

export const normalizeEnum = (value, allowed, { path = "$" } = {}) => {
  const allowedValues = [...new Set(Array.from(allowed || []))];
  if (!allowedValues.includes(value)) fail(`Unsupported value: ${String(value)}`, path);
  return value;
};

export const normalizeStringArray = (value, {
  path = "$",
  allowed = null,
  maxItems = PRO_CONTRACT_LIMITS.MAX_ARRAY_LENGTH,
  maxItemLength = PRO_CONTRACT_LIMITS.MAX_STRING_LENGTH,
  sort = false,
  unique = true,
} = {}) => {
  if (!Array.isArray(value)) fail("Expected an array", path);
  if (value.length > maxItems) fail("Array exceeds its item limit", path);
  const allowedValues = allowed == null ? null : new Set(Array.from(allowed));
  const output = value.map((entry, index) => {
    const normalized = normalizeBoundedString(entry, {
      path: `${path}[${index}]`, maxLength: maxItemLength,
    });
    if (allowedValues && !allowedValues.has(normalized)) {
      fail(`Unsupported value: ${normalized}`, `${path}[${index}]`);
    }
    return normalized;
  });
  if (unique && new Set(output).size !== output.length) fail("Array values must be unique", path);
  if (sort) output.sort();
  return output;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const cloneAndFreezeContract = (value, options = {}) => {
  assertPlainJson(value, options);
  return deepFreeze(structuredClone(value));
};
