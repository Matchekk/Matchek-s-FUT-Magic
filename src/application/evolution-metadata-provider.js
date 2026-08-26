import { stableFingerprint } from "./immutable.js";
import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "./pro-contracts/errors.js";
import {
  assertExactKeys,
  assertPlainJson,
  cloneAndFreezeContract,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./pro-contracts/schema.js";

export const EVOLUTION_METADATA_SCHEMA_VERSION = 1;
export const EVOLUTION_METADATA_REQUEST_CONTRACT = "evolution_metadata_request.v1";
export const EVOLUTION_METADATA_EVIDENCE_CONTRACT = "evolution_metadata_evidence.v1";
export const EVOLUTION_CATALOG_CONTRACT = "evolution_catalog.v1";

export const EVOLUTION_METADATA_LIMITS = Object.freeze({
  maxBytes: 16 * 1024,
  maxDepth: 5,
  maxObjectKeys: 16,
  maxRequestTtlMs: 2 * 60_000,
  maxEvidenceTtlMs: 24 * 60 * 60_000,
  maxDefinitions: 2_000,
  maxStringBytes: 128,
});

export const EvolutionMetadataProviderState = Object.freeze({
  READY: "ready",
  UNVERIFIED: "unverified",
  NOT_CONFIGURED: "not_configured",
});

export const EvolutionMetadataEvidenceState = Object.freeze({
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
});

export const EvolutionMetadataGameVersion = Object.freeze({
  FC26: "fc26",
  FC27: "fc27",
});

const fail = (code, message, path) => {
  throw new ProContractError(code, message, { path });
};

const invalid = (message, path) =>
  fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, message, path);

const assertMetadataJson = (value, path) => assertPlainJson(value, {
  path,
  maxBytes: EVOLUTION_METADATA_LIMITS.maxBytes,
  maxDepth: EVOLUTION_METADATA_LIMITS.maxDepth,
  maxArrayLength: Object.keys(EvolutionMetadataGameVersion).length,
  maxObjectKeys: EVOLUTION_METADATA_LIMITS.maxObjectKeys,
  maxStringBytes: EVOLUTION_METADATA_LIMITS.maxStringBytes,
});

const normalizeFingerprint = (value, path) =>
  normalizeSafeId(value, { path, maxLength: EVOLUTION_METADATA_LIMITS.maxStringBytes });

const fingerprint = (value) => stableFingerprint(value).replace(":", "_");

const canonicalRequest = (value) => ({
  schemaVersion: value.schemaVersion,
  contract: value.contract,
  requestId: value.requestId,
  gameVersion: value.gameVersion,
  createdAt: value.createdAt,
  expiresAt: value.expiresAt,
});

const normalizeRequest = (value, { requireFingerprint, now = null }) => {
  assertMetadataJson(value, "$evolutionMetadataRequest");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "gameVersion", "createdAt", "expiresAt",
      ...(requireFingerprint ? ["fingerprint"] : []),
    ],
    optional: requireFingerprint ? [] : ["fingerprint"],
    path: "$evolutionMetadataRequest",
  });
  if (value.schemaVersion !== EVOLUTION_METADATA_SCHEMA_VERSION) {
    fail(
      PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
      "Unsupported Evolution metadata request schema",
      "$evolutionMetadataRequest.schemaVersion",
    );
  }
  if (value.contract !== EVOLUTION_METADATA_REQUEST_CONTRACT) {
    invalid("Unexpected Evolution metadata request contract", "$evolutionMetadataRequest.contract");
  }
  const createdAt = normalizeFiniteInteger(value.createdAt, {
    path: "$evolutionMetadataRequest.createdAt", min: 0,
  });
  const expiresAt = normalizeFiniteInteger(value.expiresAt, {
    path: "$evolutionMetadataRequest.expiresAt", min: 0,
  });
  if (expiresAt <= createdAt ||
      expiresAt - createdAt > EVOLUTION_METADATA_LIMITS.maxRequestTtlMs) {
    invalid(
      "Evolution metadata request has an invalid bounded lifetime",
      "$evolutionMetadataRequest.expiresAt",
    );
  }
  if (now != null && expiresAt <= normalizeFiniteInteger(now, { path: "$now", min: 0 })) {
    fail(
      PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED,
      "Evolution metadata request has expired",
      "$evolutionMetadataRequest.expiresAt",
    );
  }
  const output = {
    schemaVersion: EVOLUTION_METADATA_SCHEMA_VERSION,
    contract: EVOLUTION_METADATA_REQUEST_CONTRACT,
    requestId: normalizeSafeId(value.requestId, {
      path: "$evolutionMetadataRequest.requestId", maxLength: 80,
    }),
    gameVersion: normalizeEnum(
      value.gameVersion,
      Object.values(EvolutionMetadataGameVersion),
      { path: "$evolutionMetadataRequest.gameVersion" },
    ),
    createdAt,
    expiresAt,
  };
  if (requireFingerprint) {
    output.fingerprint = normalizeFingerprint(
      value.fingerprint,
      "$evolutionMetadataRequest.fingerprint",
    );
  }
  return output;
};

export const createEvolutionMetadataRequest = (value) => {
  const normalized = normalizeRequest(value, { requireFingerprint: false });
  return cloneAndFreezeContract({
    ...normalized,
    fingerprint: fingerprint(canonicalRequest(normalized)),
  });
};

export const validateEvolutionMetadataRequest = (value, { now = null } = {}) => {
  const normalized = normalizeRequest(value, { requireFingerprint: true, now });
  if (normalized.fingerprint !== fingerprint(canonicalRequest(normalized))) {
    invalid(
      "Evolution metadata request fingerprint mismatch",
      "$evolutionMetadataRequest.fingerprint",
    );
  }
  return cloneAndFreezeContract(normalized);
};

export const createEvolutionMetadataProviderDescriptor = (value) => {
  assertMetadataJson(value, "$evolutionMetadataProviderDescriptor");
  assertExactKeys(value, {
    required: [
      "providerId", "state", "supportedGameVersions", "catalogContract", "maxDefinitions",
    ],
    path: "$evolutionMetadataProviderDescriptor",
  });
  const state = normalizeEnum(
    value.state,
    Object.values(EvolutionMetadataProviderState),
    { path: "$evolutionMetadataProviderDescriptor.state" },
  );
  const supportedGameVersions = normalizeStringArray(value.supportedGameVersions, {
    path: "$evolutionMetadataProviderDescriptor.supportedGameVersions",
    allowed: Object.values(EvolutionMetadataGameVersion),
    maxItems: Object.keys(EvolutionMetadataGameVersion).length,
    maxItemLength: 8,
    sort: true,
  });
  const maxDefinitions = normalizeFiniteInteger(value.maxDefinitions, {
    path: "$evolutionMetadataProviderDescriptor.maxDefinitions",
    min: 0,
    max: EVOLUTION_METADATA_LIMITS.maxDefinitions,
  });
  if (value.catalogContract !== EVOLUTION_CATALOG_CONTRACT) {
    invalid(
      "Unexpected Evolution catalog contract",
      "$evolutionMetadataProviderDescriptor.catalogContract",
    );
  }
  if (state === EvolutionMetadataProviderState.NOT_CONFIGURED &&
      (supportedGameVersions.length !== 0 || maxDefinitions !== 0)) {
    invalid(
      "A not-configured Evolution metadata provider cannot claim support",
      "$evolutionMetadataProviderDescriptor",
    );
  }
  if (state !== EvolutionMetadataProviderState.NOT_CONFIGURED &&
      (supportedGameVersions.length === 0 || maxDefinitions < 1)) {
    invalid(
      "A configured Evolution metadata provider must declare bounded support",
      "$evolutionMetadataProviderDescriptor",
    );
  }
  return cloneAndFreezeContract({
    providerId: normalizeSafeId(value.providerId, {
      path: "$evolutionMetadataProviderDescriptor.providerId", maxLength: 80,
    }),
    state,
    supportedGameVersions,
    catalogContract: EVOLUTION_CATALOG_CONTRACT,
    maxDefinitions,
  });
};

const normalizeEvidence = (value) => {
  assertMetadataJson(value, "$evolutionMetadataEvidence");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "providerId", "state", "requestId",
      "requestFingerprint", "gameVersion", "catalogContract", "catalogVersion",
      "catalogFingerprint", "definitionCount", "observedAt", "expiresAt",
    ],
    path: "$evolutionMetadataEvidence",
  });
  if (value.schemaVersion !== EVOLUTION_METADATA_SCHEMA_VERSION) {
    fail(
      PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
      "Unsupported Evolution metadata evidence schema",
      "$evolutionMetadataEvidence.schemaVersion",
    );
  }
  if (value.contract !== EVOLUTION_METADATA_EVIDENCE_CONTRACT) {
    invalid("Unexpected Evolution metadata evidence contract", "$evolutionMetadataEvidence.contract");
  }
  if (value.catalogContract !== EVOLUTION_CATALOG_CONTRACT) {
    invalid("Unexpected Evolution catalog contract", "$evolutionMetadataEvidence.catalogContract");
  }
  const observedAt = normalizeFiniteInteger(value.observedAt, {
    path: "$evolutionMetadataEvidence.observedAt", min: 0,
  });
  const expiresAt = normalizeFiniteInteger(value.expiresAt, {
    path: "$evolutionMetadataEvidence.expiresAt", min: 0,
  });
  if (expiresAt <= observedAt ||
      expiresAt - observedAt > EVOLUTION_METADATA_LIMITS.maxEvidenceTtlMs) {
    invalid(
      "Evolution metadata evidence must expire after observation",
      "$evolutionMetadataEvidence.expiresAt",
    );
  }
  return {
    schemaVersion: EVOLUTION_METADATA_SCHEMA_VERSION,
    contract: EVOLUTION_METADATA_EVIDENCE_CONTRACT,
    providerId: normalizeSafeId(value.providerId, {
      path: "$evolutionMetadataEvidence.providerId", maxLength: 80,
    }),
    state: normalizeEnum(value.state, Object.values(EvolutionMetadataEvidenceState), {
      path: "$evolutionMetadataEvidence.state",
    }),
    requestId: normalizeSafeId(value.requestId, {
      path: "$evolutionMetadataEvidence.requestId", maxLength: 80,
    }),
    requestFingerprint: normalizeFingerprint(
      value.requestFingerprint,
      "$evolutionMetadataEvidence.requestFingerprint",
    ),
    gameVersion: normalizeEnum(value.gameVersion, Object.values(EvolutionMetadataGameVersion), {
      path: "$evolutionMetadataEvidence.gameVersion",
    }),
    catalogContract: EVOLUTION_CATALOG_CONTRACT,
    catalogVersion: normalizeSafeId(value.catalogVersion, {
      path: "$evolutionMetadataEvidence.catalogVersion", maxLength: 80,
    }),
    catalogFingerprint: normalizeFingerprint(
      value.catalogFingerprint,
      "$evolutionMetadataEvidence.catalogFingerprint",
    ),
    definitionCount: normalizeFiniteInteger(value.definitionCount, {
      path: "$evolutionMetadataEvidence.definitionCount",
      min: 0,
      max: EVOLUTION_METADATA_LIMITS.maxDefinitions,
    }),
    observedAt,
    expiresAt,
  };
};

export const createEvolutionMetadataEvidence = (value) =>
  cloneAndFreezeContract(normalizeEvidence(value));

export const validateEvolutionMetadataEvidence = (
  value,
  { request, descriptor, now = Date.now() } = {},
) => {
  const evidence = createEvolutionMetadataEvidence(value);
  const normalizedRequest = validateEvolutionMetadataRequest(request, { now });
  const normalizedDescriptor = createEvolutionMetadataProviderDescriptor(descriptor);
  if (normalizedDescriptor.state === EvolutionMetadataProviderState.NOT_CONFIGURED ||
      !normalizedDescriptor.supportedGameVersions.includes(normalizedRequest.gameVersion) ||
      evidence.definitionCount > normalizedDescriptor.maxDefinitions) {
    fail(
      PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED,
      "Evolution metadata evidence exceeds its provider descriptor",
      "$evolutionMetadataEvidence",
    );
  }
  if (evidence.state === EvolutionMetadataEvidenceState.VERIFIED &&
      normalizedDescriptor.state !== EvolutionMetadataProviderState.READY) {
    fail(
      PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED,
      "An unverified Evolution metadata provider cannot claim verified evidence",
      "$evolutionMetadataEvidence.state",
    );
  }
  if (evidence.providerId !== normalizedDescriptor.providerId ||
      evidence.requestId !== normalizedRequest.requestId ||
      evidence.requestFingerprint !== normalizedRequest.fingerprint ||
      evidence.gameVersion !== normalizedRequest.gameVersion ||
      evidence.catalogContract !== normalizedDescriptor.catalogContract) {
    fail(
      PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH,
      "Evolution metadata evidence does not match its request",
      "$evolutionMetadataEvidence",
    );
  }
  const currentTime = normalizeFiniteInteger(now, { path: "$now", min: 0 });
  if (evidence.expiresAt <= currentTime || evidence.observedAt > currentTime) {
    fail(
      PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED,
      "Evolution metadata evidence is stale or not yet observable",
      "$evolutionMetadataEvidence.expiresAt",
    );
  }
  return evidence;
};

export class EvolutionMetadataProvider {
  constructor(descriptor) {
    this.descriptor = createEvolutionMetadataProviderDescriptor(descriptor);
  }

  describe() {
    return this.descriptor;
  }

  async readCatalog(request, _options = {}) {
    validateEvolutionMetadataRequest(request);
    fail(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Evolution metadata provider is not configured",
      "$evolutionMetadataProvider",
    );
  }
}

export class NotConfiguredEvolutionMetadataProvider extends EvolutionMetadataProvider {
  constructor({ providerId = "evolution_metadata_not_configured" } = {}) {
    super(createEvolutionMetadataProviderDescriptor({
      providerId,
      state: EvolutionMetadataProviderState.NOT_CONFIGURED,
      supportedGameVersions: [],
      catalogContract: EVOLUTION_CATALOG_CONTRACT,
      maxDefinitions: 0,
    }));
    Object.freeze(this);
  }
}
