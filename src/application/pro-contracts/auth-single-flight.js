import { normalizeAuthSnapshot } from "./auth-provider.js";

/**
 * Provider-neutral single-flight boundary for future FUT Magic product auth.
 * The refresh callback returns token-free public auth evidence; this class
 * deliberately knows nothing about EA sessions, credentials or transports.
 */
export class AuthRefreshSingleFlight {
  #refresh;
  #clock;
  #inFlight = null;

  constructor({ refresh, clock = () => Date.now() } = {}) {
    if (typeof refresh !== "function") throw new TypeError("refresh must be a function");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#refresh = refresh;
    this.#clock = clock;
  }

  get refreshing() {
    return this.#inFlight !== null;
  }

  refresh() {
    if (this.#inFlight) return this.#inFlight;
    const request = Promise.resolve()
      .then(() => this.#refresh())
      .then((snapshot) => normalizeAuthSnapshot(snapshot, { now: this.#clock() }));
    this.#inFlight = request.finally(() => {
      if (this.#inFlight === tracked) this.#inFlight = null;
    });
    const tracked = this.#inFlight;
    return tracked;
  }
}
