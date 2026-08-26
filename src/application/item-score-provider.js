import { PRO_CONTRACT_ERROR_CODES, ProContractError } from "./pro-contracts/errors.js";
import {
  assertExactKeys,
  assertPlainJson,
  cloneAndFreezeContract,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
} from "./pro-contracts/schema.js";
import { stableFingerprint } from "./immutable.js";
import {
  Fc27ObservedValueKind,
  validateFc27ObservedField,
} from "./fc27-streamlined.js";

export const ITEM_SCORE_CONTRACT = "item_score.v1";
export const ITEM_SCORE_SCHEMA_VERSION = 1;

export const ITEM_SCORE_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxDepth: 9,
  maxObjectKeys: 20,
  maxItems: 100,
  maxTtlMs: 2 * 60_000,
  maxScore: 1_000_000_000,
});

export const ItemScoreProviderState = Object.freeze({
  READY: "READY",
  UNVERIFIED: "UNVERIFIED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
});

export const ItemScoreResponseStatus = Object.freeze({
  SCORED: "SCORED",
});

export const ItemScoreFeatureCode = Object.freeze({
  RATING: "rating",
  RARITY_ID: "rarity_id",
  CARD_TYPE: "card_type",
  SPECIAL_GROUPS: "special_groups",
});

const FEATURE_KINDS = Object.freeze({
  rating: Fc27ObservedValueKind.RATING,
  rarityId: Fc27ObservedValueKind.SAFE_ID,
  cardType: Fc27ObservedValueKind.SAFE_ID,
  specialGroups: Fc27ObservedValueKind.STRING_LIST,
});

const FEATURE_FIELD_BY_CODE = Object.freeze({
  [ItemScoreFeatureCode.RATING]: "rating",
  [ItemScoreFeatureCode.RARITY_ID]: "rarityId",
  [ItemScoreFeatureCode.CARD_TYPE]: "cardType",
  [ItemScoreFeatureCode.SPECIAL_GROUPS]: "specialGroups",
});

const fail = (code, message, path) => {
  throw new ProContractError(code, message, { path });
};

const invalid = (message, path) =>
  fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, message, path);

const contractFingerprint = (value) => stableFingerprint(value).replace(":", "_");

const assertScoreJson = (value, path) => assertPlainJson(value, {
  path,
  maxBytes: ITEM_SCORE_LIMITS.maxBytes,
  maxDepth: ITEM_SCORE_LIMITS.maxDepth,
  maxArrayLength: ITEM_SCORE_LIMITS.maxItems,
  maxObjectKeys: ITEM_SCORE_LIMITS.maxObjectKeys,
  maxStringBytes: 128,
});

const normalizeFingerprint = (value, path) => {
  const normalized = normalizeSafeId(value, { path, maxLength: 128 });
  return normalized;
};

export const validateItemScoreModelRef = (value, path = "$itemScoreModel") => {
  assertExactKeys(value, { required: ["modelId", "version", "fingerprint"], path });
  return {
    modelId: normalizeSafeId(value.modelId, { path: `${path}.modelId`, maxLength: 80 }),
    version: normalizeSafeId(value.version, { path: `${path}.version`, maxLength: 80 }),
    fingerprint: normalizeFingerprint(value.fingerprint, `${path}.fingerprint`),
  };
};

const canonicalDescriptor = (value) => ({
  providerId: value.providerId,
  state: value.state,
  gameVersion: value.gameVersion,
  challengeKind: value.challengeKind,
  model: value.model,
  requiredFeatureCodes: value.requiredFeatureCodes,
  maxItems: value.maxItems,
});

const normalizeDescriptor = (value, { requireFingerprint }) => {
  assertScoreJson(value, "$itemScoreProviderDescriptor");
  assertExactKeys(value, {
    required: [
      "providerId", "state", "gameVersion", "challengeKind", "model",
      "requiredFeatureCodes", "maxItems",
      ...(requireFingerprint ? ["descriptorFingerprint"] : []),
    ],
    optional: requireFingerprint ? [] : ["descriptorFingerprint"],
    path: "$itemScoreProviderDescriptor",
  });
  const state = normalizeEnum(value.state, Object.values(ItemScoreProviderState), {
    path: "$itemScoreProviderDescriptor.state",
  });
  if (value.gameVersion !== "fc27") invalid("Item score providers are FC27-specific", "$itemScoreProviderDescriptor.gameVersion");
  if (value.challengeKind !== "STREAMLINED_SCORE") {
    invalid("Item score providers only support streamlined score challenges", "$itemScoreProviderDescriptor.challengeKind");
  }
  if (!Array.isArray(value.requiredFeatureCodes)) {
    invalid("requiredFeatureCodes must be an array", "$itemScoreProviderDescriptor.requiredFeatureCodes");
  }
  const requiredFeatureCodes = value.requiredFeatureCodes.map((entry, index) =>
    normalizeEnum(entry, Object.values(ItemScoreFeatureCode), {
      path: `$itemScoreProviderDescriptor.requiredFeatureCodes[${index}]`,
    }));
  if (new Set(requiredFeatureCodes).size !== requiredFeatureCodes.length) {
    invalid("requiredFeatureCodes must be unique", "$itemScoreProviderDescriptor.requiredFeatureCodes");
  }
  requiredFeatureCodes.sort();
  const maxItems = normalizeFiniteInteger(value.maxItems, {
    path: "$itemScoreProviderDescriptor.maxItems", min: 0, max: ITEM_SCORE_LIMITS.maxItems,
  });
  const model = value.model == null ? null : validateItemScoreModelRef(
    value.model,
    "$itemScoreProviderDescriptor.model",
  );
  if (state === ItemScoreProviderState.READY && (model == null || maxItems < 1)) {
    invalid("A ready provider requires a model and positive item bound", "$itemScoreProviderDescriptor");
  }
  if (state === ItemScoreProviderState.NOT_CONFIGURED &&
      (model !== null || maxItems !== 0 || requiredFeatureCodes.length !== 0)) {
    invalid("A not-configured provider cannot claim a model or supported features", "$itemScoreProviderDescriptor");
  }
  const output = {
    providerId: normalizeSafeId(value.providerId, {
      path: "$itemScoreProviderDescriptor.providerId", maxLength: 80,
    }),
    state,
    gameVersion: "fc27",
    challengeKind: "STREAMLINED_SCORE",
    model,
    requiredFeatureCodes,
    maxItems,
  };
  if (requireFingerprint) {
    output.descriptorFingerprint = normalizeFingerprint(
      value.descriptorFingerprint,
      "$itemScoreProviderDescriptor.descriptorFingerprint",
    );
  }
  return output;
};

export const createItemScoreProviderDescriptor = (value) => {
  const normalized = normalizeDescriptor(value, { requireFingerprint: false });
  const descriptorFingerprint = contractFingerprint(canonicalDescriptor(normalized));
  return cloneAndFreezeContract({ ...normalized, descriptorFingerprint });
};

export const validateItemScoreProviderDescriptor = (value) => {
  const normalized = normalizeDescriptor(value, { requireFingerprint: true });
  const expected = contractFingerprint(canonicalDescriptor(normalized));
  if (normalized.descriptorFingerprint !== expected) {
    invalid("Provider descriptor fingerprint mismatch", "$itemScoreProviderDescriptor.descriptorFingerprint");
  }
  return cloneAndFreezeContract(normalized);
};

const normalizeFeatures = (value, path) => {
  assertExactKeys(value, { required: Object.keys(FEATURE_KINDS), path });
  return Object.fromEntries(Object.entries(FEATURE_KINDS).map(([field, valueKind]) => [
    field,
    validateFc27ObservedField(value[field], { valueKind, path: `${path}.${field}` }),
  ]));
};

const normalizeScoreItem = (value, path) => {
  assertExactKeys(value, {
    required: ["itemHandle", "itemEvidenceFingerprint", "features"],
    path,
  });
  return {
    itemHandle: normalizeSafeId(value.itemHandle, { path: `${path}.itemHandle`, maxLength: 80 }),
    itemEvidenceFingerprint: normalizeFingerprint(
      value.itemEvidenceFingerprint,
      `${path}.itemEvidenceFingerprint`,
    ),
    features: normalizeFeatures(value.features, `${path}.features`),
  };
};

const canonicalRequest = (value) => ({
  schemaVersion: value.schemaVersion,
  contract: value.contract,
  requestId: value.requestId,
  createdAt: value.createdAt,
  expiresAt: value.expiresAt,
  challengeFingerprint: value.challengeFingerprint,
  model: value.model,
  items: [...value.items].sort((left, right) => left.itemHandle.localeCompare(right.itemHandle)),
});

const normalizeRequest = (value, { requireFingerprint, now = null }) => {
  assertScoreJson(value, "$itemScoreRequest");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "createdAt", "expiresAt",
      "challengeFingerprint", "model", "items", ...(requireFingerprint ? ["fingerprint"] : []),
    ],
    optional: requireFingerprint ? [] : ["fingerprint"],
    path: "$itemScoreRequest",
  });
  if (value.schemaVersion !== ITEM_SCORE_SCHEMA_VERSION) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED, "Unsupported item-score schema", "$itemScoreRequest.schemaVersion");
  }
  if (value.contract !== ITEM_SCORE_CONTRACT) invalid("Unexpected item-score contract", "$itemScoreRequest.contract");
  const createdAt = normalizeFiniteInteger(value.createdAt, { path: "$itemScoreRequest.createdAt", min: 0 });
  const expiresAt = normalizeFiniteInteger(value.expiresAt, { path: "$itemScoreRequest.expiresAt", min: 0 });
  if (expiresAt <= createdAt || expiresAt - createdAt > ITEM_SCORE_LIMITS.maxTtlMs) {
    invalid("Item-score request has an invalid bounded lifetime", "$itemScoreRequest.expiresAt");
  }
  if (now != null && expiresAt <= normalizeFiniteInteger(now, { path: "$now", min: 0 })) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED, "Item-score request has expired", "$itemScoreRequest.expiresAt");
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > ITEM_SCORE_LIMITS.maxItems) {
    invalid("Item-score request requires 1 to 100 items", "$itemScoreRequest.items");
  }
  const items = value.items.map((entry, index) => normalizeScoreItem(entry, `$itemScoreRequest.items[${index}]`));
  const handles = items.map((entry) => entry.itemHandle);
  if (new Set(handles).size !== handles.length) invalid("Item handles must be unique", "$itemScoreRequest.items");
  items.sort((left, right) => left.itemHandle.localeCompare(right.itemHandle));
  const output = {
    schemaVersion: ITEM_SCORE_SCHEMA_VERSION,
    contract: ITEM_SCORE_CONTRACT,
    requestId: normalizeSafeId(value.requestId, { path: "$itemScoreRequest.requestId", maxLength: 80 }),
    createdAt,
    expiresAt,
    challengeFingerprint: normalizeFingerprint(value.challengeFingerprint, "$itemScoreRequest.challengeFingerprint"),
    model: validateItemScoreModelRef(value.model, "$itemScoreRequest.model"),
    items,
  };
  if (requireFingerprint) output.fingerprint = normalizeFingerprint(value.fingerprint, "$itemScoreRequest.fingerprint");
  return output;
};

export const createItemScoreRequest = (value) => {
  const normalized = normalizeRequest(value, { requireFingerprint: false });
  const fingerprint = contractFingerprint(canonicalRequest(normalized));
  return cloneAndFreezeContract({ ...normalized, fingerprint }, {
    path: "$itemScoreRequest", maxBytes: ITEM_SCORE_LIMITS.maxBytes,
    maxDepth: ITEM_SCORE_LIMITS.maxDepth, maxArrayLength: ITEM_SCORE_LIMITS.maxItems,
    maxObjectKeys: ITEM_SCORE_LIMITS.maxObjectKeys, maxStringBytes: 128,
  });
};

export const validateItemScoreRequest = (value, { now = null } = {}) => {
  const normalized = normalizeRequest(value, { requireFingerprint: true, now });
  const expected = contractFingerprint(canonicalRequest(normalized));
  if (normalized.fingerprint !== expected) invalid("Item-score request fingerprint mismatch", "$itemScoreRequest.fingerprint");
  return cloneAndFreezeContract(normalized);
};

export const validateItemScoreRequestForProvider = (value, descriptor, { now = null } = {}) => {
  const request = validateItemScoreRequest(value, { now });
  const provider = validateItemScoreProviderDescriptor(descriptor);
  if (provider.state !== ItemScoreProviderState.READY) {
    fail(
      provider.state === ItemScoreProviderState.NOT_CONFIGURED
        ? PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED
        : PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED,
      "Item score provider is not ready",
      "$itemScoreProviderDescriptor.state",
    );
  }
  if (request.items.length > provider.maxItems ||
      stableFingerprint(request.model) !== stableFingerprint(provider.model)) {
    fail(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED, "Item-score request exceeds its provider model", "$itemScoreRequest");
  }
  for (const item of request.items) {
    for (const featureCode of provider.requiredFeatureCodes) {
      const field = FEATURE_FIELD_BY_CODE[featureCode];
      if (item.features[field]?.state !== "VERIFIED") {
        fail(
          PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED,
          "A provider-required item feature is unverified",
          `$itemScoreRequest.items.${item.itemHandle}.features.${field}`,
        );
      }
    }
  }
  return request;
};

const normalizeScore = (value, path) => {
  assertExactKeys(value, { required: ["itemHandle", "score", "evidenceFingerprint"], path });
  return {
    itemHandle: normalizeSafeId(value.itemHandle, { path: `${path}.itemHandle`, maxLength: 80 }),
    score: normalizeFiniteInteger(value.score, { path: `${path}.score`, min: 0, max: ITEM_SCORE_LIMITS.maxScore }),
    evidenceFingerprint: normalizeFingerprint(value.evidenceFingerprint, `${path}.evidenceFingerprint`),
  };
};

const canonicalResponse = (value) => ({
  schemaVersion: value.schemaVersion,
  contract: value.contract,
  requestId: value.requestId,
  requestFingerprint: value.requestFingerprint,
  challengeFingerprint: value.challengeFingerprint,
  model: value.model,
  expiresAt: value.expiresAt,
  status: value.status,
  scores: [...value.scores].sort((left, right) => left.itemHandle.localeCompare(right.itemHandle)),
});

const normalizeResponse = (value, { requireFingerprint }) => {
  assertScoreJson(value, "$itemScoreResponse");
  assertExactKeys(value, {
    required: [
      "schemaVersion", "contract", "requestId", "requestFingerprint",
      "challengeFingerprint", "model", "expiresAt", "status", "scores",
      ...(requireFingerprint ? ["fingerprint"] : []),
    ],
    optional: requireFingerprint ? [] : ["fingerprint"],
    path: "$itemScoreResponse",
  });
  if (value.schemaVersion !== ITEM_SCORE_SCHEMA_VERSION) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED, "Unsupported item-score schema", "$itemScoreResponse.schemaVersion");
  }
  if (value.contract !== ITEM_SCORE_CONTRACT) invalid("Unexpected item-score contract", "$itemScoreResponse.contract");
  if (!Array.isArray(value.scores) || value.scores.length > ITEM_SCORE_LIMITS.maxItems) {
    invalid("Item scores exceed their bound", "$itemScoreResponse.scores");
  }
  const scores = value.scores.map((entry, index) => normalizeScore(entry, `$itemScoreResponse.scores[${index}]`));
  const handles = scores.map((entry) => entry.itemHandle);
  if (new Set(handles).size !== handles.length) invalid("Score handles must be unique", "$itemScoreResponse.scores");
  scores.sort((left, right) => left.itemHandle.localeCompare(right.itemHandle));
  const output = {
    schemaVersion: ITEM_SCORE_SCHEMA_VERSION,
    contract: ITEM_SCORE_CONTRACT,
    requestId: normalizeSafeId(value.requestId, { path: "$itemScoreResponse.requestId", maxLength: 80 }),
    requestFingerprint: normalizeFingerprint(value.requestFingerprint, "$itemScoreResponse.requestFingerprint"),
    challengeFingerprint: normalizeFingerprint(value.challengeFingerprint, "$itemScoreResponse.challengeFingerprint"),
    model: validateItemScoreModelRef(value.model, "$itemScoreResponse.model"),
    expiresAt: normalizeFiniteInteger(value.expiresAt, { path: "$itemScoreResponse.expiresAt", min: 0 }),
    status: normalizeEnum(value.status, Object.values(ItemScoreResponseStatus), { path: "$itemScoreResponse.status" }),
    scores,
  };
  if (requireFingerprint) output.fingerprint = normalizeFingerprint(value.fingerprint, "$itemScoreResponse.fingerprint");
  return output;
};

export const createItemScoreResponse = (value) => {
  const normalized = normalizeResponse(value, { requireFingerprint: false });
  const fingerprint = contractFingerprint(canonicalResponse(normalized));
  return cloneAndFreezeContract({ ...normalized, fingerprint });
};

export const validateItemScoreResponse = (value, { request, now = Date.now() } = {}) => {
  const normalizedRequest = validateItemScoreRequest(request);
  const normalized = normalizeResponse(value, { requireFingerprint: true });
  const expectedFingerprint = contractFingerprint(canonicalResponse(normalized));
  if (normalized.fingerprint !== expectedFingerprint) {
    invalid("Item-score response fingerprint mismatch", "$itemScoreResponse.fingerprint");
  }
  if (normalized.requestId !== normalizedRequest.requestId ||
      normalized.requestFingerprint !== normalizedRequest.fingerprint ||
      normalized.challengeFingerprint !== normalizedRequest.challengeFingerprint ||
      stableFingerprint(normalized.model) !== stableFingerprint(normalizedRequest.model)) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH, "Item-score response does not match its request", "$itemScoreResponse");
  }
  const currentTime = normalizeFiniteInteger(now, { path: "$now", min: 0 });
  if (normalized.expiresAt > normalizedRequest.expiresAt ||
      normalized.expiresAt <= normalizedRequest.createdAt ||
      normalized.expiresAt <= currentTime) {
    fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED, "Item-score response is expired", "$itemScoreResponse.expiresAt");
  }
  const requestedHandles = normalizedRequest.items.map((entry) => entry.itemHandle);
  const responseHandles = normalized.scores.map((entry) => entry.itemHandle);
  if (requestedHandles.length !== responseHandles.length ||
      requestedHandles.some((handle, index) => handle !== responseHandles[index])) {
    fail(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN, "Item-score response must cover the exact request handles", "$itemScoreResponse.scores");
  }
  return cloneAndFreezeContract(normalized);
};

export class ItemScoreProvider {
  constructor(descriptor) {
    this.descriptor = validateItemScoreProviderDescriptor(descriptor);
  }

  describe() {
    return this.descriptor;
  }

  async scoreItems(_request, _options = {}) {
    throw new Error(`${this.descriptor.providerId}.scoreItems() is not implemented`);
  }
}

export class NotConfiguredItemScoreProvider extends ItemScoreProvider {
  constructor({ providerId = "item_score_not_configured" } = {}) {
    super(createItemScoreProviderDescriptor({
      providerId,
      state: ItemScoreProviderState.NOT_CONFIGURED,
      gameVersion: "fc27",
      challengeKind: "STREAMLINED_SCORE",
      model: null,
      requiredFeatureCodes: [],
      maxItems: 0,
    }));
    Object.freeze(this);
  }

  async scoreItems(request, _options = {}) {
    validateItemScoreRequest(request);
    fail(
      PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "Item score provider is not configured",
      "$itemScoreProvider",
    );
  }
}
