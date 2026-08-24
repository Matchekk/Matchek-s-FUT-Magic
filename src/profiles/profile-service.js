import { normalizePackPolicy } from "../packs/pack-policy.js";
import { normalizePlayerPickPolicy } from "../picks/pick-policy.js";
import { validateCondition } from "../workflow/conditions.js";

export const PROFILE_SCHEMA_VERSION = 1;

const REQUIRED_CONFIG_FIELDS = [
  "workflow",
  "solverSettings",
  "fodderPolicy",
  "duplicatePolicy",
  "packPolicy",
  "pickPolicy",
  "runLimits",
  "stopConditions",
];

const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class ProfileValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProfileValidationError";
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneData(value, path = "$", seen = new Set()) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} must be finite`);
    return value;
  }
  if (typeof value !== "object") {
    throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} contains a non-JSON value`);
  }
  if (seen.has(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} is circular`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => cloneData(entry, `${path}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} must be a plain object`);
    result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(key)) throw new ProfileValidationError("INVALID_PROFILE_DATA", `${path} contains a blocked key`);
      result[key] = cloneData(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return result;
}

function validIdentifier(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new ProfileValidationError("INVALID_PROFILE", `${field} must be a safe non-empty identifier`);
  }
  return value;
}

function validateWorkflow(workflow) {
  if (!isPlainObject(workflow) || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new ProfileValidationError("INVALID_PROFILE", "workflow.steps must be a non-empty array");
  }
  const ids = new Set();
  for (const [index, step] of workflow.steps.entries()) {
    if (!isPlainObject(step)) throw new ProfileValidationError("INVALID_PROFILE", `workflow step ${index} must be an object`);
    validIdentifier(step.id, `workflow.steps[${index}].id`);
    if (ids.has(step.id)) throw new ProfileValidationError("INVALID_PROFILE", `Duplicate workflow step ID: ${step.id}`);
    ids.add(step.id);
    if (typeof step.type !== "string" || !step.type.trim()) {
      throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].type is required`);
    }
    if (step.config != null && !isPlainObject(step.config)) {
      throw new ProfileValidationError("INVALID_PROFILE", `workflow.steps[${index}].config must be an object`);
    }
  }
}

function validateRunLimits(runLimits) {
  if (!isPlainObject(runLimits) || !Number.isSafeInteger(runLimits.maxIterations) || runLimits.maxIterations < 1 || runLimits.maxIterations > 10000) {
    throw new ProfileValidationError("INVALID_PROFILE", "runLimits.maxIterations must be an integer from 1 to 10000");
  }
  for (const field of ["maxSbcSubmissions", "maxPacksOpened", "maxDurationMinutes"]) {
    if (runLimits[field] != null && (!Number.isSafeInteger(runLimits[field]) || runLimits[field] < 1)) {
      throw new ProfileValidationError("INVALID_PROFILE", `runLimits.${field} must be a positive integer`);
    }
  }
}

function validateStopConditions(stopConditions) {
  if (!Array.isArray(stopConditions)) {
    throw new ProfileValidationError("INVALID_PROFILE", "stopConditions must be an array");
  }
  for (const [index, condition] of stopConditions.entries()) {
    if (!isPlainObject(condition) || typeof condition.type !== "string" || !condition.type.trim()) {
      throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] must have a typed condition`);
    }
    if (Object.hasOwn(condition, "expression") || Object.hasOwn(condition, "script")) {
      throw new ProfileValidationError("ARBITRARY_CODE_FORBIDDEN", "Profiles cannot contain executable expressions");
    }
    const type = condition.type.trim().toUpperCase();
    const aliases = new Set([
      "UNRESOLVED_UNASSIGNED", "STORAGE_FULL", "REQUIRED_SPECIAL_MISSING",
    ]);
    const typedConditions = new Set(["COMPARE", "ALL", "ANY", "NOT", "TRUTHY", "EXISTS"]);
    if (type === "CONDITION") {
      const result = validateCondition(condition.condition);
      if (!result.ok) throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] contains an invalid condition`);
    } else if (typedConditions.has(type)) {
      const result = validateCondition(condition);
      if (!result.ok) throw new ProfileValidationError("INVALID_PROFILE", `stopConditions[${index}] is invalid`);
    } else if (!aliases.has(type)) {
      throw new ProfileValidationError("INVALID_PROFILE", `Unsupported stop condition: ${type}`);
    }
  }
}

/** Validates and returns a detached, JSON-safe profile. */
export function normalizeProfile(input) {
  if (!isPlainObject(input)) throw new ProfileValidationError("INVALID_PROFILE", "Profile must be an object");
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (!Object.hasOwn(input, field)) throw new ProfileValidationError("INCOMPLETE_PROFILE", `Missing profile field: ${field}`);
  }

  const profile = cloneData(input);
  profile.schemaVersion = input.schemaVersion ?? PROFILE_SCHEMA_VERSION;
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new ProfileValidationError("UNSUPPORTED_PROFILE_VERSION", `Unsupported profile schema: ${profile.schemaVersion}`);
  }
  validIdentifier(profile.id, "id");
  if (typeof profile.name !== "string" || !profile.name.trim() || profile.name.trim().length > 120) {
    throw new ProfileValidationError("INVALID_PROFILE", "name must contain 1 to 120 characters");
  }
  profile.name = profile.name.trim();
  validateWorkflow(profile.workflow);
  for (const field of ["solverSettings", "fodderPolicy", "duplicatePolicy"]) {
    if (!isPlainObject(profile[field])) throw new ProfileValidationError("INVALID_PROFILE", `${field} must be an object`);
  }
  profile.packPolicy = { ...normalizePackPolicy(profile.packPolicy) };
  profile.pickPolicy = { ...normalizePlayerPickPolicy(profile.pickPolicy) };
  validateRunLimits(profile.runLimits);
  validateStopConditions(profile.stopConditions);
  return profile;
}

export class ProfileService {
  constructor({ repository, clock = () => new Date().toISOString() } = {}) {
    if (!repository?.list || !repository?.get || !repository?.put || !repository?.delete) {
      throw new TypeError("ProfileService requires an injected profile repository");
    }
    this.repository = repository;
    this.clock = clock;
  }

  async list() {
    const profiles = await this.repository.list();
    return profiles.map(normalizeProfile).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id) {
    validIdentifier(id, "id");
    const profile = await this.repository.get(id);
    return profile ? normalizeProfile(profile) : null;
  }

  async save(input, { overwrite = true } = {}) {
    const now = this.clock();
    const normalized = normalizeProfile({
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    });
    if (!overwrite && await this.repository.get(normalized.id)) {
      throw new ProfileValidationError("PROFILE_EXISTS", `Profile already exists: ${normalized.id}`);
    }
    return this.repository.put(normalized);
  }

  async delete(id) {
    validIdentifier(id, "id");
    return this.repository.delete(id);
  }

  async export(id) {
    const profile = await this.get(id);
    if (!profile) throw new ProfileValidationError("PROFILE_NOT_FOUND", `Profile not found: ${id}`);
    return JSON.stringify({
      format: "grindpilot-profile",
      schemaVersion: PROFILE_SCHEMA_VERSION,
      exportedAt: this.clock(),
      profile,
    }, null, 2);
  }

  async import(serialized, { overwrite = false } = {}) {
    if (typeof serialized !== "string" || serialized.length > 1_000_000) {
      throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import must be JSON under 1 MB");
    }
    let envelope;
    try {
      envelope = JSON.parse(serialized);
    } catch {
      throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import is not valid JSON");
    }
    if (!isPlainObject(envelope) || envelope.format !== "grindpilot-profile" || envelope.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new ProfileValidationError("INVALID_PROFILE_IMPORT", "Profile import envelope is invalid or unsupported");
    }
    return this.save(envelope.profile, { overwrite });
  }
}
