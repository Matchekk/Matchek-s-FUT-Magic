/**
 * Outcomes are values rather than booleans so callers cannot accidentally treat
 * an ambiguous timeout as a successful interaction.
 */
export const DomWaitStatus = Object.freeze({
  FOUND: "FOUND",
  SATISFIED: "SATISFIED",
  SETTLED: "SETTLED",
  TIMED_OUT: "TIMED_OUT",
  ABORTED: "ABORTED",
  MISSING: "MISSING",
  ERROR: "ERROR",
});

export const DomClickStatus = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  ACTION_MISSING: "ACTION_MISSING",
  ACTION_DISABLED: "ACTION_DISABLED",
  OBSERVATION_ROOT_MISSING: "OBSERVATION_ROOT_MISSING",
  POSTCONDITION_ALREADY_SATISFIED: "POSTCONDITION_ALREADY_SATISFIED",
  POSTCONDITION_TIMED_OUT: "POSTCONDITION_TIMED_OUT",
  ABORTED: "ABORTED",
  CLICK_FAILED: "CLICK_FAILED",
  ERROR: "ERROR",
});

const DEFAULT_ACTION_SELECTOR = [
  "button",
  '[role="button"]',
  "a[href]",
  'input[type="button"]',
  'input[type="submit"]',
  "[data-action]",
].join(", ");

const OBSERVER_OPTIONS = Object.freeze({
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true,
});

function elapsedSince(startedAt, now) {
  return Math.max(0, now() - startedAt);
}

function normalizeDuration(value, name, { allowZero = true } = {}) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new TypeError(`${name} must be a finite ${allowZero ? "non-negative" : "positive"} number`);
  }
  return value;
}

function normalizedText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function serializeFingerprint(value) {
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return `${typeof value}:${String(value)}`;
  }
  return `json:${JSON.stringify(value)}`;
}

function hasThen(value) {
  return value != null && (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function";
}

function result(status, startedAt, now, extra = {}) {
  return { status, elapsedMs: elapsedSince(startedAt, now), ...extra };
}

/**
 * DOM-only safety net for moments when EA controller hooks are unavailable.
 * Every operation is scoped to a supplied root and destructive actions require
 * an observable postcondition.
 */
export class DomFallbackAdapter {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    MutationObserver = globalThis.MutationObserver,
    now = Date.now,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  } = {}) {
    this.document = document;
    this.window = window;
    this.MutationObserver = MutationObserver;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  /** @param {Element} element */
  isVisible(element) {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;

    const style = this.window?.getComputedStyle?.(element);
    if (style) {
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      if (Number.parseFloat(style.opacity) === 0) return false;
    }

    if (typeof element.getClientRects === "function") {
      const rects = element.getClientRects();
      if (rects && rects.length === 0 && style?.position !== "fixed") return false;
    }

    return true;
  }

  /** @param {Element} element */
  isEnabled(element) {
    if (!element || element.disabled === true) return false;
    if (element.getAttribute?.("aria-disabled") === "true") return false;
    if (element.matches?.(":disabled")) return false;
    const style = this.window?.getComputedStyle?.(element);
    return style?.pointerEvents !== "none";
  }

  getActionLabel(element) {
    return (
      element?.getAttribute?.("aria-label") ||
      element?.value ||
      element?.textContent ||
      element?.getAttribute?.("title") ||
      ""
    );
  }

  /**
   * Finds controls only below `root`; generic div/span text is intentionally not
   * searched because it can promote unrelated page copy into a destructive click.
   */
  findActions({
    root,
    text,
    selector = DEFAULT_ACTION_SELECTOR,
    match = "exact",
    includeDisabled = false,
    predicate,
  } = {}) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    if (match !== "exact" && match !== "startsWith") {
      throw new TypeError('match must be "exact" or "startsWith"');
    }

    const target = text == null ? null : normalizedText(text);
    if (text != null && target === "") return [];
    const candidates = [];
    if (root.matches?.(selector)) candidates.push(root);
    candidates.push(...root.querySelectorAll(selector));

    return [...new Set(candidates)].filter((element) => {
      if (!this.isVisible(element)) return false;
      if (!includeDisabled && !this.isEnabled(element)) return false;
      if (target != null) {
        const label = normalizedText(this.getActionLabel(element));
        const matches = match === "exact" ? label === target : label.startsWith(target);
        if (!matches) return false;
      }
      return typeof predicate !== "function" || predicate(element) === true;
    });
  }

  findAction(options) {
    return this.findActions(options)[0] ?? null;
  }

  /**
   * Waits for an action using DOM mutations and one hard deadline. No polling
   * interval is used, and an expired deadline can never return FOUND.
   */
  waitForAction({ root, timeoutMs, signal, ...query } = {}) {
    return this.#waitForPredicate({
      root,
      timeoutMs,
      signal,
      successStatus: DomWaitStatus.FOUND,
      evaluate: () => this.findAction({ root, ...query }),
      mapValue: (element) => ({ element }),
    });
  }

  /**
   * Waits for any observable postcondition. `subscribe` can connect controller or
   * event-bus signals in addition to MutationObserver changes.
   */
  waitForPostcondition({ root, predicate, timeoutMs, signal, subscribe } = {}) {
    if (typeof predicate !== "function") throw new TypeError("predicate must be a function");
    return this.#waitForPredicate({
      root,
      timeoutMs,
      signal,
      subscribe,
      successStatus: DomWaitStatus.SATISFIED,
      evaluate: predicate,
      mapValue: (value) => ({ value }),
    });
  }

  /**
   * Declares a squad settled only after a quiet DOM window and an accepted stable
   * fingerprint. A timeout, missing pitch, failed verifier, or abort is explicit.
   */
  waitForSquadSettle({
    root,
    quietMs,
    timeoutMs,
    getFingerprint,
    verifyFingerprint,
    signal,
  } = {}) {
    normalizeDuration(quietMs, "quietMs");
    normalizeDuration(timeoutMs, "timeoutMs", { allowZero: false });
    if (typeof getFingerprint !== "function") {
      throw new TypeError("getFingerprint must be a synchronous function");
    }
    if (typeof verifyFingerprint !== "function") {
      throw new TypeError("verifyFingerprint must be a function");
    }

    const startedAt = this.now();
    if (!root || typeof root.querySelectorAll !== "function") {
      return Promise.resolve(result(DomWaitStatus.MISSING, startedAt, this.now));
    }
    if (signal?.aborted) {
      return Promise.resolve(result(DomWaitStatus.ABORTED, startedAt, this.now, { reason: signal.reason }));
    }
    return new Promise((resolve) => {
      let completed = false;
      let quietTimer = null;
      let deadlineTimer = null;
      let observer = null;
      let generation = 0;
      let baseline;

      const cleanup = () => {
        if (quietTimer != null) this.clearTimer(quietTimer);
        if (deadlineTimer != null) this.clearTimer(deadlineTimer);
        observer?.disconnect();
        signal?.removeEventListener?.("abort", onAbort);
      };

      const finish = (status, extra = {}) => {
        if (completed) return;
        completed = true;
        cleanup();
        resolve(result(status, startedAt, this.now, extra));
      };

      const readFingerprint = () => {
        try {
          const value = getFingerprint(root);
          if (hasThen(value)) throw new TypeError("getFingerprint must return synchronously");
          return { ok: true, value };
        } catch (error) {
          finish(DomWaitStatus.ERROR, { error });
          return { ok: false };
        }
      };

      const scheduleQuietCheck = () => {
        if (completed) return;
        if (quietTimer != null) this.clearTimer(quietTimer);
        const expectedGeneration = generation;
        quietTimer = this.setTimer(async () => {
          quietTimer = null;
          if (completed || expectedGeneration !== generation) return;

          const current = readFingerprint();
          if (!current.ok || completed) return;
          try {
            if (serializeFingerprint(current.value) !== serializeFingerprint(baseline)) {
              baseline = current.value;
              generation += 1;
              scheduleQuietCheck();
              return;
            }
            const accepted = await verifyFingerprint(current.value, { root });
            if (completed || expectedGeneration !== generation) return;
            if (accepted === true) {
              finish(DomWaitStatus.SETTLED, { fingerprint: current.value });
            }
            // A rejected fingerprint waits for another observable mutation or the
            // deadline; it is never converted to success by another blind sleep.
          } catch (error) {
            finish(DomWaitStatus.ERROR, { error });
          }
        }, quietMs);
      };

      const onMutation = () => {
        if (completed) return;
        generation += 1;
        const next = readFingerprint();
        if (!next.ok || completed) return;
        baseline = next.value;
        scheduleQuietCheck();
      };

      const onAbort = () => finish(DomWaitStatus.ABORTED, { reason: signal.reason });

      const initial = readFingerprint();
      if (!initial.ok || completed) return;
      baseline = initial.value;

      if (typeof this.MutationObserver !== "function") {
        finish(DomWaitStatus.ERROR, { error: new Error("MutationObserver is unavailable") });
        return;
      }

      try {
        observer = new this.MutationObserver(onMutation);
        observer.observe(root, OBSERVER_OPTIONS);
      } catch (error) {
        finish(DomWaitStatus.ERROR, { error });
        return;
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });
      deadlineTimer = this.setTimer(() => finish(DomWaitStatus.TIMED_OUT), timeoutMs);
      scheduleQuietCheck();
    });
  }

  /**
   * Activates a scoped action and requires a separately observed postcondition.
   * The postcondition is checked immediately after activation and on mutations.
   */
  async clickAndWaitForPostcondition({
    root,
    element,
    action,
    postcondition,
    timeoutMs,
    signal,
    subscribe,
    activate,
  } = {}) {
    const startedAt = this.now();
    normalizeDuration(timeoutMs, "timeoutMs", { allowZero: false });
    if (typeof postcondition !== "function") throw new TypeError("postcondition must be a function");
    if (signal?.aborted) {
      return result(DomClickStatus.ABORTED, startedAt, this.now, { reason: signal.reason });
    }
    if (!root || typeof root.querySelectorAll !== "function") {
      return result(DomClickStatus.OBSERVATION_ROOT_MISSING, startedAt, this.now);
    }

    if (element && typeof root.contains === "function" && root !== element && !root.contains(element)) {
      return result(DomClickStatus.ACTION_MISSING, startedAt, this.now);
    }
    const target = element ?? this.findAction({ root, ...(action ?? {}) });
    if (!target || !this.isVisible(target)) {
      return result(DomClickStatus.ACTION_MISSING, startedAt, this.now);
    }
    if (!this.isEnabled(target)) {
      return result(DomClickStatus.ACTION_DISABLED, startedAt, this.now, { element: target });
    }

    try {
      const before = await postcondition();
      if (before) {
        return result(DomClickStatus.POSTCONDITION_ALREADY_SATISFIED, startedAt, this.now, {
          element: target,
          postconditionValue: before,
        });
      }
    } catch (error) {
      return result(DomClickStatus.ERROR, startedAt, this.now, { element: target, error });
    }

    // Subscribe before activation so a synchronous controller event cannot be
    // missed. The private controller also guarantees cleanup if activation throws.
    const operationController = new AbortController();
    const forwardAbort = () => operationController.abort(signal.reason);
    signal?.addEventListener?.("abort", forwardAbort, { once: true });
    if (signal?.aborted) operationController.abort(signal.reason);
    const outcomePromise = this.waitForPostcondition({
      root,
      predicate: postcondition,
      timeoutMs,
      signal: operationController.signal,
      subscribe,
    });
    if (operationController.signal.aborted) {
      const outcome = await outcomePromise;
      signal?.removeEventListener?.("abort", forwardAbort);
      return result(DomClickStatus.ABORTED, startedAt, this.now, {
        element: target,
        reason: outcome.reason,
      });
    }

    try {
      if (typeof activate === "function") {
        await activate(target);
      } else if (typeof target.click === "function") {
        target.click();
      } else {
        operationController.abort("activation-unavailable");
        await outcomePromise;
        signal?.removeEventListener?.("abort", forwardAbort);
        return result(DomClickStatus.CLICK_FAILED, startedAt, this.now, {
          element: target,
          error: new Error("Action element has no click method"),
        });
      }
    } catch (error) {
      operationController.abort(error);
      await outcomePromise;
      signal?.removeEventListener?.("abort", forwardAbort);
      return result(DomClickStatus.CLICK_FAILED, startedAt, this.now, { element: target, error });
    }

    const outcome = await outcomePromise;
    signal?.removeEventListener?.("abort", forwardAbort);

    if (outcome.status === DomWaitStatus.SATISFIED) {
      return result(DomClickStatus.SUCCEEDED, startedAt, this.now, {
        element: target,
        postconditionValue: outcome.value,
      });
    }
    if (outcome.status === DomWaitStatus.ABORTED) {
      return result(DomClickStatus.ABORTED, startedAt, this.now, {
        element: target,
        reason: outcome.reason,
      });
    }
    if (outcome.status === DomWaitStatus.TIMED_OUT) {
      return result(DomClickStatus.POSTCONDITION_TIMED_OUT, startedAt, this.now, { element: target });
    }
    return result(DomClickStatus.ERROR, startedAt, this.now, {
      element: target,
      error: outcome.error ?? new Error(`Unexpected postcondition outcome: ${outcome.status}`),
    });
  }

  clickAndVerify(options) {
    return this.clickAndWaitForPostcondition(options);
  }

  #waitForPredicate({
    root,
    evaluate,
    mapValue,
    successStatus,
    timeoutMs,
    signal,
    subscribe,
  }) {
    normalizeDuration(timeoutMs, "timeoutMs", { allowZero: false });
    const startedAt = this.now();
    if (!root || typeof root.querySelectorAll !== "function") {
      return Promise.resolve(result(DomWaitStatus.MISSING, startedAt, this.now));
    }
    if (signal?.aborted) {
      return Promise.resolve(result(DomWaitStatus.ABORTED, startedAt, this.now, { reason: signal.reason }));
    }
    return new Promise((resolve) => {
      let completed = false;
      let checking = false;
      let checkAgain = false;
      let observer = null;
      let deadlineTimer = null;
      let unsubscribe = null;

      const cleanup = () => {
        let cleanupError = null;
        observer?.disconnect();
        if (deadlineTimer != null) this.clearTimer(deadlineTimer);
        signal?.removeEventListener?.("abort", onAbort);
        try {
          unsubscribe?.();
        } catch (error) {
          cleanupError = error;
        }
        return cleanupError;
      };

      const finish = (status, extra = {}) => {
        if (completed) return;
        completed = true;
        const cleanupError = cleanup();
        if (cleanupError) {
          resolve(result(DomWaitStatus.ERROR, startedAt, this.now, { error: cleanupError }));
        } else {
          resolve(result(status, startedAt, this.now, extra));
        }
      };

      const check = async () => {
        if (completed) return;
        if (checking) {
          checkAgain = true;
          return;
        }
        checking = true;
        try {
          do {
            checkAgain = false;
            const value = await evaluate();
            if (completed) return;
            if (value) {
              finish(successStatus, mapValue(value));
              return;
            }
          } while (checkAgain && !completed);
        } catch (error) {
          finish(DomWaitStatus.ERROR, { error });
        } finally {
          checking = false;
        }
      };

      const onAbort = () => finish(DomWaitStatus.ABORTED, { reason: signal.reason });

      if (typeof this.MutationObserver !== "function") {
        finish(DomWaitStatus.ERROR, { error: new Error("MutationObserver is unavailable") });
        return;
      }
      try {
        observer = new this.MutationObserver(check);
        observer.observe(root, OBSERVER_OPTIONS);
      } catch (error) {
        finish(DomWaitStatus.ERROR, { error });
        return;
      }
      if (typeof subscribe === "function") {
        try {
          unsubscribe = subscribe(check);
        } catch (error) {
          finish(DomWaitStatus.ERROR, { error });
          return;
        }
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });
      deadlineTimer = this.setTimer(() => finish(DomWaitStatus.TIMED_OUT), timeoutMs);
      void check();
    });
  }
}

export default DomFallbackAdapter;
