import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exportRunAnalytics, summarizeRunAnalytics } from "../src/analytics/run-analytics.js";
import { TargetProjectService } from "../src/policies/target-project-service.js";
import {
  addWorkflowStep,
  deleteWorkflowStep,
  duplicateWorkflowStep,
  finalizeWorkflowDraft,
  getWorkflowTemplate,
  importLegacySequence,
  listWorkflowTemplates,
  moveWorkflowStep,
} from "../src/workflow/index.js";

test("browser manifest exposes every production solver module imported by GrindPilot", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
  );
  const resources = manifest.web_accessible_resources.flatMap(
    (entry) => entry.resources || [],
  );
  assert.ok(
    manifest.web_accessible_resources.every(
      (entry) => entry.use_dynamic_url !== true,
    ),
  );
  assert.ok(!resources.some((resource) => resource.startsWith("src/")));
  assert.ok(!resources.some((resource) => resource.startsWith("solver/")));
  assert.ok(
    manifest.host_permissions.includes(
      "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*",
    ),
  );
  assert.ok(
    manifest.host_permissions.includes(
      "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*",
    ),
  );
  assert.ok(
    manifest.content_scripts[0].js.includes(
      "src/generated/grindpilot-content-bundle.js",
    ),
  );
});

test("all five production templates use typed stable targets", () => {
  const templates = listWorkflowTemplates();
  assert.deepEqual(
    templates.map((entry) => entry.id).sort(),
    ["DAILY_UPGRADE_CHAIN", "PLAYER_PICK_GRIND", "REWARD_PACK_LOOP", "SIMPLE_REPEATABLE_SBC", "TARGET_SBC_GRIND"],
  );
  for (const { id } of templates) {
    const workflow = getWorkflowTemplate(id);
    const serialized = JSON.stringify(workflow);
    assert.match(serialized, /CURRENT_OPEN_SBC/);
    assert.doesNotMatch(serialized, /javascript:|eval\s*\(/i);
  }
});

test("workflow builder adds, orders, duplicates, nests, deletes, and validates", () => {
  let workflow = getWorkflowTemplate("SIMPLE_REPEATABLE_SBC");
  workflow = addWorkflowStep(workflow, [], "CONDITIONAL");
  const conditionalIndex = workflow.steps.length - 1;
  workflow = addWorkflowStep(
    workflow,
    [{ index: conditionalIndex, branch: "thenSteps" }],
    "DELAY",
  );
  const beforeDuplicate = workflow.steps.length;
  workflow = duplicateWorkflowStep(workflow, [], conditionalIndex);
  assert.equal(workflow.steps.length, beforeDuplicate + 1);
  assert.notEqual(workflow.steps[conditionalIndex].id, workflow.steps[conditionalIndex + 1].id);
  workflow = moveWorkflowStep(workflow, [], conditionalIndex + 1, -1);
  workflow = deleteWorkflowStep(workflow, [], conditionalIndex + 1);
  const finalized = finalizeWorkflowDraft(workflow);
  assert.equal(finalized.steps.some((step) => step.type === "CONDITIONAL"), true);
});

test("legacy Sequence import preserves stable set IDs and bounded loops", () => {
  const workflow = importLegacySequence({
    id: "legacy-a",
    name: "Daily",
    policy: { planLoopCount: 2 },
    steps: [{ setId: 12345, loopCount: 3, settingsSnapshot: { maxRating: 88 } }],
  });
  const serialized = JSON.stringify(workflow);
  assert.match(serialized, /"setId":"12345"/);
  assert.match(serialized, /"maxIterations":3/);
  assert.match(serialized, /"maxIterations":2/);
});

test("legacy Sequence import preserves a standalone stable challenge ID", () => {
  const workflow = importLegacySequence({
    id: "legacy-challenge",
    name: "One challenge",
    steps: [{ kind: "challenge", challengeId: 9876 }],
  });
  assert.equal(workflow.steps[0].config.target.kind, "SPECIFIC_CHALLENGE");
  assert.equal(workflow.steps[0].config.target.challengeId, "9876");
});

test("Target Project import aggregates verified requirements and synchronizes completion", () => {
  const service = new TargetProjectService();
  const snapshot = {
    setId: "set-1",
    setName: "Target SBC",
    challenges: [
      { id: "a", name: "86 Squad", completed: false, requiredSquadRating: 86, specialCardRequirements: [{ cardType: "totw", count: 1 }], unknownRequirements: [] },
      { id: "b", name: "87 Squad", completed: true, requiredSquadRating: 87, specialCardRequirements: [], unknownRequirements: ["chemistry"] },
    ],
  };
  const project = service.importCurrentSbc(snapshot);
  assert.equal(project.requiredSquadsRemaining, 1);
  assert.equal(project.ratingRequirements.find((entry) => entry.rating === 87).completed, 1);
  assert.equal(project.specialCardRequirements[0].cardType, "totw");
  const updated = service.markVerifiedChallengeCompleted({ setId: "set-1", challengeId: "a" });
  assert.equal(updated.completionProgress, 1);
  assert.equal(updated.requiredSquadsRemaining, 0);
  assert.equal(service.getDashboard([]).length, 0, "completed projects leave the active dashboard");
});

test("run analytics is allowlisted and computes rating flow", () => {
  const run = {
    runId: "run-1",
    status: "completed",
    mode: "AUTO",
    startedAt: 100,
    completedAt: 600,
    counters: { loopIterations: 1 },
    history: [{ type: "RUN_PAUSED" }],
    nodes: [
      { step: { type: "SOLVE_SBC" }, status: "completed", result: { protectedItemIds: ["p"], selectedItems: [{ itemId: "secret-owned-id", rating: 86 }] } },
      { step: { type: "SUBMIT_SBC" }, status: "completed", result: {} },
      { step: { type: "OPEN_REWARD_PACK" }, status: "completed", result: { receivedItems: [{ itemId: "new-id", rating: 88 }] } },
      { step: { type: "RESOLVE_ITEMS" }, status: "completed", result: { movedToClub: ["x"], movedToStorage: ["y"] } },
    ],
    accessToken: "must-not-export",
  };
  const analytics = summarizeRunAnalytics(run);
  assert.equal(analytics.durationMs, 500);
  assert.equal(analytics.ratingFlow.consumed.ratingPoints, 86);
  assert.equal(analytics.ratingFlow.received.ratingPoints, 88);
  assert.equal(analytics.pauses, 1);
  const json = exportRunAnalytics(run);
  assert.doesNotMatch(json, /must-not-export|secret-owned-id|new-id/);
});
