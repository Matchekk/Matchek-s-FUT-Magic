import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFodderReview,
  buildFodderReviewFingerprints,
  compareFodderReviewFingerprints,
  createFodderReviewStrategy,
  FODDER_REVIEW_CAPABILITIES,
  FODDER_REVIEW_KIND,
  FODDER_REVIEW_SAFETY_BOUNDARY,
  GoalKind,
} from "../src/application/index.js";
import { FodderPolicy } from "../src/policies/fodder-policy.js";
import { TargetProjectService } from "../src/policies/target-project-service.js";

const verifiedSourceEvidence = {
  schemaVersion: 1,
  fields: {
    locked: "verified",
    protected: "verified",
    favorite: "verified",
    special: "verified",
    tradability: "verified",
    startingSquad: "unverified",
  },
  activeSquadProtection: { state: "verified", mode: "excluded_by_definition" },
  loansIncluded: false,
};

const capabilitySnapshot = {
  revision: 99,
  capabilities: [{
    id: "ea.inventory.read",
    state: "available",
    observedAt: 123,
    evidence: { kind: "controller", schemaVersion: 1, volatile: "ignored" },
  }],
};

const item = (itemId, rating, overrides = {}) => ({
  itemId: String(itemId),
  resourceId: `resource-${itemId}`,
  baseId: `player-${itemId}`,
  location: "club",
  rating,
  name: `Card ${itemId}`,
  cardType: "base",
  isSpecial: false,
  isTradable: false,
  isUntradeable: true,
  isDuplicate: false,
  isStorage: false,
  isLocked: false,
  isProtected: false,
  isFavorite: false,
  isInStartingSquad: false,
  ...overrides,
});

const context = { gameVersion: "fc26", state: "verified", observedAt: 100 };

test("Protection Review groups exact hard reasons, counts unique cards, and exposes no item IDs", () => {
  const policy = new FodderPolicy({
    protectRatingAtOrAbove: 94,
    protectedItemIds: ["one"],
    protectFavorites: true,
    protectStartingSquad: true,
  });
  const review = buildFodderReview({
    gameContext: context,
    inventorySnapshot: {
      generation: 1,
      updatedAt: "2026-08-26T10:00:00.000Z",
      items: [
        item("one", 96, { isFavorite: true }),
        item("two", 84),
      ],
    },
    policy,
    capabilitySnapshot,
    sourceEvidence: verifiedSourceEvidence,
  });

  assert.deepEqual(review.steps, []);
  assert.equal(review.preview.kind, FODDER_REVIEW_KIND);
  assert.equal(review.preview.safetyBoundary, FODDER_REVIEW_SAFETY_BOUNDARY);
  assert.equal(review.preview.readOnly, true);
  assert.equal(review.preview.canApprove, false);
  assert.equal(review.preview.verificationState, "verified");
  assert.equal(review.preview.uniqueHardProtectedCount, 1);
  assert.equal(review.preview.notHardProtectedCount, 1);
  assert.equal(review.preview.observedAt, Date.parse("2026-08-26T10:00:00.000Z"));
  assert.deepEqual(
    review.preview.reasonGroups.map((group) => group.code),
    ["protected-item", "protected-rating", "favorite"],
  );
  assert.equal(review.preview.reasonGroups.every((group) => group.itemCount === 1), true);
  const examples = review.preview.reasonGroups.flatMap((group) => group.examples);
  assert.equal(examples.every((example) => !("itemId" in example)), true);
  assert.equal(examples.every((example) => !("resourceId" in example)), true);
  assert.equal(JSON.stringify(review.preview).includes("resource-one"), false);
});

test("rating, special, and Target Project reserves remain soft conservation signals", () => {
  const targets = new TargetProjectService([{
    id: "project-a",
    name: "Project A",
    active: true,
    priority: 4,
    requiredSquadsRemaining: 2,
    ratingRequirements: [{ rating: 89, count: 2 }],
    specialCardRequirements: [{ cardType: "totw", count: 1 }],
    protectedRatings: { reserveByRating: { 88: 1 } },
  }]);
  const policy = new FodderPolicy(
    { minimumReserveByRating: { 89: 2 } },
    { targetProjects: targets },
  );
  const review = buildFodderReview({
    gameContext: context,
    inventorySnapshot: {
      generation: 1,
      items: [
        item("a", 89),
        item("b", 89, { location: "sbc_storage", isStorage: true }),
        item("c", 84, { cardType: "totw", isSpecial: true }),
      ],
    },
    policy,
    targetProjects: targets,
    capabilitySnapshot,
    sourceEvidence: verifiedSourceEvidence,
  });

  assert.equal(review.preview.uniqueHardProtectedCount, 0);
  assert.equal(review.preview.notHardProtectedCount, 3);
  assert.deepEqual(
    review.preview.softConservation.ratingReserves.map((entry) =>
      [entry.rating, entry.reserved, entry.observedCount, entry.signal]),
    [[88, 1, 0, "soft_conservation"], [89, 2, 2, "soft_conservation"]],
  );
  assert.deepEqual(
    review.preview.softConservation.specialReserves.map((entry) =>
      [entry.cardType, entry.reserved, entry.observedCount, entry.signal]),
    [["totw", 1, 1, "soft_conservation"]],
  );
  assert.deepEqual(review.preview.softConservation.projectRatingDemand, [{
    projectId: "project-a", rating: 89, count: 2, priority: 4,
  }]);
  assert.deepEqual(review.preview.projectSignals, [{
    name: "Project A",
    hardExclusions: [],
    conservationPreferences: [
      "Keep 1 at 88 rating",
      "2 remaining 89-rated squad signals",
      "Keep 1 TOTW special signal",
    ],
    unknownRequirementCount: 0,
  }]);
});

test("fingerprints ignore order, refresh metadata, names, and irrelevant capability evidence", () => {
  const policy = new FodderPolicy({ minimumReserveByRating: { 89: 2 } });
  const base = {
    gameContext: context,
    inventorySnapshot: {
      generation: 1,
      storageCapacity: 100,
      items: [item("b", 84), item("a", 89)],
    },
    policy,
    targetProjects: [{ id: "p", name: "Project", protectedRatings: [90] }],
    capabilitySnapshot,
    sourceEvidence: verifiedSourceEvidence,
  };
  const first = buildFodderReviewFingerprints(base);
  const refreshed = buildFodderReviewFingerprints({
    ...base,
    gameContext: { ...context, observedAt: 999, route: "/different" },
    inventorySnapshot: {
      ...base.inventorySnapshot,
      generation: 9,
      items: base.inventorySnapshot.items.map((entry) => ({
        ...entry,
        name: `Localized ${entry.name}`,
      })).reverse(),
    },
    capabilitySnapshot: {
      revision: 100,
      capabilities: [{
        ...capabilitySnapshot.capabilities[0],
        observedAt: 999,
        evidence: { kind: "controller", schemaVersion: 1, volatile: "changed" },
      }],
    },
  });
  assert.deepEqual(compareFodderReviewFingerprints(first, refreshed), {
    ok: true,
    changed: [],
  });
  assert.notEqual(first.inventoryGeneration, refreshed.inventoryGeneration);

  const changed = buildFodderReviewFingerprints({
    ...base,
    inventorySnapshot: {
      ...base.inventorySnapshot,
      generation: 2,
      items: base.inventorySnapshot.items.map((entry) =>
        entry.itemId === "a" ? { ...entry, rating: 90 } : entry),
    },
  });
  assert.deepEqual(compareFodderReviewFingerprints(first, changed), {
    ok: false,
    changed: ["inventory"],
  });

  const evidenceChanged = buildFodderReviewFingerprints({
    ...base,
    inventorySnapshot: {
      ...base.inventorySnapshot,
      items: base.inventorySnapshot.items.map((entry) =>
        entry.itemId === "a" ? { ...entry, hasLockedEvidence: true } : entry),
    },
  });
  assert.deepEqual(compareFodderReviewFingerprints(first, evidenceChanged), {
    ok: false,
    changed: ["inventory"],
  });
});

test("policy Maps and omitted versus empty allowed-special lists affect canonical fingerprints", () => {
  const base = {
    gameContext: context,
    inventorySnapshot: { generation: 1, items: [item("a", 89)] },
    targetProjects: [],
    capabilitySnapshot,
    sourceEvidence: verifiedSourceEvidence,
  };
  const one = buildFodderReviewFingerprints({
    ...base,
    policy: new FodderPolicy({ minimumReserveByRating: { 89: 1 } }),
  });
  const two = buildFodderReviewFingerprints({
    ...base,
    policy: new FodderPolicy({ minimumReserveByRating: { 89: 2 } }),
  });
  assert.deepEqual(compareFodderReviewFingerprints(one, two).changed, ["policy"]);

  const unrestricted = buildFodderReviewFingerprints({
    ...base,
    policy: new FodderPolicy({}),
  });
  const noSpecialsAllowed = buildFodderReviewFingerprints({
    ...base,
    policy: new FodderPolicy({ allowedSpecialTypes: [] }),
  });
  assert.deepEqual(
    compareFodderReviewFingerprints(unrestricted, noSpecialsAllowed).changed,
    ["policy"],
  );
});

test("missing source provenance is explicit and suppresses not-protected claims", () => {
  const review = buildFodderReview({
    gameContext: context,
    inventorySnapshot: { generation: 1, items: [item("a", 84)] },
    policy: new FodderPolicy({
      protectStartingSquad: true,
      specialReserveByCardType: { totw: 1 },
    }),
    capabilitySnapshot,
    sourceEvidence: {},
  });
  assert.equal(review.preview.verificationState, "unverified");
  assert.equal(review.preview.notHardProtectedCount, null);
  assert.ok(review.preview.warnings.some((warning) => /UNVERIFIED/.test(warning)));
  assert.equal(review.preview.softConservation.specialReserves[0].observedCount, null);
  assert.equal(review.steps.length, 0);
});

test("input bounds block without analyzing or truncating a partial review", () => {
  const review = buildFodderReview({
    gameContext: context,
    inventorySnapshot: {
      generation: 1,
      items: [item("a", 84), item("b", 85), item("c", 86)],
    },
    policy: new FodderPolicy({}),
    capabilitySnapshot,
    sourceEvidence: verifiedSourceEvidence,
    limits: { maxItems: 2, maxActiveProjects: 100, maxExamplesPerReason: 5 },
  });
  assert.deepEqual(review.blockers.map((blocker) => blocker.code), ["REVIEW_INPUT_TOO_LARGE"]);
  assert.equal(review.preview.observedItemCount, 3);
  assert.equal(review.preview.analyzedItemCount, 0);
  assert.deepEqual(review.preview.reasonGroups, []);
  assert.deepEqual(review.steps, []);
});

test("strategy accepts only OPTIMIZE_FODDER and always returns a read-only draft", async () => {
  let reads = 0;
  const strategy = createFodderReviewStrategy({
    readEvidence: async () => {
      reads += 1;
      return {
        inventorySnapshot: { generation: 1, items: [item("a", 84)] },
        policy: new FodderPolicy({}),
        targetProjects: [],
        capabilitySnapshot,
        sourceEvidence: verifiedSourceEvidence,
      };
    },
  });
  assert.deepEqual(strategy.requiredCapabilities, FODDER_REVIEW_CAPABILITIES);
  const draft = await strategy({
    goal: { kind: GoalKind.OPTIMIZE_FODDER },
    gameContext: context,
  });
  assert.equal(reads, 1);
  assert.deepEqual(draft.steps, []);
  assert.equal(draft.preview.canApprove, false);
  await assert.rejects(
    strategy({ goal: { kind: GoalKind.COMPLETE_SBC }, gameContext: context }),
    /OPTIMIZE_FODDER/,
  );
  assert.equal(reads, 1);
});
