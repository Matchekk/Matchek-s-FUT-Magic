/**
 * Small synchronous event bus. Handlers are snapshotted before delivery so a
 * handler may safely unsubscribe itself without skipping the next handler.
 *
 * @template {Record<string, unknown>} [Events=Record<string, unknown>]
 */
export class EventBus {
  #listeners;

  constructor() {
    /** @type {Map<keyof Events | string, Set<(payload: unknown) => void>>} */
    this.#listeners = new Map();
  }

  /**
   * @template {keyof Events & string} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   * @returns {() => void} idempotent unsubscribe function
   */
  on(type, handler) {
    assertEventType(type);
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function");
    }
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(handler);
    this.#listeners.set(type, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(handler);
      if (listeners.size === 0 && this.#listeners.get(type) === listeners) {
        this.#listeners.delete(type);
      }
    };
  }

  /**
   * @template {keyof Events & string} K
   * @param {K} type
   * @param {(payload: Events[K]) => void} handler
   * @returns {() => void}
   */
  once(type, handler) {
    let unsubscribe = () => {};
    unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /**
   * Delivers to every listener. Failures are reported after delivery rather
   * than silently swallowed or preventing unrelated observers from running.
   *
   * @template {keyof Events & string} K
   * @param {K} type
   * @param {Events[K]} payload
   * @returns {number} number of listeners invoked
   */
  emit(type, payload) {
    assertEventType(type);
    const listeners = [...(this.#listeners.get(type) ?? [])];
    const failures = [];
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, `Multiple listeners failed for ${type}`);
    }
    return listeners.length;
  }

  /** @param {keyof Events & string} type */
  listenerCount(type) {
    assertEventType(type);
    return this.#listeners.get(type)?.size ?? 0;
  }

  /** @param {keyof Events & string} [type] */
  clear(type) {
    if (type === undefined) {
      this.#listeners.clear();
      return;
    }
    assertEventType(type);
    this.#listeners.delete(type);
  }
}

const assertEventType = (type) => {
  if (typeof type !== "string" || !type.trim()) {
    throw new TypeError("Event type must be a non-empty string");
  }
};

export const createEventBus = () => new EventBus();
