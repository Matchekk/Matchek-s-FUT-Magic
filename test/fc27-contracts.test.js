import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createItemScoreProviderDescriptor,
  createItemScoreRequest,
  createItemScoreResponse,
  createStreamlinedChallengeObservation,
  deriveStreamlinedObservationState,
  FC27_STREAMLINED_CONTRACT,
  FC27_STREAMLINED_LIMITS,
  Fc27EvidenceReason,
  Fc27EvidenceSourceKind,
  Fc27EvidenceState,
  ItemScoreFeatureCode,
  ITEM_SCORE_LIMITS,
  ItemScoreProviderState,
  NotConfiguredItemScoreProvider,
  validateFc27ObservedField,
  validateItemScoreRequestForProvider,
  validateItemScoreResponse,
  validateStreamlinedChallengeObservation,
} from "../src/application/index.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "../src/application/pro-contracts/index.js";

const reviewedSource = (id = "fixture_a") => ({
  kind: Fc27EvidenceSourceKind.REVIEWED_FIXTURE,
  sourceId: id,
  sourceFingerprint: `fnv1a32_${id}`,
  adapterVersion: "fixture_adapter_1",
  eaBuild: null,
  locale: "en-GB",
});

const liveSource = () => ({
  kind: Fc27EvidenceSourceKind.LIVE_OBSERVATION,
  sourceId: "live_observation_1",
  sourceFingerprint: "fnv1a32_live1",
  adapterVersion: null,
  eaBuild: null,
  locale: null,
});

const verified = (value, sources = [reviewedSource()]) => ({
  state: Fc27EvidenceState.VERIFIED,
  value,
  reasonCode: Fc27EvidenceReason.REVIEWED_FIXTURE_MATCH,
  sources,
});

const unknown = (reasonCode = Fc27EvidenceReason.NOT_OBSERVED) => ({
  state: Fc27EvidenceState.UNKNOWN,
  value: null,
  reasonCode,
  sources: [],
});

const unverified = () => ({
  state: Fc27EvidenceState.UNVERIFIED,
  value: null,
  reasonCode: Fc27EvidenceReason.UNREVIEWED_OBSERVATION,
  sources: [liveSource()],
});

const ruleSet = (id) => ({
  ruleSetId: id,
  version: "v1",
  fingerprint: `fnv1a32_${id}`,
});

const unknownObservation = (overrides = {}) => ({
  schemaVersion: 1,
  contract: FC27_STREAMLINED_CONTRACT,
  observationId: "observation_1",
  gameVersion: "fc27",
  classification: unknown(),
  setId: unknown(),
  challengeId: unknown(),
  targetScore: unknown(),
  currentScore: unknown(),
  eligibility: unknown(),
  rarityRules: unknown(),
  allowsDuplicates: unknown(),
  allowsPartialSubmission: unknown(),
  scoreModelVersion: unknown(),
  unmappedEvidence: [],
  adapterVersion: null,
  eaBuild: null,
  observedAt: 1_000,
  ...overrides,
});

const verifiedObservation = (overrides = {}) => unknownObservation({
  classification: verified("STREAMLINED_SCORE"),
  setId: verified("set_1"),
  challengeId: verified("challenge_1"),
  targetScore: verified(0),
  currentScore: verified(0),
  eligibility: verified(ruleSet("eligibility_1")),
  rarityRules: verified(ruleSet("rarity_1")),
  allowsDuplicates: verified(false),
  allowsPartialSubmission: verified(false),
  scoreModelVersion: verified("score_model_1"),
  ...overrides,
});

const scoreModel = {
  modelId: "score_model",
  version: "v1",
  fingerprint: "fnv1a32_model1",
};

const scoreFeatures = (field = verified) => ({
  rating: field(84),
  rarityId: field("rare_gold"),
  cardType: field("gold"),
  specialGroups: field(["promo", "totw"]),
});

const requestInput = (items = [{
  itemHandle: "item_a",
  itemEvidenceFingerprint: "fnv1a32_itema",
  features: scoreFeatures(),
}]) => ({
  schemaVersion: 1,
  contract: "item_score.v1",
  requestId: "request_1",
  createdAt: 1_000,
  expiresAt: 2_000,
  challengeFingerprint: "fnv1a32_challenge1",
  model: scoreModel,
  items,
});

const assertCode = (code) => (error) =>
  error instanceof ProContractError && error.code === code;

const assertNoExecutionOrTransportFields = (value) => {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(/^(?:steps?|commands?|workflow|endpoint|url|token|browser)$/i.test(key), false, key);
    assertNoExecutionOrTransportFields(entry);
  }
};

test("unknown and unverified FC27 fields keep null values while verified false, zero, and arrays survive", () => {
  const created = createStreamlinedChallengeObservation(verifiedObservation({
    currentScore: unverified(),
    eligibility: unknown(Fc27EvidenceReason.FIELD_ABSENT),
  }));

  assert.equal(created.currentScore.value, null);
  assert.equal(created.eligibility.value, null);
  assert.equal(created.targetScore.value, 0);
  assert.equal(created.allowsDuplicates.value, false);
  assert.equal(Object.isFrozen(created.currentScore), true);
  assert.equal(deriveStreamlinedObservationState(created), Fc27EvidenceState.UNVERIFIED);

  const list = validateFc27ObservedField(verified([]), {
    valueKind: "STRING_LIST",
    path: "$list",
  });
  assert.deepEqual(list.value, []);
});

test("field evidence rejects guessed values and live-only verification", () => {
  assert.throws(
    () => validateFc27ObservedField({ ...unknown(), value: false }, {
      valueKind: "BOOLEAN", path: "$unknown",
    }),
    ProContractError,
  );
  assert.throws(
    () => validateFc27ObservedField({ ...unverified(), value: 5 }, {
      valueKind: "SCORE", path: "$unverified",
    }),
    ProContractError,
  );
  assert.throws(
    () => validateFc27ObservedField(verified(true, [liveSource()]), {
      valueKind: "BOOLEAN", path: "$live",
    }),
    ProContractError,
  );
});

test("streamlined observations are strict FC27-only DTOs with matched canonical fingerprints", () => {
  const created = createStreamlinedChallengeObservation(verifiedObservation());
  const validated = validateStreamlinedChallengeObservation(created);

  assert.equal(deriveStreamlinedObservationState(validated), Fc27EvidenceState.VERIFIED);
  assert.equal(validated.gameVersion, "fc27");
  assertNoExecutionOrTransportFields(validated);

  assert.throws(
    () => createStreamlinedChallengeObservation({ ...verifiedObservation(), gameVersion: "fc26" }),
    ProContractError,
  );
  assert.throws(
    () => createStreamlinedChallengeObservation({
      ...verifiedObservation(),
      requirementsNormalized: [{ type: "team_rating", count: 84 }],
    }),
    ProContractError,
  );
  assert.throws(
    () => validateStreamlinedChallengeObservation({ ...created, fingerprint: "fnv1a32_wrong" }),
    ProContractError,
  );
});

test("observation fingerprints ignore ordering and observation time but bind semantic evidence", () => {
  const sources = [reviewedSource("fixture_b"), reviewedSource("fixture_a")];
  const first = createStreamlinedChallengeObservation(verifiedObservation({
    targetScore: verified(100, sources),
    unmappedEvidence: [
      { pathFingerprint: "fnv1a32_pathb", type: "ARRAY", valueFingerprint: "fnv1a32_valueb" },
      { pathFingerprint: "fnv1a32_patha", type: "SCALAR", valueFingerprint: "fnv1a32_valuea" },
    ],
    observedAt: 1_000,
  }));
  const second = createStreamlinedChallengeObservation(verifiedObservation({
    targetScore: verified(100, [...sources].reverse()),
    unmappedEvidence: [...first.unmappedEvidence].reverse(),
    observedAt: 9_999,
  }));
  const changed = createStreamlinedChallengeObservation(verifiedObservation({
    targetScore: verified(101, sources),
    unmappedEvidence: [...first.unmappedEvidence],
  }));

  assert.equal(second.fingerprint, first.fingerprint);
  assert.notEqual(changed.fingerprint, first.fingerprint);
});

test("streamlined bounds reject rather than truncate unmapped evidence", () => {
  const unmappedEvidence = Array.from(
    { length: FC27_STREAMLINED_LIMITS.maxUnmappedEvidence + 1 },
    (_, index) => ({
      pathFingerprint: `fnv1a32_path${index}`,
      type: "OBJECT",
      valueFingerprint: `fnv1a32_value${index}`,
    }),
  );
  assert.throws(
    () => createStreamlinedChallengeObservation(unknownObservation({ unmappedEvidence })),
    ProContractError,
  );
});

test("FC27 modules remain separate from the classic constraint solver", async () => {
  const source = await readFile(new URL("../src/application/fc27-streamlined.js", import.meta.url), "utf8");
  const provider = await readFile(new URL("../src/application/item-score-provider.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /constraint-compiler|existing-autopilot-solver|requirementsNormalized/);
  assert.doesNotMatch(provider, /constraint-compiler|existing-autopilot-solver|requirementsNormalized/);
});

test("not-configured ItemScoreProvider is closed, immutable, and fails with a stable code", async () => {
  const provider = new NotConfiguredItemScoreProvider();
  const descriptor = provider.describe();
  const request = createItemScoreRequest(requestInput());

  assert.equal(descriptor.state, ItemScoreProviderState.NOT_CONFIGURED);
  assert.equal(descriptor.model, null);
  assert.equal(descriptor.maxItems, 0);
  assert.equal(Object.isFrozen(descriptor), true);
  assertNoExecutionOrTransportFields(descriptor);
  await assert.rejects(
    provider.scoreItems(request),
    assertCode(PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
});

test("configured provider validation requires its exact model, bounds, and verified feature evidence", () => {
  const descriptor = createItemScoreProviderDescriptor({
    providerId: "fixture_scorer",
    state: ItemScoreProviderState.READY,
    gameVersion: "fc27",
    challengeKind: "STREAMLINED_SCORE",
    model: scoreModel,
    requiredFeatureCodes: [ItemScoreFeatureCode.RATING, ItemScoreFeatureCode.RARITY_ID],
    maxItems: 2,
  });
  const request = createItemScoreRequest(requestInput());
  assert.deepEqual(validateItemScoreRequestForProvider(request, descriptor, { now: 1_500 }), request);

  const unverifiedRating = createItemScoreRequest(requestInput([{
    itemHandle: "item_a",
    itemEvidenceFingerprint: "fnv1a32_itema",
    features: scoreFeatures((value) => typeof value === "number" ? unverified() : verified(value)),
  }]));
  assert.throws(
    () => validateItemScoreRequestForProvider(unverifiedRating, descriptor, { now: 1_500 }),
    assertCode(PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED),
  );
});

test("score request canonicalization is order-independent and bounds fail closed", () => {
  const entries = ["item_b", "item_a"].map((itemHandle) => ({
    itemHandle,
    itemEvidenceFingerprint: `fnv1a32_${itemHandle}`,
    features: scoreFeatures(),
  }));
  const first = createItemScoreRequest(requestInput(entries));
  const second = createItemScoreRequest(requestInput([...entries].reverse()));
  assert.equal(second.fingerprint, first.fingerprint);
  assert.deepEqual(second.items.map((entry) => entry.itemHandle), ["item_a", "item_b"]);

  const oversized = Array.from({ length: ITEM_SCORE_LIMITS.maxItems + 1 }, (_, index) => ({
    itemHandle: `item_${index}`,
    itemEvidenceFingerprint: `fnv1a32_item${index}`,
    features: scoreFeatures(),
  }));
  assert.throws(() => createItemScoreRequest(requestInput(oversized)), ProContractError);
});

test("score responses require exact request, model, expiry, and complete unique handles", () => {
  const request = createItemScoreRequest(requestInput([
    { itemHandle: "item_b", itemEvidenceFingerprint: "fnv1a32_itemb", features: scoreFeatures() },
    { itemHandle: "item_a", itemEvidenceFingerprint: "fnv1a32_itema", features: scoreFeatures() },
  ]));
  const response = createItemScoreResponse({
    schemaVersion: 1,
    contract: "item_score.v1",
    requestId: request.requestId,
    requestFingerprint: request.fingerprint,
    challengeFingerprint: request.challengeFingerprint,
    model: request.model,
    expiresAt: 1_900,
    status: "SCORED",
    scores: [
      { itemHandle: "item_b", score: 0, evidenceFingerprint: "fnv1a32_scoreb" },
      { itemHandle: "item_a", score: 1_000, evidenceFingerprint: "fnv1a32_scorea" },
    ],
  });
  const validated = validateItemScoreResponse(response, { request, now: 1_500 });
  assert.deepEqual(validated.scores.map((entry) => entry.itemHandle), ["item_a", "item_b"]);
  assert.equal(validated.scores[0].score, 1_000);
  assertNoExecutionOrTransportFields(validated);

  const { fingerprint: _ignoredFingerprint, ...responseWithoutFingerprint } = response;
  const missing = createItemScoreResponse({
    ...responseWithoutFingerprint,
    scores: [{ itemHandle: "item_a", score: 1_000, evidenceFingerprint: "fnv1a32_scorea" }],
  });
  assert.throws(
    () => validateItemScoreResponse(missing, { request, now: 1_500 }),
    assertCode(PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN),
  );
  assert.throws(
    () => validateItemScoreResponse(response, { request, now: 1_950 }),
    assertCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED),
  );
});
