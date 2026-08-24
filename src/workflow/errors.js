export class WorkflowError extends Error {
  constructor(message, { code = "WORKFLOW_ERROR", details = null } = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
}

export class WorkflowValidationError extends WorkflowError {
  constructor(issues) {
    const list = Array.isArray(issues) ? issues : [];
    super(
      list.length
        ? `Workflow validation failed: ${list[0].message}`
        : "Workflow validation failed",
      { code: "WORKFLOW_VALIDATION_FAILED", details: { issues: list } },
    );
    this.name = "WorkflowValidationError";
    this.issues = list;
  }
}

export class WorkflowPersistenceError extends WorkflowError {
  constructor(message, details = null) {
    super(message, { code: "WORKFLOW_PERSISTENCE_FAILED", details });
    this.name = "WorkflowPersistenceError";
  }
}

export class WorkflowConflictError extends WorkflowError {
  constructor(message = "Workflow revision conflict", details = null) {
    super(message, { code: "WORKFLOW_REVISION_CONFLICT", details });
    this.name = "WorkflowConflictError";
  }
}

export class WorkflowTimeoutError extends WorkflowError {
  constructor(timeoutMs) {
    super(`Workflow step timed out after ${timeoutMs} ms`, {
      code: "STEP_TIMEOUT",
      details: { timeoutMs },
    });
    this.name = "WorkflowTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

