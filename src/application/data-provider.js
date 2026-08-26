import { cloneAndFreeze } from "./immutable.js";

export class DataProvider {
  constructor({ id, operations, capabilityRegistry, capabilityByOperation = {} }) {
    this.id = String(id || "").trim();
    if (!this.id) throw new TypeError("DataProvider requires an id");
    if (!operations || typeof operations !== "object") throw new TypeError("DataProvider requires operation readers");
    this.operations = Object.freeze({ ...operations });
    this.capabilityRegistry = capabilityRegistry;
    this.capabilityByOperation = Object.freeze({ ...capabilityByOperation });
  }

  async read(operation, input = null) {
    const reader = this.operations[operation];
    if (typeof reader !== "function") throw new Error(`Provider ${this.id} does not support ${operation}`);
    const capabilityId = this.capabilityByOperation[operation];
    if (capabilityId && !this.capabilityRegistry?.isAvailable(capabilityId)) {
      const record = this.capabilityRegistry?.get(capabilityId);
      const error = new Error(record?.reason || `${capabilityId} is unavailable`);
      error.code = "CAPABILITY_UNAVAILABLE";
      error.capabilityId = capabilityId;
      throw error;
    }
    const result = await reader(cloneAndFreeze(input));
    if (!result || typeof result !== "object" || !("value" in result)) {
      throw new TypeError(`Provider ${this.id}.${operation} must return { value, evidence? }`);
    }
    return cloneAndFreeze({
      providerId: this.id,
      operation,
      observedAt: Number(result.observedAt || Date.now()),
      value: result.value,
      evidence: result.evidence || null,
    });
  }
}
