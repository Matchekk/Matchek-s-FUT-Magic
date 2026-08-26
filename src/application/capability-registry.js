import { cloneAndFreeze } from "./immutable.js";

export const CapabilityState = Object.freeze({
  AVAILABLE: "available",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
  UNVERIFIED: "unverified",
});

const validateId = (id) => {
  const value = String(id || "").trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`Invalid capability id: ${value || "missing"}`);
  }
  return value;
};

export class CapabilityRegistry {
  #records = new Map();
  #revision = 0;

  declare(id, { state = CapabilityState.UNVERIFIED, reason = null, evidence = null, observedAt = Date.now() } = {}) {
    const capabilityId = validateId(id);
    if (!Object.values(CapabilityState).includes(state)) throw new TypeError(`Invalid capability state: ${state}`);
    this.#revision += 1;
    const record = cloneAndFreeze({ id: capabilityId, state, reason, evidence, observedAt, revision: this.#revision });
    this.#records.set(capabilityId, record);
    return record;
  }

  get(id) {
    return this.#records.get(validateId(id)) || cloneAndFreeze({
      id: String(id), state: CapabilityState.UNVERIFIED, reason: "Capability has not been observed", evidence: null, observedAt: null, revision: this.#revision,
    });
  }

  isAvailable(id) {
    return this.get(id).state === CapabilityState.AVAILABLE;
  }

  require(ids) {
    const records = [...new Set(ids || [])].map((id) => this.get(id));
    return cloneAndFreeze({
      ok: records.every((record) => record.state === CapabilityState.AVAILABLE),
      records,
      missing: records.filter((record) => record.state !== CapabilityState.AVAILABLE).map((record) => record.id),
      revision: this.#revision,
    });
  }

  snapshot() {
    return cloneAndFreeze({ revision: this.#revision, capabilities: [...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)) });
  }
}
