const COMMAND_TYPE = "GRINDPILOT_STATE_COMMAND_V2";
const DEFAULT_TIMEOUT_MS = 5_000;

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `gp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Narrow state client used from the extension's isolated content-script world.
 * The EA page never receives a storage capability or raw key/value API.
 */
export class PageStorageArea {
  constructor({ runtime = globalThis.chrome?.runtime, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!runtime?.sendMessage) {
      throw new TypeError("PageStorageArea requires the extension runtime API");
    }
    this.runtime = runtime;
    this.timeoutMs = timeoutMs;
    this.disposed = false;
  }

  command(action, payload = null) {
    if (this.disposed) return Promise.reject(new Error("GrindPilot state adapter disposed"));
    const id = requestId();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback();
      };
      const timeoutId = setTimeout(() => finish(() => {
        const error = new Error(`GrindPilot state command ${action} timed out`);
        error.code = "GP_STATE_TIMEOUT";
        reject(error);
      }), this.timeoutMs);
      this.runtime.sendMessage(
        { type: COMMAND_TYPE, requestId: id, action, payload },
        (response) => finish(() => {
          const runtimeError = this.runtime?.lastError;
          if (runtimeError || !response?.ok) {
            const error = new Error(runtimeError?.message || response?.error?.message || "GrindPilot state command failed");
            error.code = response?.error?.code || "GP_STATE_FAILED";
            error.details = response?.error?.details ?? null;
            reject(error);
          } else resolve(response.data);
        }),
      );
    });
  }

  loadBootstrap() { return this.command("BOOTSTRAP_LOAD"); }
  saveSettings(value) { return this.command("SETTINGS_SAVE", { value }); }
  saveActivity(value) { return this.command("ACTIVITY_SAVE", { value }); }
  saveProjects(value) { return this.command("PROJECTS_SAVE", { value }); }

  listProfiles() { return this.command("PROFILE_LIST"); }
  getProfile(id) { return this.command("PROFILE_GET", { id }); }
  putProfile(profile) { return this.command("PROFILE_PUT", { profile }); }
  deleteProfile(id) { return this.command("PROFILE_DELETE", { id }); }

  loadActiveRun(ownerId) { return this.command("RUN_LOAD_ACTIVE", { ownerId }); }
  loadRun(runId, ownerId) { return this.command("RUN_LOAD", { runId, ownerId }); }
  createRun(run, ownerId) { return this.command("RUN_CREATE", { run, ownerId }); }
  saveRun(run, expectedRevision, ownerId) {
    return this.command("RUN_SAVE", { run, expectedRevision, ownerId });
  }
  assertRunOwnership(runId, ownerId) {
    return this.command("RUN_ASSERT_OWNER", { runId, ownerId });
  }
  clearActiveRun(runId, ownerId) {
    return this.command("RUN_CLEAR", { runId, ownerId });
  }

  dispose() { this.disposed = true; }
}
