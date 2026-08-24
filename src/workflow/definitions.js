import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_LOOP_ITERATIONS,
  MAX_RETRY_ATTEMPTS,
  MAX_STEP_TIMEOUT_MS,
  MAX_WORKFLOW_DEPTH,
  MAX_WORKFLOW_STEPS,
  ON_FAILURE_VALUES,
  OnFailure,
  StepStatus,
  WORKFLOW_SCHEMA_VERSION,
  WORKFLOW_STEP_TYPES,
  WorkflowStepType,
} from "./constants.js";
import { validateCondition } from "./conditions.js";
import { WorkflowValidationError } from "./errors.js";
import {
  assertSerializable,
  cloneSerializable,
  fnv1aHash,
  isPlainObject,
  stableStringify,
} from "./serialization.js";

const normalizeText = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const clampInteger = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
};

const normalizeRetryPolicy = (value) => {
  const raw = isPlainObject(value) ? value : {};
  const retryableCodes = Array.isArray(raw.retryableCodes)
    ? Array.from(
        new Set(raw.retryableCodes.map(normalizeText).filter(Boolean)),
      ).slice(0, 50)
    : [];
  return {
    maxAttempts: clampInteger(
      raw.maxAttempts,
      1,
      MAX_RETRY_ATTEMPTS,
      DEFAULT_RETRY_POLICY.maxAttempts,
    ),
    delayMs: clampInteger(
      raw.delayMs,
      0,
      5 * 60_000,
      DEFAULT_RETRY_POLICY.delayMs,
    ),
    backoffFactor: Math.max(
      1,
      Math.min(
        10,
        Number.isFinite(Number(raw.backoffFactor))
          ? Number(raw.backoffFactor)
          : DEFAULT_RETRY_POLICY.backoffFactor,
      ),
    ),
    maxDelayMs: clampInteger(
      raw.maxDelayMs,
      0,
      30 * 60_000,
      DEFAULT_RETRY_POLICY.maxDelayMs,
    ),
    retryableCodes,
  };
};

const normalizeNestedSteps = (value, context, path) => {
  if (!Array.isArray(value)) return [];
  return value.map((step, index) =>
    normalizeStep(step, context, `${path}[${index}]`, context.depth + 1),
  );
};

const normalizeStepConfig = (type, value, context, path) => {
  const raw = isPlainObject(value) ? cloneSerializable(value) : {};
  if (type === WorkflowStepType.CONDITIONAL) {
    const conditionResult = validateCondition(raw.condition);
    if (!conditionResult.ok) {
      for (const issue of conditionResult.issues) {
        context.issues.push({
          ...issue,
          path: `${path}.condition.${issue.path.replace(/^condition\.?/, "")}`.replace(/\.$/, ""),
        });
      }
    }
    return {
      condition: raw.condition ?? null,
      thenSteps: normalizeNestedSteps(
        raw.thenSteps ?? raw.whenTrue,
        { ...context, depth: context.depth + 1 },
        `${path}.thenSteps`,
      ),
      elseSteps: normalizeNestedSteps(
        raw.elseSteps ?? raw.whenFalse,
        { ...context, depth: context.depth + 1 },
        `${path}.elseSteps`,
      ),
    };
  }
  if (type === WorkflowStepType.LOOP) {
    const body = normalizeNestedSteps(
      raw.body ?? raw.steps,
      { ...context, depth: context.depth + 1 },
      `${path}.body`,
    );
    if (!body.length) {
      context.issues.push({
        path: `${path}.body`,
        code: "LOOP_BODY_REQUIRED",
        message: "LOOP requires at least one body step.",
      });
    }
    const conditionResult = raw.condition == null ? null : validateCondition(raw.condition);
    if (conditionResult && !conditionResult.ok) {
      for (const issue of conditionResult.issues) {
        context.issues.push({
          ...issue,
          path: `${path}.condition.${issue.path.replace(/^condition\.?/, "")}`.replace(/\.$/, ""),
        });
      }
    }
    return {
      body,
      maxIterations: clampInteger(
        raw.maxIterations ?? raw.iterations ?? raw.times,
        1,
        MAX_LOOP_ITERATIONS,
        1,
      ),
      condition: raw.condition ?? null,
    };
  }
  if (type === WorkflowStepType.DELAY) {
    return {
      ...raw,
      durationMs: clampInteger(
        raw.durationMs ?? raw.delayMs,
        0,
        24 * 60 * 60_000,
        0,
      ),
    };
  }
  if (type === WorkflowStepType.PAUSE) {
    return {
      ...raw,
      reason: normalizeText(raw.reason) ?? "Workflow pause step reached.",
    };
  }
  return raw;
};

function normalizeStep(value, context, path, depth = 0) {
  if (depth > MAX_WORKFLOW_DEPTH) {
    context.issues.push({
      path,
      code: "WORKFLOW_TOO_DEEP",
      message: `Workflow nesting may not exceed ${MAX_WORKFLOW_DEPTH} levels.`,
    });
  }
  if (!isPlainObject(value)) {
    context.issues.push({
      path,
      code: "STEP_INVALID",
      message: "Workflow step must be an object.",
    });
    value = {};
  }
  context.stepCount.count += 1;
  if (context.stepCount.count > MAX_WORKFLOW_STEPS) {
    context.issues.push({
      path,
      code: "WORKFLOW_STEP_LIMIT",
      message: `Workflow may contain at most ${MAX_WORKFLOW_STEPS} steps.`,
    });
  }

  const id = normalizeText(value.id);
  if (!id) {
    context.issues.push({ path: `${path}.id`, code: "STEP_ID_REQUIRED", message: "Step id is required." });
  } else if (id.length > 128) {
    context.issues.push({ path: `${path}.id`, code: "STEP_ID_INVALID", message: "Step id is too long." });
  } else if (context.ids.has(id)) {
    context.issues.push({ path: `${path}.id`, code: "STEP_ID_DUPLICATE", message: `Duplicate step id: ${id}.` });
  } else {
    context.ids.add(id);
  }

  const type = String(value.type ?? "").trim().toUpperCase();
  if (!WORKFLOW_STEP_TYPES.includes(type)) {
    context.issues.push({
      path: `${path}.type`,
      code: "STEP_TYPE_INVALID",
      message: `Unsupported workflow step type: ${type || "<empty>"}.`,
    });
  }
  const timeoutMs = clampInteger(
    value.timeoutMs ?? value.timeout,
    100,
    MAX_STEP_TIMEOUT_MS,
    DEFAULT_STEP_TIMEOUT_MS,
  );
  const onFailureRaw = String(value.onFailure ?? OnFailure.PAUSE)
    .trim()
    .toUpperCase();
  const onFailure = ON_FAILURE_VALUES.includes(onFailureRaw)
    ? onFailureRaw
    : OnFailure.PAUSE;
  if (!ON_FAILURE_VALUES.includes(onFailureRaw)) {
    context.issues.push({
      path: `${path}.onFailure`,
      code: "STEP_ON_FAILURE_INVALID",
      message: `Unsupported onFailure behavior: ${onFailureRaw || "<empty>"}.`,
    });
  }

  const nestedContext = { ...context, depth };
  return {
    id: id ?? `invalid-step-${context.stepCount.count}`,
    type,
    config: normalizeStepConfig(type, value.config, nestedContext, `${path}.config`),
    status: StepStatus.PENDING,
    retryPolicy: normalizeRetryPolicy(value.retryPolicy),
    timeoutMs,
    onFailure,
  };
}

export const validateWorkflowDefinition = (value) => {
  const issues = [];
  const raw = isPlainObject(value) ? value : {};
  if (!isPlainObject(value)) {
    issues.push({ path: "workflow", code: "WORKFLOW_INVALID", message: "Workflow must be an object." });
  }
  const id = normalizeText(raw.id);
  if (!id) issues.push({ path: "workflow.id", code: "WORKFLOW_ID_REQUIRED", message: "Workflow id is required." });
  const name = normalizeText(raw.name);
  if (!name) issues.push({ path: "workflow.name", code: "WORKFLOW_NAME_REQUIRED", message: "Workflow name is required." });
  if (!Array.isArray(raw.steps) || !raw.steps.length) {
    issues.push({ path: "workflow.steps", code: "WORKFLOW_STEPS_REQUIRED", message: "Workflow requires at least one step." });
  }
  const context = {
    ids: new Set(),
    issues,
    stepCount: { count: 0 },
    depth: 0,
  };
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, index) => normalizeStep(step, context, `workflow.steps[${index}]`, 0))
    : [];
  const normalized = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: id ?? "invalid-workflow",
    name: name ?? "Invalid Workflow",
    description: normalizeText(raw.description),
    version: clampInteger(raw.version, 1, Number.MAX_SAFE_INTEGER, 1),
    steps,
    metadata: isPlainObject(raw.metadata) ? cloneSerializable(raw.metadata) : {},
  };
  try {
    assertSerializable(normalized, "Workflow definition");
  } catch (error) {
    issues.push({
      path: "workflow",
      code: error?.code ?? "WORKFLOW_NOT_SERIALIZABLE",
      message: error?.message ?? "Workflow is not serializable.",
    });
  }
  return { ok: issues.length === 0, issues, value: normalized };
};

export const normalizeWorkflowDefinition = (value) => {
  const result = validateWorkflowDefinition(value);
  if (!result.ok) throw new WorkflowValidationError(result.issues);
  return result.value;
};

export const hashWorkflowDefinition = (value) => {
  const normalized = normalizeWorkflowDefinition(value);
  return `wf-${fnv1aHash(stableStringify(normalized))}`;
};

export const createAutoApproval = (workflow) => {
  const normalized = normalizeWorkflowDefinition(workflow);
  return {
    confirmed: true,
    workflowId: normalized.id,
    workflowVersion: normalized.version,
    workflowHash: hashWorkflowDefinition(normalized),
  };
};

