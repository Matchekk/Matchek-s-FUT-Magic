import { WorkflowConflictError, WorkflowPersistenceError } from "../workflow/errors.js";

const STORAGE_KEY = "grindpilot.activeRun.v1";
const clone = (value) => (value == null ? value : structuredClone(value));

/** Single-active-run repository backed by the content-script storage bridge. */
export class PageWorkflowRepository {
  constructor(storageArea, storageKey = STORAGE_KEY) {
    const domainApi = storageArea?.loadActiveRun && storageArea?.saveRun;
    const legacyApi = storageArea?.get && storageArea?.set && storageArea?.remove;
    if (!domainApi && !legacyApi) {
      throw new TypeError("PageWorkflowRepository requires a GrindPilot state area");
    }
    this.storageArea = storageArea;
    this.storageKey = storageKey;
    this.domainApi = Boolean(domainApi);
    this.ownerId =
      globalThis.crypto?.randomUUID?.() ??
      `workflow-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async loadActiveRun() {
    if (this.domainApi) {
      return clone(await this.storageArea.loadActiveRun(this.ownerId));
    }
    const stored = await this.storageArea.get(this.storageKey);
    return clone(stored?.[this.storageKey] ?? null);
  }

  async loadRun(runId) {
    if (this.domainApi) {
      return clone(await this.storageArea.loadRun(runId, this.ownerId));
    }
    const run = await this.loadActiveRun();
    return run && String(run.runId) === String(runId) ? run : null;
  }

  async createRun(run) {
    if (!run?.runId) throw new WorkflowPersistenceError("Run id is required");
    if (this.domainApi) {
      return clone(await this.storageArea.createRun(clone(run), this.ownerId));
    }
    const existing = await this.loadActiveRun();
    if (existing && !["completed", "stopped", "failed"].includes(existing.status)) {
      throw new WorkflowConflictError("A workflow run is already active", {
        runId: existing.runId,
      });
    }
    await this.storageArea.set({ [this.storageKey]: clone(run) });
    return clone(run);
  }

  async saveRun(run, { expectedRevision = null } = {}) {
    if (this.domainApi) {
      return clone(
        await this.storageArea.saveRun(
          clone(run),
          expectedRevision,
          this.ownerId,
        ),
      );
    }
    const current = await this.loadActiveRun();
    if (!current || String(current.runId) !== String(run?.runId)) {
      throw new WorkflowPersistenceError("Workflow run was not found", {
        runId: run?.runId ?? null,
      });
    }
    if (
      expectedRevision != null &&
      Number(current.revision) !== Number(expectedRevision)
    ) {
      throw new WorkflowConflictError("Workflow run revision changed", {
        runId: run.runId,
        expectedRevision,
        actualRevision: current.revision,
      });
    }
    await this.storageArea.set({ [this.storageKey]: clone(run) });
    return clone(run);
  }

  async clearActiveRun(runId = null) {
    if (this.domainApi) {
      await this.storageArea.clearActiveRun(runId, this.ownerId);
      return;
    }
    const current = await this.loadActiveRun();
    if (runId == null || String(current?.runId ?? "") === String(runId)) {
      await this.storageArea.remove(this.storageKey);
    }
  }

  async assertOwnership(runId) {
    if (!this.domainApi) return true;
    await this.storageArea.assertRunOwnership(runId, this.ownerId);
    return true;
  }
}

export { STORAGE_KEY as ACTIVE_RUN_STORAGE_KEY };
