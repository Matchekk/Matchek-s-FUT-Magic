const REQUEST_TYPE = "GRINDPILOT_STORAGE_REQUEST_V1";
const RESPONSE_TYPE = "GRINDPILOT_STORAGE_RESPONSE_V1";
const SOURCE = "grindpilot-fc26";
const DEFAULT_TIMEOUT_MS = 5_000;

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `gp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * chrome.storage.local-compatible facade for page-world modules. The content
 * script owns the real extension storage; page code receives no Chrome API.
 */
export class PageStorageArea {
  constructor({ window = globalThis.window, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!window?.postMessage || !window?.addEventListener) {
      throw new TypeError("PageStorageArea requires a window-like message target");
    }
    this.window = window;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.onMessage = this.onMessage.bind(this);
    this.window.addEventListener("message", this.onMessage, true);
  }

  onMessage(event) {
    if (event.source !== this.window) return;
    const data = event.data;
    if (data?.type !== RESPONSE_TYPE || data?.source !== SOURCE) return;
    const pending = this.pending.get(String(data.requestId ?? ""));
    if (!pending) return;
    this.pending.delete(String(data.requestId));
    clearTimeout(pending.timeoutId);
    if (data.ok) pending.resolve(data.data);
    else {
      const error = new Error(data?.error?.message || "GrindPilot storage failed");
      error.code = data?.error?.code || "GP_STORAGE_FAILED";
      pending.reject(error);
    }
  }

  request(operation, key, value) {
    const id = requestId();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`GrindPilot storage ${operation} timed out`);
        error.code = "GP_STORAGE_TIMEOUT";
        reject(error);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
      this.window.postMessage(
        { type: REQUEST_TYPE, source: SOURCE, requestId: id, operation, key, value },
        "*",
      );
    });
  }

  async get(key) {
    if (Array.isArray(key)) {
      const entries = await Promise.all(
        key.map(async (entry) => [entry, await this.request("GET", entry)]),
      );
      return Object.fromEntries(entries);
    }
    return { [key]: await this.request("GET", key) };
  }

  async set(entries) {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new TypeError("Storage entries must be an object");
    }
    await Promise.all(
      Object.entries(entries).map(([key, value]) => this.request("SET", key, value)),
    );
  }

  async remove(key) {
    const keys = Array.isArray(key) ? key : [key];
    await Promise.all(keys.map((entry) => this.request("REMOVE", entry)));
  }

  dispose() {
    this.window.removeEventListener("message", this.onMessage, true);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("GrindPilot storage adapter disposed"));
    }
    this.pending.clear();
  }
}

