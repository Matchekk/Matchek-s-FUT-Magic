import { WorkflowStepType } from "./constants.js";
import { normalizeWorkflowDefinition } from "./definitions.js";

const clone = (value) => structuredClone(value);
const newId = (type) =>
  `${String(type).toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const createWorkflowStep = (type = WorkflowStepType.SOLVE_SBC) => {
  const normalized = String(type).toUpperCase();
  const config =
    normalized === WorkflowStepType.LOOP
      ? { maxIterations: 1, body: [createWorkflowStep()] }
      : normalized === WorkflowStepType.CONDITIONAL
        ? {
            condition: {
              type: "COMPARE",
              left: { type: "PATH", path: "unresolvedUnassigned" },
              operator: "EQ",
              right: { type: "LITERAL", value: 0 },
            },
            thenSteps: [createWorkflowStep()],
            elseSteps: [{ id: newId("pause"), type: WorkflowStepType.PAUSE, config: { reason: "Condition was not satisfied" } }],
          }
        : normalized === WorkflowStepType.DELAY
          ? { durationMs: 1000 }
          : normalized === WorkflowStepType.PAUSE
            ? { reason: "Paused by workflow" }
            : normalized === WorkflowStepType.SOLVE_SBC
              ? { target: { kind: "CURRENT_OPEN_SBC" } }
              : {};
  return { id: newId(normalized), type: normalized, config, timeoutMs: 120000, retryPolicy: { maxAttempts: 1, delayMs: 500, backoffFactor: 2, maxDelayMs: 30000, retryableCodes: [] }, onFailure: "PAUSE" };
};

const getArray = (workflow, path = []) => {
  let steps = workflow.steps;
  for (const segment of path) {
    const step = steps[segment.index];
    if (!step) throw new TypeError("Workflow builder path is stale");
    steps = step.config?.[segment.branch];
    if (!Array.isArray(steps)) throw new TypeError("Workflow builder branch is invalid");
  }
  return steps;
};

export const mutateWorkflowSteps = (workflow, path, mutation) => {
  const next = clone(workflow);
  const steps = getArray(next, path);
  mutation(steps);
  return next;
};

export const addWorkflowStep = (workflow, path = [], type) =>
  mutateWorkflowSteps(workflow, path, (steps) => steps.push(createWorkflowStep(type)));

export const deleteWorkflowStep = (workflow, path, index) =>
  mutateWorkflowSteps(workflow, path, (steps) => steps.splice(index, 1));

export const moveWorkflowStep = (workflow, path, index, direction) =>
  mutateWorkflowSteps(workflow, path, (steps) => {
    const target = index + (direction < 0 ? -1 : 1);
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
  });

export const duplicateWorkflowStep = (workflow, path, index) =>
  mutateWorkflowSteps(workflow, path, (steps) => {
    const copy = clone(steps[index]);
    const renew = (entry) => {
      entry.id = newId(entry.type);
      for (const branch of ["body", "thenSteps", "elseSteps"]) {
        for (const child of entry.config?.[branch] || []) renew(child);
      }
    };
    renew(copy);
    steps.splice(index + 1, 0, copy);
  });

export const finalizeWorkflowDraft = (workflow) => normalizeWorkflowDefinition(workflow);
