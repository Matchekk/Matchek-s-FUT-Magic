import { WorkflowConflictError, WorkflowPersistenceError } from "./errors.js";
import { assertSerializable, cloneSerializable } from "./serialization.js";

/**
 * Minimal repository contract used by WorkflowEngine.
 * Production adapters can back these methods with chrome.storage.local.
 */
export class WorkflowRepository {
  async createRun(_run) {
    throw new WorkflowPersistenceError("createRun is not implemented");
  }

  async saveRun(_run, _options = {}) {
    throw new WorkflowPersistenceError("saveRun is not implemented");
  }

  async loadRun(_runId) {
    throw new WorkflowPersistenceError("loadRun is not implemented");
  }

  async loadActiveRun() {
    throw new WorkflowPersistenceError("loadActiveRun is not implemented");
  }

  async clearActiveRun(_runId) {}
}

export class MemoryWorkflowRepository extends WorkflowRepository {
  constructor(seedRuns = []) {
    super();
    this.runs = new Map();
    this.activeRunId = null;
    for (const run of Array.isArray(seedRuns) ? seedRuns : []) {
      assertSerializable(run, "Seed workflow run");
      this.runs.set(String(run.runId), cloneSerializable(run));
      if (!this.activeRunId) this.activeRunId = String(run.runId);
    }
  }

  async createRun(run) {
    assertSerializable(run, "Workflow run");
    const key = String(run?.runId ?? "");
    if (!key) throw new WorkflowPersistenceError("Run id is required");
    if (this.runs.has(key)) {
      throw new WorkflowConflictError("Workflow run already exists", { runId: key });
    }
    const copy = cloneSerializable(run);
    this.runs.set(key, copy);
    this.activeRunId = key;
    return cloneSerializable(copy);
  }

  async saveRun(run, { expectedRevision = null } = {}) {
    assertSerializable(run, "Workflow run");
    const key = String(run?.runId ?? "");
    const current = this.runs.get(key);
    if (!current) throw new WorkflowPersistenceError("Workflow run was not found", { runId: key });
    if (
      expectedRevision != null &&
      Number(current.revision) !== Number(expectedRevision)
    ) {
      throw new WorkflowConflictError("Workflow run revision changed", {
        runId: key,
        expectedRevision,
        actualRevision: current.revision,
      });
    }
    const copy = cloneSerializable(run);
    this.runs.set(key, copy);
    this.activeRunId = key;
    return cloneSerializable(copy);
  }

  async loadRun(runId) {
    const run = this.runs.get(String(runId));
    return run ? cloneSerializable(run) : null;
  }

  async loadActiveRun() {
    return this.activeRunId ? this.loadRun(this.activeRunId) : null;
  }

  async clearActiveRun(runId) {
    if (runId == null || String(runId) === this.activeRunId) {
      this.activeRunId = null;
    }
  }
}

