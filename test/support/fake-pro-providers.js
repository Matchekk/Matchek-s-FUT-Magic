import {
  AuthProvider,
  normalizeAuthSignInRequest,
  normalizeAuthSnapshot,
} from "../../src/application/pro-contracts/auth-provider.js";
import {
  CloudPlannerOperation,
} from "../../src/application/pro-contracts/cloud-planner-provider.js";
import {
  EntitlementProvider,
  normalizeEntitlementSnapshot,
} from "../../src/application/pro-contracts/entitlement-provider.js";
const nextFrom = (values, index) => values[Math.min(index, values.length - 1)];

export class DeterministicAuthProvider extends AuthProvider {
  #index = 0;
  #snapshots;

  constructor(snapshots) {
    super();
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      throw new TypeError("snapshots must be a non-empty array");
    }
    this.#snapshots = Object.freeze(snapshots.map(normalizeAuthSnapshot));
  }

  async getSnapshot() {
    return nextFrom(this.#snapshots, this.#index);
  }

  async signIn(input = {}) {
    normalizeAuthSignInRequest(input);
    this.#index += 1;
    return this.getSnapshot();
  }

  async signOut() {
    this.#index += 1;
    return this.getSnapshot();
  }
}

export class DeterministicEntitlementProvider extends EntitlementProvider {
  #index = 0;
  #now;
  #snapshots;

  constructor(snapshots, { now }) {
    super();
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      throw new TypeError("snapshots must be a non-empty array");
    }
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a timestamp");
    this.#now = now;
    this.#snapshots = Object.freeze(
      snapshots.map((snapshot) => normalizeEntitlementSnapshot(snapshot, { now })),
    );
  }

  async getSnapshot({ forceRefresh = false } = {}) {
    if (forceRefresh) this.#index += 1;
    return nextFrom(this.#snapshots, this.#index);
  }

  get now() {
    return this.#now;
  }
}

export const createDeterministicCloudTransport = ({
  projectResponses = [],
  smartRouteResponses = [],
} = {}) => {
  const queues = new Map([
    [CloudPlannerOperation.OPTIMIZE_PROJECT, [...projectResponses]],
    [CloudPlannerOperation.SMART_ROUTE, [...smartRouteResponses]],
  ]);
  const calls = [];
  const transport = async (call) => {
    calls.push(call);
    const queue = queues.get(call.operation);
    if (!queue || queue.length === 0) {
      throw new Error("No deterministic response configured");
    }
    const next = queue.shift();
    return typeof next === "function" ? next(call) : structuredClone(next);
  };
  return Object.freeze({ calls, transport });
};
