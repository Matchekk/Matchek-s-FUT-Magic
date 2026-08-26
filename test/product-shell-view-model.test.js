import assert from "node:assert/strict";
import test from "node:test";

import { buildProductShellViewModel } from "../src/presentation/product-shell-view-model.js";

const state = () => ({
  bridgeHealth: "healthy",
  productRevision: 7,
  gameVersion: "fc26",
  gameVersionObservation: "observed",
  gameVersionSource: "test_fixture",
  inventoryAvailable: true,
  inventory: { clubCount: 12, storageCount: 3, storageCapacity: 100, storageFreeSlots: 97, unassignedCount: 2, duplicateGroupCount: 1 },
  inventoryBuckets: { "87": { club: 2, storage: 1 }, "90": { club: 1, storage: 0 } },
  currentContext: { setId: "set-1", setName: "Target", challengeId: "challenge-1", challengeName: "87 Squad" },
  contextObservedAt: 100,
  projects: [{ id: "p1", completionProgress: 0.25 }],
  targetDashboard: [{ id: "p1", name: "Target", completedSquads: 1, totalSquads: 4, requiredSquadsRemaining: 3, remainingRatings: [{ rating: 87, remaining: 2, clubCount: 3 }], remainingSpecials: [], protectedRatings: {}, sourceSetId: "set-1" }],
  timeline: [],
  runStatus: "idle",
});

test("product shell view model is bounded, serializable and honest about project stock", () => {
  const model = buildProductShellViewModel(state(), { now: 200 });
  assert.equal(model.brand.name, "FUT Magic");
  assert.equal(model.brand.plan, "free");
  assert.equal(model.context.challengeName, "87 Squad");
  assert.deepEqual(model.projects[0].remainingRatings[0], { rating: 87, needed: 2, exactRatingInClub: 3 });
  assert.equal(model.projects[0].progress, 0.25);
  assert.equal(model.notice.title, "2 items need attention");
  assert.equal(model.connection.label, "EA connected");
  assert.equal(model.compatibility, null);
  assert.doesNotThrow(() => JSON.stringify(model));
  assert.equal(JSON.stringify(model).includes("controller"), false);
});

test("explicit FC27 stays unverified and observe-only even when a caller claims verified", () => {
  const input = state();
  input.gameContext = {
    gameVersion: "fc27",
    state: "verified",
    challengeId: "fc27-challenge",
    challengeName: "Streamlined challenge",
    observedAt: 150,
  };

  const model = buildProductShellViewModel(input, { now: 200 });

  assert.deepEqual(model.compatibility, {
    gameVersion: "fc27",
    versionState: "observed",
    contextState: "unverified",
    planningState: "observe_only",
    gameLabel: "FC 27",
    title: "FC 27 detected",
    message: "The game version is observed. FC 27 planning rules are not verified in this build, so FUT Magic won’t run a plan.",
  });
  assert.equal(model.context.state, "unverified");
  assert.equal(model.context.challengeName, "Streamlined challenge");
  for (const id of ["complete-sbc", "grind-upgrades", "clear-duplicates", "protect-cards"]) {
    const action = model.actions.find((entry) => entry.id === id);
    assert.equal(action.enabled, false);
    assert.equal(action.command, null);
    assert.equal(action.disabledReason, "FC 27 planning is not verified in this build");
  }
  assert.match(
    model.actions.find((entry) => entry.id === "plan-evolution").disabledReason,
    /live Evolution data is not available/i,
  );
});

test("explicit unknown game version remains distinct and keeps planning off", () => {
  const input = state();
  input.gameContext = {
    gameVersion: "unknown",
    state: "unverified",
    observedAt: 175,
  };

  const model = buildProductShellViewModel(input, { now: 200 });

  assert.deepEqual(model.compatibility, {
    gameVersion: "unknown",
    versionState: "unknown",
    contextState: "unverified",
    planningState: "unavailable",
    gameLabel: "Unknown",
    title: "Game version not confirmed",
    message: "FUT Magic can’t verify which game version is open, so planning stays off.",
  });
  assert.equal(model.context.gameVersion, "unknown");
  assert.equal(model.context.observedAt, 175);
  for (const id of ["complete-sbc", "grind-upgrades", "clear-duplicates", "protect-cards"]) {
    const action = model.actions.find((entry) => entry.id === id);
    assert.equal(action.enabled, false);
    assert.equal(action.command, null);
    assert.equal(action.disabledReason, "Confirm the game version before planning");
  }
});

test("active run maps workflow internals to human status without exposing nodes", () => {
  const input = state();
  input.runStatus = "paused";
  input.runName = "85x10 Grind";
  input.runModeLabel = "Ask before each action";
  input.iterations = 4;
  input.maxIterations = 10;
  input.pauseReason = "A player pick has no unique safe choice";
  input.timeline = [
    { type: "SOLVE_SBC", status: "completed", active: false },
    { type: "HANDLE_PLAYER_PICK", status: "paused", active: true },
    { type: "RESOLVE_ITEMS", status: "pending", active: false },
  ];
  const run = buildProductShellViewModel(input).run;
  assert.equal(run.title, "85x10 Grind");
  assert.equal(run.currentStep.label, "Choose player");
  assert.equal(run.nextStep.label, "Route items");
  assert.equal(run.guard.state, "caution");
  assert.equal(run.canResume, true);
  assert.equal(Object.hasOwn(run, "nodes"), false);
});

test("future Pro goals are visible without pretending they are implemented", () => {
  const model = buildProductShellViewModel(state());
  const protection = model.actions.find((action) => action.id === "protect-cards");
  assert.equal(protection.label, "Protect my cards");
  assert.deepEqual(protection.command, { type: "PREVIEW_FODDER_REVIEW" });
  assert.equal(model.actions.some((action) => /optimize my fodder/i.test(action.label)), false);
  const evolution = model.actions.find((action) => action.id === "plan-evolution");
  assert.equal(evolution.plan, "pro");
  assert.equal(evolution.enabled, false);
  assert.equal(evolution.command, null);
  assert.equal(evolution.disabledReason, "Live Evolution data is not available in this build");
  for (const action of model.actions.filter((entry) => entry.plan === "pro")) {
    assert.equal(action.enabled, false);
    assert.equal(action.command, null);
    assert.doesNotMatch(`${action.label} ${action.description} ${action.disabledReason}`, /sign in|upgrade|purchase|subscribe|unlock|manage account/i);
  }
  assert.equal(model.legal.licenseUrl, "../LICENSE");
  assert.equal(model.legal.privacyUrl, "../PRIVACY.md");
  assert.equal(model.legal.noticesUrl, "../THIRD_PARTY_NOTICES.md");
  assert.match(model.legal.warranty, /no warranty/i);
});

test("protection review exposes human summaries without policy or owned-card identifiers", () => {
  const input = state();
  input.draft = { protectedItemIds: ["owned-secret"], minimumReserveByRating: { 89: 2 } };
  input.fodderReviewPlan = {
    id: "internal-plan-id",
    state: "ready",
    createdAt: 10,
    blockers: [],
    preview: {
      verificationState: "unverified",
      uniqueHardProtectedCount: 2,
      analyzedItemCount: 12,
      reasonGroups: [{
        code: "protected-item",
        itemCount: 1,
        examples: [{ itemId: "owned-secret", resourceId: "resource-secret", name: "Example", rating: 90, location: "club" }],
      }],
      softConservation: {
        ratingReserves: [{ rating: 89, reserved: 2, observedCount: 3 }],
        specialReserves: [],
        preferences: { preferDuplicates: true, preferSbcStorage: true, preferUntradeables: false },
      },
      projectSignals: [{
        id: "project-secret",
        name: "Current SBC",
        hardExclusions: ["90+ cards"],
        conservationPreferences: ["Try to keep 2 × 89"],
        unknownRequirementCount: 0,
      }],
      warnings: ["Some evidence is unavailable."],
    },
  };

  const model = buildProductShellViewModel(input);
  assert.equal(model.protection.status, "unverified");
  assert.equal(model.protection.reasonGroups[0].label, "Specific cards");
  assert.equal(model.protection.ratingReserves[0].minimum, 2);
  assert.equal(model.protection.advancedActive, true);
  const serialized = JSON.stringify(model.protection);
  assert.doesNotMatch(serialized, /owned-secret|resource-secret|project-secret|protected-item/);
});

test("SBC approval view fails closed unless protected-card evidence is explicit", () => {
  const input = state();
  input.sbcPlanPreviews = {
    p1: {
      id: "plan-1",
      state: "ready",
      createdAt: 1,
      blockers: [],
      explanation: [],
      preview: { status: "ready", selectedCount: 11, cards: [] },
    },
  };
  assert.equal(buildProductShellViewModel(input).projects[0].preview.canApprove, false);
  input.sbcPlanPreviews.p1.preview.selectedProtectedCount = 0;
  assert.equal(buildProductShellViewModel(input).projects[0].preview.canApprove, true);
});

test("duplicate approval never covers cards omitted from the public preview", () => {
  const input = state();
  const cards = Array.from({ length: 25 }, (_, index) => ({
    itemId: `internal-${index}`,
    name: `Player ${index + 1}`,
    rating: 80,
    action: "SEND_TO_CLUB",
    destination: "club",
    reason: "Unique card can move to Club",
  }));
  input.duplicateRoutePlan = {
    id: "route-25",
    state: "ready",
    blockers: [],
    explanation: [],
    preview: {
      status: "ready",
      safetyBoundary: "SAFE_ITEM_MOVES_ONLY",
      totalCount: 25,
      safeCount: 25,
      cards,
    },
  };

  const route = buildProductShellViewModel(input).duplicateRoute;
  assert.equal(route.cards.length, 25);
  assert.equal(route.canApprove, true);
  assert.equal(JSON.stringify(route).includes("internal-"), false);

  input.duplicateRoutePlan.preview.totalCount = 26;
  assert.equal(buildProductShellViewModel(input).duplicateRoute.canApprove, false);
});
