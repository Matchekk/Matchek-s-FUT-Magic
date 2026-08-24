import { WorkflowError } from "./errors.js";

export const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const cloneSerializable = (value) => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new WorkflowError("Workflow data must be JSON serializable", {
      code: "WORKFLOW_NOT_SERIALIZABLE",
      details: { message: error?.message ?? String(error) },
    });
  }
};

export const assertSerializable = (value, label = "Workflow data") => {
  const seen = new WeakSet();
  const visit = (entry, path) => {
    if (entry == null) return;
    const kind = typeof entry;
    if (kind === "string" || kind === "boolean") return;
    if (kind === "number") {
      if (!Number.isFinite(entry)) {
        throw new WorkflowError(`${label} contains a non-finite number`, {
          code: "WORKFLOW_NOT_SERIALIZABLE",
          details: { path },
        });
      }
      return;
    }
    if (kind !== "object") {
      throw new WorkflowError(`${label} contains an unsupported value`, {
        code: "WORKFLOW_NOT_SERIALIZABLE",
        details: { path, type: kind },
      });
    }
    if (seen.has(entry)) {
      throw new WorkflowError(`${label} contains a circular reference`, {
        code: "WORKFLOW_NOT_SERIALIZABLE",
        details: { path },
      });
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => visit(child, `${path}[${index}]`));
    } else {
      if (!isPlainObject(entry)) {
        throw new WorkflowError(`${label} contains a non-plain object`, {
          code: "WORKFLOW_NOT_SERIALIZABLE",
          details: { path },
        });
      }
      for (const [key, child] of Object.entries(entry)) {
        visit(child, `${path}.${key}`);
      }
    }
    seen.delete(entry);
  };
  visit(value, "$" );
  return value;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const next = {};
    for (const key of Object.keys(value).sort()) next[key] = stableValue(value[key]);
    return next;
  }
  return value;
};

export const stableStringify = (value) => JSON.stringify(stableValue(value));

export const fnv1aHash = (text) => {
  let hash = 0x811c9dc5;
  const source = String(text ?? "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

