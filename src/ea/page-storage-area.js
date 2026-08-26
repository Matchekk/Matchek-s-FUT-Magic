const COMMAND_TYPE = "GRINDPILOT_STATE_COMMAND_V2";
const DEFAULT_TIMEOUT_MS = 5_000;
const STORAGE_KEYS = Object.freeze({
  activity: "grindpilot.activity.v1",
  profiles: "grindpilot.profiles.v1",
  projects: "grindpilot.projects.v1",
  settings: "grindpilot.settings.v1",
});

const DIRECT_STORAGE_ACTIONS = new Set([
  "BOOTSTRAP_LOAD",
  "SETTINGS_SAVE",
  "ACTIVITY_SAVE",
  "PROJECTS_SAVE",
  "PROFILE_LIST",
  "PROFILE_GET",
  "PROFILE_PUT",
  "PROFILE_DELETE",
]);

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `gp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Narrow state client used from the extension's isolated content-script world.
 * The EA page never receives a storage capability or raw key/value API.
 */
export class PageStorageArea {
  constructor({
    runtime = globalThis.chrome?.runtime,
    storage = globalThis.chrome?.storage?.local,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (!runtime?.sendMessage) {
      throw new TypeError("PageStorageArea requires the extension runtime API");
    }
    this.runtime = runtime;
    this.storage = storage?.get && storage?.set && storage?.remove ? storage : null;
    this.timeoutMs = timeoutMs;
    this.disposed = false;
  }

  command(action, payload = null) {
    if (this.disposed) return Promise.reject(new Error("GrindPilot state adapter disposed"));
    if (this.storage && DIRECT_STORAGE_ACTIONS.has(action)) {
      return this.directCommand(action, payload);
    }
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

  storageCall(method, ...args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        callback();
      };
      const timeoutId = setTimeout(() => finish(() => {
        const error = new Error(`GrindPilot storage ${method} timed out`);
        error.code = "GP_STATE_TIMEOUT";
        reject(error);
      }), this.timeoutMs);
      try {
        this.storage[method](...args, (result) => finish(() => {
          const runtimeError = this.runtime?.lastError;
          if (runtimeError) {
            const error = new Error(runtimeError.message || `GrindPilot storage ${method} failed`);
            error.code = "GP_STATE_STORAGE_FAILED";
            reject(error);
          } else resolve(result);
        }));
      } catch (cause) {
        finish(() => {
          const error = new Error(cause?.message || `GrindPilot storage ${method} failed`);
          error.code = "GP_STATE_STORAGE_FAILED";
          error.cause = cause;
          reject(error);
        });
      }
    });
  }

  async directCommand(action, payload = null) {
    const input = payload && typeof payload === "object" ? payload : {};
    if (action === "BOOTSTRAP_LOAD") {
      const stored = await this.storageCall("get", [
        STORAGE_KEYS.activity,
        STORAGE_KEYS.projects,
        STORAGE_KEYS.settings,
      ]);
      return {
        activity: Array.isArray(stored?.[STORAGE_KEYS.activity])
          ? stored[STORAGE_KEYS.activity]
          : [],
        projects: Array.isArray(stored?.[STORAGE_KEYS.projects])
          ? stored[STORAGE_KEYS.projects]
          : [],
        settings:
          stored?.[STORAGE_KEYS.settings] &&
          typeof stored[STORAGE_KEYS.settings] === "object" &&
          !Array.isArray(stored[STORAGE_KEYS.settings])
            ? stored[STORAGE_KEYS.settings]
            : {},
      };
    }
    if (action === "SETTINGS_SAVE") {
      await this.storageCall("set", { [STORAGE_KEYS.settings]: input.value });
      return true;
    }
    if (action === "ACTIVITY_SAVE") {
      await this.storageCall("set", { [STORAGE_KEYS.activity]: input.value });
      return true;
    }
    if (action === "PROJECTS_SAVE") {
      await this.storageCall("set", { [STORAGE_KEYS.projects]: input.value });
      return true;
    }

    const stored = await this.storageCall("get", [STORAGE_KEYS.profiles]);
    const profiles =
      stored?.[STORAGE_KEYS.profiles] &&
      typeof stored[STORAGE_KEYS.profiles] === "object" &&
      !Array.isArray(stored[STORAGE_KEYS.profiles])
        ? structuredClone(stored[STORAGE_KEYS.profiles])
        : {};
    if (action === "PROFILE_LIST") return Object.values(profiles);
    const id = String(input.id ?? input.profile?.id ?? "").trim();
    if (action === "PROFILE_GET") return profiles[id] ?? null;
    if (action === "PROFILE_PUT") {
      profiles[id] = structuredClone(input.profile);
      await this.storageCall("set", { [STORAGE_KEYS.profiles]: profiles });
      return profiles[id];
    }
    if (!Object.hasOwn(profiles, id)) return false;
    delete profiles[id];
    if (Object.keys(profiles).length) {
      await this.storageCall("set", { [STORAGE_KEYS.profiles]: profiles });
    } else {
      await this.storageCall("remove", [STORAGE_KEYS.profiles]);
    }
    return true;
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
