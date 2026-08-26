import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";
import {
  validateProjectOptimizationRequest,
  validateProjectOptimizationResponse,
} from "./project-optimization.js";
import {
  validateSmartRouteRequest,
  validateSmartRouteResponse,
} from "./smart-route.js";

export const CloudPlannerOperation = Object.freeze({
  OPTIMIZE_PROJECT: "optimize_project",
  SMART_ROUTE: "smart_route",
});

export const CLOUD_PLANNER_DEADLINES = Object.freeze({
  MIN_MS: 250,
  DEFAULT_MS: 10_000,
  MAX_MS: 30_000,
});

export const CLOUD_PLANNER_MAX_REPLAY_ENTRIES = 256;

const ABORT_KIND = Object.freeze({ EXTERNAL: "external", TIMEOUT: "timeout" });

const fail = (code, message, path = "$cloudPlanner") => {
  throw new ProContractError(code, message, { path });
};

const normalizeClockValue = (clock) => {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Cloud planner clock returned an invalid time");
  }
  return now;
};

const normalizeDeadline = (value) => {
  const deadline = value === undefined ? CLOUD_PLANNER_DEADLINES.DEFAULT_MS : value;
  if (!Number.isFinite(deadline) || deadline <= 0) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Cloud planner deadline must be a positive number", "$cloudPlanner.options.deadlineMs");
  }
  return Math.max(
    CLOUD_PLANNER_DEADLINES.MIN_MS,
    Math.min(CLOUD_PLANNER_DEADLINES.MAX_MS, Math.trunc(deadline)),
  );
};

const isAbortSignal = (value) => value != null &&
  typeof value === "object" &&
  typeof value.aborted === "boolean" &&
  typeof value.addEventListener === "function" &&
  typeof value.removeEventListener === "function";

const normalizeOptions = (options) => {
  if (options == null || typeof options !== "object" || Array.isArray(options)) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Cloud planner options must be an object", "$cloudPlanner.options");
  }
  const allowed = new Set(["signal", "deadlineMs"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Cloud planner option is not supported", `$cloudPlanner.options.${key}`);
    }
  }
  const signal = options.signal ?? null;
  if (signal != null && !isAbortSignal(signal)) {
    fail(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID, "Cloud planner signal must be an AbortSignal", "$cloudPlanner.options.signal");
  }
  return Object.freeze({
    signal,
    deadlineMs: normalizeDeadline(options.deadlineMs),
  });
};

const sanitizedTransportFailure = () => new ProContractError(
  PRO_CONTRACT_ERROR_CODES.PROVIDER_OFFLINE,
  "Cloud planner transport is unavailable",
  { path: "$cloudPlanner.transport" },
);

const sanitizedAbortFailure = (kind) => new ProContractError(
  kind === ABORT_KIND.TIMEOUT
    ? PRO_CONTRACT_ERROR_CODES.PROVIDER_TIMEOUT
    : PRO_CONTRACT_ERROR_CODES.PROVIDER_OFFLINE,
  kind === ABORT_KIND.TIMEOUT
    ? "Cloud planner request exceeded its deadline"
    : "Cloud planner request was cancelled",
  { path: "$cloudPlanner.transport" },
);

const sanitizeResponseFailure = (error) => {
  const preservedCodes = new Set([
    PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH,
    PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED,
    PRO_CONTRACT_ERROR_CODES.HANDLE_UNKNOWN,
    PRO_CONTRACT_ERROR_CODES.LOCAL_REVALIDATION_FAILED,
  ]);
  const code = error instanceof ProContractError && preservedCodes.has(error.code)
    ? error.code
    : PRO_CONTRACT_ERROR_CODES.PROVIDER_INVALID_RESPONSE;
  return new ProContractError(code, "Cloud planner returned an invalid response", {
    path: "$cloudPlanner.response",
  });
};

export class CloudPlannerProvider {
  #clearTimer;
  #clock;
  #consumedRequestKeys = new Set();
  #consumedRequestQueue = [];
  #inFlightRequestKeys = new Set();
  #maxReplayEntries;
  #setTimer;
  #transport;

  constructor({
    transport = null,
    clock = Date.now,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    maxReplayEntries = CLOUD_PLANNER_MAX_REPLAY_ENTRIES,
  } = {}) {
    if (transport != null && typeof transport !== "function") {
      throw new TypeError("transport must be a function or null");
    }
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    if (typeof setTimer !== "function") throw new TypeError("setTimer must be a function");
    if (typeof clearTimer !== "function") throw new TypeError("clearTimer must be a function");
    if (!Number.isSafeInteger(maxReplayEntries) || maxReplayEntries < 1 ||
        maxReplayEntries > CLOUD_PLANNER_MAX_REPLAY_ENTRIES) {
      throw new TypeError(`maxReplayEntries must be an integer from 1 to ${CLOUD_PLANNER_MAX_REPLAY_ENTRIES}`);
    }
    this.#transport = transport;
    this.#clock = clock;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#maxReplayEntries = maxReplayEntries;
    Object.freeze(this);
  }

  async optimizeProject(request, options = {}) {
    return this.#invoke({
      operation: CloudPlannerOperation.OPTIMIZE_PROJECT,
      request,
      options,
      validateRequest: validateProjectOptimizationRequest,
      validateResponse: validateProjectOptimizationResponse,
    });
  }

  async recommendSmartRoute(request, options = {}) {
    return this.#invoke({
      operation: CloudPlannerOperation.SMART_ROUTE,
      request,
      options,
      validateRequest: validateSmartRouteRequest,
      validateResponse: validateSmartRouteResponse,
    });
  }

  async smartRoute(request, options = {}) {
    return this.recommendSmartRoute(request, options);
  }

  async #invoke({ operation, request, options, validateRequest, validateResponse }) {
    const normalizedRequest = validateRequest(request);
    const normalizedOptions = normalizeOptions(options);
    const now = normalizeClockValue(this.#clock);
    if (normalizedRequest.expiresAt <= now) {
      fail(PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED, "Cloud planner request has expired", "$cloudPlanner.request.expiresAt");
    }
    if (this.#transport == null) {
      fail(
        PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "Cloud planner provider is not configured",
        "$cloudPlanner.transport",
      );
    }
    if (normalizedOptions.signal?.aborted) {
      throw sanitizedAbortFailure(ABORT_KIND.EXTERNAL);
    }

    const replayKey = JSON.stringify([
      normalizedRequest.contract,
      normalizedRequest.requestId,
      normalizedRequest.fingerprint,
    ]);
    this.#claimRequest(replayKey);
    try {
      const result = await this.#send({
        operation,
        normalizedRequest,
        normalizedOptions,
        now,
        validateResponse,
      });
      this.#consumeRequest(replayKey);
      return result;
    } finally {
      this.#inFlightRequestKeys.delete(replayKey);
    }
  }

  async #send({ operation, normalizedRequest, normalizedOptions, now, validateResponse }) {

    const deadlineMs = Math.max(1, Math.min(
      normalizedOptions.deadlineMs,
      normalizedRequest.expiresAt - now,
    ));
    const controller = new AbortController();
    let abortKind = null;
    const abort = (kind) => {
      if (controller.signal.aborted) return;
      abortKind = kind;
      controller.abort(kind);
    };
    const onExternalAbort = () => abort(ABORT_KIND.EXTERNAL);
    normalizedOptions.signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = this.#setTimer(() => abort(ABORT_KIND.TIMEOUT), deadlineMs);
    let onInternalAbort;
    const abortResult = new Promise((resolve) => {
      onInternalAbort = () => resolve(Object.freeze({ type: "abort" }));
      controller.signal.addEventListener("abort", onInternalAbort, { once: true });
    });
    const call = Object.freeze({
      operation,
      request: normalizedRequest,
      deadlineMs,
      signal: controller.signal,
    });

    let rawResponse;
    try {
      const transportResult = Promise.resolve().then(() => this.#transport(call));
      const outcome = await Promise.race([
        transportResult.then(
          (value) => Object.freeze({ type: "response", value }),
          () => Object.freeze({ type: "transport_error" }),
        ),
        abortResult,
      ]);
      if (outcome.type === "abort") throw sanitizedAbortFailure(abortKind);
      if (outcome.type === "transport_error") throw sanitizedTransportFailure();
      rawResponse = outcome.value;
    } finally {
      this.#clearTimer(timer);
      normalizedOptions.signal?.removeEventListener("abort", onExternalAbort);
      controller.signal.removeEventListener("abort", onInternalAbort);
    }

    try {
      return validateResponse(rawResponse, { request: normalizedRequest, now: normalizeClockValue(this.#clock) });
    } catch (error) {
      throw sanitizeResponseFailure(error);
    }
  }

  #claimRequest(replayKey) {
    if (this.#inFlightRequestKeys.has(replayKey) || this.#consumedRequestKeys.has(replayKey)) {
      fail(
        PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH,
        "Cloud planner request was already used",
        "$cloudPlanner.request",
      );
    }
    this.#inFlightRequestKeys.add(replayKey);
  }

  #consumeRequest(replayKey) {
    this.#consumedRequestKeys.add(replayKey);
    this.#consumedRequestQueue.push(replayKey);
    while (this.#consumedRequestQueue.length > this.#maxReplayEntries) {
      const expiredKey = this.#consumedRequestQueue.shift();
      this.#consumedRequestKeys.delete(expiredKey);
    }
  }
}

export class NotConfiguredCloudPlannerProvider extends CloudPlannerProvider {
  constructor(options = {}) {
    if (options == null || typeof options !== "object" || Array.isArray(options) ||
        Reflect.ownKeys(options).length !== 0) {
      throw new TypeError("NotConfiguredCloudPlannerProvider accepts no configuration");
    }
    super();
    Object.freeze(this);
  }
}
