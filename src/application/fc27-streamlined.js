import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "./pro-contracts/errors.js";
import {
  assertExactKeys,
  assertPlainJson,
  cloneAndFreezeContract,
  normalizeBoolean,
  normalizeBoundedString,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
} from "./pro-contracts/schema.js";
import { stableFingerprint, stableStringify } from "./immutable.js";

export const FC27_STREAMLINED_CONTRACT = "fc27_streamlined_challenge_observation.v1";
export const FC27_STREAMLINED_SCHEMA_VERSION = 1;

export const FC27_STREAMLINED_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxDepth: 8,
  maxObjectKeys: 24,
  maxSourcesPerField: 16,
  maxUnmappedEvidence: 32,
  maxStringBytes: 128,
  maxScore: 1_000_000_000,
});

export const Fc27EvidenceState = Object.freeze({
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
  UNKNOWN: "UNKNOWN",
});

export const Fc27EvidenceSourceKind = Object.freeze({
  REVIEWED_FIXTURE: "REVIEWED_FIXTURE",
  UNREVIEWED_FIXTURE: "UNREVIEWED_FIXTURE",
  LIVE_OBSERVATION: "LIVE_OBSERVATION",
});

export const Fc27EvidenceReason = Object.freeze({
  REVIEWED_FIXTURE_MATCH: "REVIEWED_FIXTURE_MATCH",
  UNREVIEWED_OBSERVATION: "UNREVIEWED_OBSERVATION",
  SHAPE_UNCLASSIFIED: "SHAPE_UNCLASSIFIED",
  FIXTURE_INSUFFICIENT: "FIXTURE_INSUFFICIENT",
  CONFLICTING_OBSERVATIONS: "CONFLICTING_OBSERVATIONS",
  ADAPTER_UNVERIFIED: "ADAPTER_UNVERIFIED",
  NOT_OBSERVED: "NOT_OBSERVED",
  FIELD_ABSENT: "FIELD_ABSENT",
});

export const Fc27ChallengeClassification = Object.freeze({
  STREAMLINED_SCORE: "STREAMLINED_SCORE",
});

export const Fc27UnmappedEvidenceType = Object.freeze({
  SCALAR: "SCALAR",
  ARRAY: "ARRAY",
  OBJECT: "OBJECT",
});

export const Fc27ObservedValueKind = Object.freeze({
  CLASSIFICATION: "CLASSIFICATION",
  SAFE_ID: "SAFE_ID",
  SCORE: "SCORE",
  BOOLEAN: "BOOLEAN",
  RULE_SET_REF: "RULE_SET_REF",
  SCORE_MODEL_VERSION: "SCORE_MODEL_VERSION",
  RATING: "RATING",
  STRING_LIST: "STRING_LIST",
});

const VERIFIED_REASONS = Object.freeze([Fc27EvidenceReason.REVIEWED_FIXTURE_MATCH]);
const UNVERIFIED_REASONS = Object.freeze([
  Fc27EvidenceReason.UNREVIEWED_OBSERVATION,
  Fc27EvidenceReason.SHAPE_UNCLASSIFIED,
  Fc27EvidenceReason.FIXTURE_INSUFFICIENT,
  Fc27EvidenceReason.CONFLICTING_OBSERVATIONS,
  Fc27EvidenceReason.ADAPTER_UNVERIFIED,
]);
const UNKNOWN_REASONS = Object.freeze([
  Fc27EvidenceReason.NOT_OBSERVED,
  Fc27EvidenceReason.FIELD_ABSENT,
]);

const fail = (message, path, code = PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID) => {
  throw new ProContractError(code, message, { path });
};

const contractFingerprint = (value) => stableFingerprint(value).replace(":", "_");

const assertRootJson = (value, path) => assertPlainJson(value, {
  path,
  maxBytes: FC27_STREAMLINED_LIMITS.maxBytes,
  maxDepth: FC27_STREAMLINED_LIMITS.maxDepth,
  maxArrayLength: FC27_STREAMLINED_LIMITS.maxUnmappedEvidence,
  maxObjectKeys: FC27_STREAMLINED_LIMITS.maxObjectKeys,
  maxStringBytes: FC27_STREAMLINED_LIMITS.maxStringBytes,
});

const nullableString = (value, path, maxLength = 64) => value == null
  ? null
  : normalizeBoundedString(value, { path, maxLength, allowEmpty: false });

const normalizeFingerprint = (value, path) => {
  const normalized = normalizeBoundedString(value, { path, maxLength: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    fail("Expected a bounded fingerprint", path);
  }
  return normalized;
};

const normalizeSource = (value, path) => {
  assertExactKeys(value, {
    required: [
      "kind", "sourceId", "sourceFingerprint", "adapterVersion", "eaBuild", "locale",
    ],
    path,
  });
  return {
    kind: normalizeEnum(value.kind, Object.values(Fc27EvidenceSourceKind), { path: `${path}.kind` }),
    sourceId: normalizeSafeId(value.sourceId, { path: `${path}.sourceId`, maxLength: 80 }),
    sourceFingerprint: normalizeFingerprint(value.sourceFingerprint, `${path}.sourceFingerprint`),
    adapterVersion: nullableString(value.adapterVersion, `${path}.adapterVersion`),
    eaBuild: nullableString(value.eaBuild, `${path}.eaBuild`),
    locale: nullableString(value.locale, `${path}.locale`, 32),
  };
};

export const validateFc27RuleSetRef = (value, path = "$ruleSetRef") => {
  assertExactKeys(value, {
    required: ["ruleSetId", "version", "fingerprint"],
    path,
  });
  return {
    ruleSetId: normalizeSafeId(value.ruleSetId, { path: `${path}.ruleSetId`, maxLength: 80 }),
    version: normalizeSafeId(value.version, { path: `${path}.version`, maxLength: 80 }),
    fingerprint: normalizeFingerprint(value.fingerprint, `${path}.fingerprint`),
  };
};

const normalizeStringList = (value, path) => {
  if (!Array.isArray(value) || value.length > 32) fail("Expected at most 32 strings", path);
  const output = value.map((entry, index) =>
    normalizeSafeId(entry, { path: `${path}[${index}]`, maxLength: 80 }));
  if (new Set(output).size !== output.length) fail("String-list values must be unique", path);
  return output.sort();
};

const normalizeObservedValue = (value, kind, path) => {
  switch (kind) {
    case Fc27ObservedValueKind.CLASSIFICATION:
      return normalizeEnum(value, Object.values(Fc27ChallengeClassification), { path });
    case Fc27ObservedValueKind.SAFE_ID:
      return normalizeSafeId(value, { path, maxLength: 80 });
    case Fc27ObservedValueKind.SCORE:
      return normalizeFiniteInteger(value, { path, min: 0, max: FC27_STREAMLINED_LIMITS.maxScore });
    case Fc27ObservedValueKind.BOOLEAN:
      return normalizeBoolean(value, { path });
    case Fc27ObservedValueKind.RULE_SET_REF:
      return validateFc27RuleSetRef(value, path);
    case Fc27ObservedValueKind.SCORE_MODEL_VERSION:
      return normalizeSafeId(value, { path, maxLength: 80 });
    case Fc27ObservedValueKind.RATING:
      return normalizeFiniteInteger(value, { path, min: 0, max: 99 });
    case Fc27ObservedValueKind.STRING_LIST:
      return normalizeStringList(value, path);
    default:
      throw new TypeError(`Unknown FC27 observed value kind: ${String(kind)}`);
  }
};

export const validateFc27ObservedField = (
  value,
  { valueKind, path = "$observedField" } = {},
) => {
  assertExactKeys(value, { required: ["state", "value", "reasonCode", "sources"], path });
  const state = normalizeEnum(value.state, Object.values(Fc27EvidenceState), {
    path: `${path}.state`,
  });
  if (!Array.isArray(value.sources) ||
      value.sources.length > FC27_STREAMLINED_LIMITS.maxSourcesPerField) {
    fail("Evidence sources exceed their bound", `${path}.sources`);
  }
  const sources = value.sources.map((source, index) =>
    normalizeSource(source, `${path}.sources[${index}]`));
  sources.sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) ||
    left.sourceFingerprint.localeCompare(right.sourceFingerprint));
  const sourceKeys = sources.map((source) => `${source.kind}:${source.sourceId}:${source.sourceFingerprint}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) fail("Evidence sources must be unique", `${path}.sources`);

  let reasonCode;
  let normalizedValue = null;
  if (state === Fc27EvidenceState.VERIFIED) {
    reasonCode = normalizeEnum(value.reasonCode, VERIFIED_REASONS, { path: `${path}.reasonCode` });
    if (value.value == null) fail("Verified evidence requires a value", `${path}.value`);
    if (sources.length === 0 ||
        sources.some((source) => source.kind !== Fc27EvidenceSourceKind.REVIEWED_FIXTURE)) {
      fail("Verified evidence requires only reviewed fixture sources", `${path}.sources`);
    }
    normalizedValue = normalizeObservedValue(value.value, valueKind, `${path}.value`);
  } else if (state === Fc27EvidenceState.UNVERIFIED) {
    reasonCode = normalizeEnum(value.reasonCode, UNVERIFIED_REASONS, { path: `${path}.reasonCode` });
    if (value.value !== null) fail("Unverified evidence must keep its semantic value null", `${path}.value`);
    if (sources.length === 0) fail("Unverified evidence requires an observation source", `${path}.sources`);
  } else {
    reasonCode = normalizeEnum(value.reasonCode, UNKNOWN_REASONS, { path: `${path}.reasonCode` });
    if (value.value !== null) fail("Unknown evidence must keep its semantic value null", `${path}.value`);
    if (sources.length !== 0) fail("Unknown evidence cannot claim an observation source", `${path}.sources`);
  }
  return { state, value: normalizedValue, reasonCode, sources };
};

const FIELD_KINDS = Object.freeze({
  classification: Fc27ObservedValueKind.CLASSIFICATION,
  setId: Fc27ObservedValueKind.SAFE_ID,
  challengeId: Fc27ObservedValueKind.SAFE_ID,
  targetScore: Fc27ObservedValueKind.SCORE,
  currentScore: Fc27ObservedValueKind.SCORE,
  eligibility: Fc27ObservedValueKind.RULE_SET_REF,
  rarityRules: Fc27ObservedValueKind.RULE_SET_REF,
  allowsDuplicates: Fc27ObservedValueKind.BOOLEAN,
  allowsPartialSubmission: Fc27ObservedValueKind.BOOLEAN,
  scoreModelVersion: Fc27ObservedValueKind.SCORE_MODEL_VERSION,
});

const ROOT_KEYS = Object.freeze([
  "schemaVersion", "contract", "observationId", "gameVersion",
  ...Object.keys(FIELD_KINDS),
  "unmappedEvidence", "adapterVersion", "eaBuild", "observedAt", "fingerprint",
]);

const normalizeUnmappedEvidence = (value, path) => {
  if (!Array.isArray(value) || value.length > FC27_STREAMLINED_LIMITS.maxUnmappedEvidence) {
    fail("Unmapped evidence exceeds its bound", path);
  }
  const output = value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    assertExactKeys(entry, {
      required: ["pathFingerprint", "type", "valueFingerprint"],
      path: entryPath,
    });
    return {
      pathFingerprint: normalizeFingerprint(entry.pathFingerprint, `${entryPath}.pathFingerprint`),
      type: normalizeEnum(entry.type, Object.values(Fc27UnmappedEvidenceType), {
        path: `${entryPath}.type`,
      }),
      valueFingerprint: normalizeFingerprint(entry.valueFingerprint, `${entryPath}.valueFingerprint`),
    };
  });
  output.sort((left, right) =>
    left.pathFingerprint.localeCompare(right.pathFingerprint) ||
    left.valueFingerprint.localeCompare(right.valueFingerprint));
  if (new Set(output.map((entry) => entry.pathFingerprint)).size !== output.length) {
    fail("Unmapped evidence paths must be unique", path);
  }
  return output;
};

const normalizeObservation = (value, { requireFingerprint }) => {
  assertRootJson(value, "$fc27StreamlinedObservation");
  assertExactKeys(value, {
    required: requireFingerprint ? ROOT_KEYS : ROOT_KEYS.filter((key) => key !== "fingerprint"),
    optional: requireFingerprint ? [] : ["fingerprint"],
    path: "$fc27StreamlinedObservation",
  });
  if (value.schemaVersion !== FC27_STREAMLINED_SCHEMA_VERSION) {
    fail(
      "Unsupported FC27 streamlined observation schema",
      "$fc27StreamlinedObservation.schemaVersion",
      PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
    );
  }
  if (value.contract !== FC27_STREAMLINED_CONTRACT) {
    fail("Unexpected FC27 streamlined observation contract", "$fc27StreamlinedObservation.contract");
  }
  if (value.gameVersion !== "fc27") {
    fail("Streamlined observation contract is FC27-only", "$fc27StreamlinedObservation.gameVersion");
  }
  const output = {
    schemaVersion: FC27_STREAMLINED_SCHEMA_VERSION,
    contract: FC27_STREAMLINED_CONTRACT,
    observationId: normalizeSafeId(value.observationId, {
      path: "$fc27StreamlinedObservation.observationId", maxLength: 80,
    }),
    gameVersion: "fc27",
  };
  for (const [field, valueKind] of Object.entries(FIELD_KINDS)) {
    output[field] = validateFc27ObservedField(value[field], {
      valueKind,
      path: `$fc27StreamlinedObservation.${field}`,
    });
  }
  output.unmappedEvidence = normalizeUnmappedEvidence(
    value.unmappedEvidence,
    "$fc27StreamlinedObservation.unmappedEvidence",
  );
  output.adapterVersion = nullableString(
    value.adapterVersion,
    "$fc27StreamlinedObservation.adapterVersion",
  );
  output.eaBuild = nullableString(value.eaBuild, "$fc27StreamlinedObservation.eaBuild");
  output.observedAt = normalizeFiniteInteger(value.observedAt, {
    path: "$fc27StreamlinedObservation.observedAt", min: 0,
  });
  if (requireFingerprint) {
    output.fingerprint = normalizeFingerprint(
      value.fingerprint,
      "$fc27StreamlinedObservation.fingerprint",
    );
  }
  return output;
};

const canonicalObservation = (value) => ({
  schemaVersion: value.schemaVersion,
  contract: value.contract,
  observationId: value.observationId,
  gameVersion: value.gameVersion,
  ...Object.fromEntries(Object.keys(FIELD_KINDS).map((field) => [field, value[field]])),
  unmappedEvidence: value.unmappedEvidence,
  adapterVersion: value.adapterVersion,
  eaBuild: value.eaBuild,
});

export const fingerprintStreamlinedChallengeObservation = (value) => {
  const normalized = normalizeObservation(value, { requireFingerprint: false });
  return contractFingerprint(canonicalObservation(normalized));
};

export const createStreamlinedChallengeObservation = (value) => {
  const normalized = normalizeObservation(value, { requireFingerprint: false });
  const fingerprint = contractFingerprint(canonicalObservation(normalized));
  return cloneAndFreezeContract({ ...normalized, fingerprint }, {
    path: "$fc27StreamlinedObservation",
    maxBytes: FC27_STREAMLINED_LIMITS.maxBytes,
    maxDepth: FC27_STREAMLINED_LIMITS.maxDepth,
    maxArrayLength: FC27_STREAMLINED_LIMITS.maxUnmappedEvidence,
    maxObjectKeys: FC27_STREAMLINED_LIMITS.maxObjectKeys,
    maxStringBytes: FC27_STREAMLINED_LIMITS.maxStringBytes,
  });
};

export const validateStreamlinedChallengeObservation = (value) => {
  const normalized = normalizeObservation(value, { requireFingerprint: true });
  const expected = contractFingerprint(canonicalObservation(normalized));
  if (normalized.fingerprint !== expected) {
    fail("FC27 observation fingerprint does not match its evidence", "$fc27StreamlinedObservation.fingerprint");
  }
  return cloneAndFreezeContract(normalized, {
    path: "$fc27StreamlinedObservation",
    maxBytes: FC27_STREAMLINED_LIMITS.maxBytes,
    maxDepth: FC27_STREAMLINED_LIMITS.maxDepth,
    maxArrayLength: FC27_STREAMLINED_LIMITS.maxUnmappedEvidence,
    maxObjectKeys: FC27_STREAMLINED_LIMITS.maxObjectKeys,
    maxStringBytes: FC27_STREAMLINED_LIMITS.maxStringBytes,
  });
};

export const deriveStreamlinedObservationState = (value) => {
  const normalized = validateStreamlinedChallengeObservation(value);
  const states = Object.keys(FIELD_KINDS).map((field) => normalized[field].state);
  if (states.every((state) => state === Fc27EvidenceState.VERIFIED) &&
      normalized.unmappedEvidence.length === 0) {
    return Fc27EvidenceState.VERIFIED;
  }
  if (states.every((state) => state === Fc27EvidenceState.UNKNOWN) &&
      normalized.unmappedEvidence.length === 0) {
    return Fc27EvidenceState.UNKNOWN;
  }
  return Fc27EvidenceState.UNVERIFIED;
};

// Exported for deterministic tests and sibling contracts; not an FC26 rule model.
export const canonicalizeFc27Evidence = (value) => JSON.parse(stableStringify(value));
