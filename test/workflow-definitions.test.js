import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkflowStepType,
  WorkflowValidationError,
  createAutoApproval,
  hashWorkflowDefinition,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from "../src/workflow/index.js";

const solveStep = (id = "solve") => ({
  id,
  type: WorkflowStepType.SOLVE_SBC,
  config: { setId: 123 },
});

test("normalizes typed steps, timeouts, retry policy and failure behavior", () => {
  const workflow = normalizeWorkflowDefinition({
    id: "daily-upgrade",
    name: "Daily Upgrade",
    version: 3,
    steps: [
      {
        ...solveStep(),
        timeout: 5_000,
        retryPolicy: {
          maxAttempts: 3,
          delayMs: 200,
          backoffFactor: 3,
          maxDelayMs: 2_000,
          retryableCodes: ["TEMPORARY", "TEMPORARY"],
        },
        onFailure: "skip",
      },
    ],
  });

  assert.equal(workflow.schemaVersion, 1);
  assert.equal(workflow.steps[0].status, "pending");
  assert.equal(workflow.steps[0].timeoutMs, 5_000);
  assert.equal(workflow.steps[0].retryPolicy.maxAttempts, 3);
  assert.deepEqual(workflow.steps[0].retryPolicy.retryableCodes, ["TEMPORARY"]);
  assert.equal(workflow.steps[0].onFailure, "SKIP");
});

test("validates nested conditions, loop bounds and globally unique step ids", () => {
  const result = validateWorkflowDefinition({
    id: "invalid",
    name: "Invalid",
    steps: [
      solveStep("duplicate"),
      {
        id: "branch",
        type: "CONDITIONAL",
        config: {
          condition: {
            type: "COMPARE",
            left: { type: "PATH", path: "metrics.count" },
            operator: "GTE",
            right: { type: "LITERAL", value: 1 },
          },
          thenSteps: [solveStep("duplicate")],
        },
      },
      { id: "empty-loop", type: "LOOP", config: { body: [] } },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "STEP_ID_DUPLICATE"));
  assert.ok(result.issues.some((issue) => issue.code === "LOOP_BODY_REQUIRED"));
  assert.throws(
    () => normalizeWorkflowDefinition({ id: "x", name: "X", steps: [] }),
    WorkflowValidationError,
  );
});

test("workflow hashes and AUTO approvals are deterministic and version-bound", () => {
  const workflow = {
    id: "auto-grind",
    name: "Auto Grind",
    version: 2,
    steps: [solveStep()],
  };
  const hash = hashWorkflowDefinition(workflow);
  const approval = createAutoApproval(workflow);
  assert.equal(hashWorkflowDefinition(workflow), hash);
  assert.deepEqual(approval, {
    confirmed: true,
    workflowId: "auto-grind",
    workflowVersion: 2,
    workflowHash: hash,
  });
  assert.notEqual(
    hashWorkflowDefinition({ ...workflow, version: 3 }),
    approval.workflowHash,
  );
});

