import test from "node:test";
import assert from "node:assert/strict";

import { buildWorkflow } from "../src/grindpilot-main.js";
import { PageWorkflowRepository } from "../src/ea/workflow-storage-repository.js";
import {
  createAutoApproval,
  MemoryWorkflowRepository,
  WorkflowEngine,
  WorkflowStepType,
} from "../src/workflow/index.js";

test("MVP workflow performs the verified reward loop exactly N times", async () => {
  const workflow = buildWorkflow({ maxIterations: 2 });
  const calls = [];
  const handlers = Object.fromEntries(
    [
      WorkflowStepType.SOLVE_SBC,
      WorkflowStepType.SUBMIT_SBC,
      WorkflowStepType.CLAIM_REWARD,
      WorkflowStepType.OPEN_REWARD_PACK,
      WorkflowStepType.HANDLE_PLAYER_PICK,
      WorkflowStepType.RESOLVE_ITEMS,
    ].map((type) => [type, async () => {
      calls.push(type);
      return { status: "completed", result: { verified: true } };
    }]),
  );
  const engine = new WorkflowEngine({
    repository: new MemoryWorkflowRepository(),
    handlers,
    idFactory: (prefix) => `${prefix}-mvp`,
  });
  await engine.start(workflow, {
    mode: "AUTO",
    approval: createAutoApproval(workflow),
  });
  const result = await engine.runUntilBlocked();
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    WorkflowStepType.SOLVE_SBC, WorkflowStepType.SUBMIT_SBC,
    WorkflowStepType.CLAIM_REWARD, WorkflowStepType.OPEN_REWARD_PACK,
    WorkflowStepType.HANDLE_PLAYER_PICK, WorkflowStepType.RESOLVE_ITEMS,
    WorkflowStepType.SOLVE_SBC, WorkflowStepType.SUBMIT_SBC,
    WorkflowStepType.CLAIM_REWARD, WorkflowStepType.OPEN_REWARD_PACK,
    WorkflowStepType.HANDLE_PLAYER_PICK, WorkflowStepType.RESOLVE_ITEMS,
  ]);
});

test("page workflow repository rejects stale persisted revisions", async () => {
  const values = new Map();
  const storage = {
    async get(key) { return { [key]: structuredClone(values.get(key) ?? null) }; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
  };
  const repository = new PageWorkflowRepository(storage);
  await repository.createRun({ runId: "run-1", revision: 0, status: "running" });
  await assert.rejects(
    repository.saveRun({ runId: "run-1", revision: 2, status: "running" }, { expectedRevision: 1 }),
    (error) => error.code === "WORKFLOW_REVISION_CONFLICT",
  );
  assert.equal((await repository.loadActiveRun()).revision, 0);
});

