const SOLVER_BRIDGE_REQUEST = "EA_SOLVER_REQUEST";
const SOLVER_PORT_NAME = "EA_SOLVER_PORT";
const SOLVER_WORKER_REQUEST = "SOLVER_WORKER_REQUEST";
const SOLVER_WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";
// Accept the legacy response tag as an incoming request while older installed
// content scripts are still alive in already-open EA tabs.
const LEGACY_SOLVER_WORKER_REQUEST = SOLVER_WORKER_RESPONSE;
const BRIDGE_INJECT_REQUEST = "EA_PAGE_BRIDGE_INJECT";
const PRICE_BRIDGE_REQUEST = "EA_DATA_PRICE_REQUEST";
const FUTGG_PLAYERS_BRIDGE_REQUEST = "EA_DATA_FUTGG_PLAYERS_REQUEST";
const ALLOWED_BRIDGE_INJECT_PATHS = new Set(["page/ea-data-bridge.js"]);
const EA_WEBAPP_URL_RE =
  /^https:\/\/www\.ea\.com(?:\/[^/?#]+)?\/ea-sports-fc\/ultimate-team\/web-app(?:\/|$)/i;
const FUT_PRICE_API_URL = "https://www.fut.gg/api/fut/player-prices/26/";
const FUT_PLAYERS_API_URL = "https://www.fut.gg/api/fut/players/v2/26/";
const FUT_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const FUT_PRICE_ERROR_BACKOFF_MS = 20 * 1000;
const FUT_PRICE_BATCH_SIZE = 10;
const FUT_PRICE_MIN_GAP_MS = 450;
const FUT_PRICE_MAX_IDS_PER_REQUEST = 1000;
const FUT_PRICE_FETCH_TIMEOUT_MS = 10000;
const FUT_PRICE_RETRY_DELAY_MS = 900;
const FUT_PLAYERS_FETCH_TIMEOUT_MS = 12000;
const FUT_PLAYERS_TOTAL_DEADLINE_MS = 25000;
const FUT_PLAYERS_MIN_GAP_MS = 700;
const FUT_PLAYERS_MAX_PAGES = 5;
const FUT_PLAYERS_PRICE_GTE = 200;
const FUT_PLAYERS_ALLOWED_SORTS = new Set([
  "current_price",
  "-current_price",
  "overall",
  "-overall",
]);
const FUT_PLAYERS_ALLOWED_FILTERS = new Set([
  "club_id",
  "current_price__lte",
  "league_id",
  "nation_id",
  "overall__gte",
  "overall__lte",
  "price__gte",
  "price__lte",
  "rarity_id",
]);
import {
  buildSolverContext,
  solveSquad,
} from "./solver/solver.js?v=2026-02-22d";

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeRequestId = (value) => {
  const text = String(value ?? "").trim();
  return text && text.length <= 128 ? text : null;
};

const getSenderUrl = (sender) =>
  String(sender?.tab?.url || sender?.url || "");

const validateEaSender = (sender, { requireTab = true } = {}) => {
  if (sender?.id !== chrome.runtime.id) {
    return { code: "UNTRUSTED_SENDER", message: "Sender extension is not trusted" };
  }
  if (requireTab && !Number.isInteger(sender?.tab?.id)) {
    return { code: "INVALID_SENDER", message: "Missing sender tab" };
  }
  if (requireTab && sender?.frameId !== 0) {
    return { code: "INVALID_SENDER", message: "Only the top frame is allowed" };
  }
  const senderUrl = getSenderUrl(sender);
  if (requireTab && !EA_WEBAPP_URL_RE.test(senderUrl)) {
    return { code: "UNTRUSTED_SENDER", message: "Sender page is not allowed" };
  }
  return null;
};

const validateSolverPayload = (workerType, payload) => {
  if (workerType === "INIT") return null;
  if (workerType !== "SOLVE") {
    return {
      code: "SOLVER_OPERATION_UNSUPPORTED",
      message: `Unsupported solver operation: ${workerType || "<empty>"}`,
    };
  }
  if (!isRecord(payload)) {
    return { code: "SOLVER_PAYLOAD_INVALID", message: "SOLVE payload must be an object" };
  }
  if (
    payload.players != null &&
    (!Array.isArray(payload.players) || payload.players.length > 15000)
  ) {
    return {
      code: "SOLVER_PAYLOAD_INVALID",
      message: "Invalid or oversized players array",
    };
  }
  if (
    payload.requirementsNormalized != null &&
    (!Array.isArray(payload.requirementsNormalized) ||
      payload.requirementsNormalized.length > 500)
  ) {
    return { code: "SOLVER_PAYLOAD_INVALID", message: "Invalid requirements array" };
  }
  if (
    payload.squadSlots != null &&
    (!Array.isArray(payload.squadSlots) || payload.squadSlots.length > 64)
  ) {
    return { code: "SOLVER_PAYLOAD_INVALID", message: "Invalid squad slots array" };
  }
  return null;
};

let solverReadiness = null;
const probeSolverReadiness = () => {
  if (solverReadiness) return solverReadiness;
  try {
    if (
      typeof buildSolverContext !== "function" ||
      typeof solveSquad !== "function"
    ) {
      throw new Error("Solver entry points are unavailable");
    }
    const context = buildSolverContext({
      players: [],
      requirementsNormalized: [],
      requiredPlayers: 0,
    });
    const probe = solveSquad(context);
    if (!isRecord(context) || probe == null) {
      throw new Error("Solver readiness probe returned an invalid result");
    }
    solverReadiness = Object.freeze({
      ready: true,
      mode: "direct",
      engine: "local-js",
    });
  } catch (error) {
    solverReadiness = Object.freeze({
      ready: false,
      mode: "direct",
      engine: "local-js",
      error: error?.message || String(error),
    });
  }
  return solverReadiness;
};

console.log("[EA Data] Background loaded", {
  mode: "direct",
  workerAvailable: typeof Worker !== "undefined",
});

// Help diagnose MV3 service worker terminations/crashes.
try {
  self.addEventListener("unhandledrejection", (event) => {
    console.log("[EA Data] Background unhandledrejection", {
      reason: String(event?.reason?.message || event?.reason || ""),
    });
  });
  self.addEventListener("error", (event) => {
    console.log("[EA Data] Background error", {
      message: String(event?.message || ""),
      filename: event?.filename || null,
      lineno: event?.lineno || null,
      colno: event?.colno || null,
    });
  });
} catch {}

const handleSolverRequest = async (message, sendResponse) => {
  const payload = isRecord(message?.payload) ? message.payload : null;
  const workerType = String(payload?.type ?? "SOLVE").trim().toUpperCase();
  const workerPayload =
    payload?.payload ?? (workerType === "SOLVE" ? payload : null);
  try {
    if (workerType === "INIT") {
      const readiness = probeSolverReadiness();
      if (!readiness.ready) {
        sendResponse({
          ok: false,
          error: {
            code: "SOLVER_NOT_READY",
            message: readiness.error || "Solver readiness probe failed",
          },
        });
        return;
      }
      sendResponse({ ok: true, data: readiness });
      return;
    }
    const validationError = validateSolverPayload(workerType, workerPayload);
    if (validationError) {
      sendResponse({ ok: false, error: validationError });
      return;
    }
    const readiness = probeSolverReadiness();
    if (!readiness.ready) {
      sendResponse({
        ok: false,
        error: {
          code: "SOLVER_NOT_READY",
          message: readiness.error || "Solver is not ready",
        },
      });
      return;
    }
    const context = buildSolverContext(workerPayload);
    const result = solveSquad(context);
    sendResponse({ ok: true, data: result });
  } catch (error) {
    sendResponse({
      ok: false,
      error: {
        code: "SOLVER_BRIDGE_FAILED",
        message: error?.message || "Solver bridge failed",
      },
    });
  }
};

const handleBridgeInjectRequest = async (message, sender, sendResponse) => {
  const path = message?.payload?.path || "page/ea-data-bridge.js";
  const tabId = sender?.tab?.id;
  const frameId =
    Number.isInteger(sender?.frameId) && sender.frameId >= 0
      ? sender.frameId
      : 0;
  const senderUrl = getSenderUrl(sender);

  try {
    const senderError = validateEaSender(sender);
    if (senderError) throw new Error(senderError.message);
    if (!ALLOWED_BRIDGE_INJECT_PATHS.has(path)) {
      throw new Error("Bridge path not allowed");
    }
    if (frameId !== 0) {
      throw new Error("Bridge injection only allowed in top frame");
    }
    if (!EA_WEBAPP_URL_RE.test(senderUrl)) {
      throw new Error("Bridge injection not allowed for this page");
    }
    if (!chrome?.scripting?.executeScript) {
      throw new Error("chrome.scripting.executeScript is unavailable");
    }
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [path],
      world: "MAIN",
    });
    sendResponse({
      ok: true,
      data: {
        injected: true,
        path,
        tabId,
        frameId: 0,
        senderUrl: senderUrl || null,
      },
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: {
        code: "PAGE_BRIDGE_INJECT_FAILED",
        message: error?.message || String(error),
        path,
        tabId: tabId ?? null,
        frameId,
        senderUrl: senderUrl || null,
      },
    });
  }
};

const futPriceCache = new Map();
let futPriceQueue = Promise.resolve();
let futPriceLastFetchAt = 0;
let futPlayersQueue = Promise.resolve();
let futPlayersLastFetchAt = 0;

const normalizePriceIds = (ids) => {
  const source = Array.isArray(ids) ? ids : [];
  const normalized = [];
  const seen = new Set();
  for (const raw of source) {
    const text = String(raw ?? "").trim();
    if (!text || seen.has(text)) continue;
    if (!/^\d+$/.test(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= FUT_PRICE_MAX_IDS_PER_REQUEST) break;
  }
  return normalized;
};

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const paceFutPriceFetch = async () => {
  const waitMs = futPriceLastFetchAt + FUT_PRICE_MIN_GAP_MS - Date.now();
  if (waitMs > 0) await delayMs(waitMs);
  futPriceLastFetchAt = Date.now();
};

const markFutPriceBatchError = (ids, reason = null) => {
  const now = Date.now();
  for (const id of ids || []) {
    futPriceCache.set(String(id), {
      eaId: String(id),
      price: null,
      missing: true,
      transient: true,
      error: reason ? String(reason) : null,
      cachedAt: now,
      retryAfter: now + FUT_PRICE_ERROR_BACKOFF_MS,
    });
  }
};

const isFreshFutPriceCacheEntry = (cached, now = Date.now()) => {
  if (!cached) return false;
  if (cached.transient || cached.error) {
    const retryAfter = Number(cached.retryAfter) ||
      (Number(cached.cachedAt) || 0) + FUT_PRICE_ERROR_BACKOFF_MS;
    return now < retryAfter;
  }
  return now - (Number(cached.cachedAt) || 0) <= FUT_PRICE_CACHE_TTL_MS;
};

const fetchFutPriceBatchOnce = async (ids) => {
  await paceFutPriceFetch();
  const url = new URL(FUT_PRICE_API_URL);
  url.searchParams.set("ids", ids.join(","));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, FUT_PRICE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok)
    throw new Error(`FUT.GG price request failed (${response.status})`);
  const json = await response.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  const now = Date.now();
  const returnedIds = new Set();
  for (const row of rows) {
    const id = String(row?.eaId ?? "").trim();
    if (!id) continue;
    returnedIds.add(id);
    futPriceCache.set(id, {
      eaId: id,
      platform: row?.platform ?? null,
      price: Number.isFinite(Number(row?.price)) ? Number(row.price) : null,
      isExtinct: Boolean(row?.isExtinct),
      isSbc: Boolean(row?.isSbc),
      isObjective: Boolean(row?.isObjective),
      isUntradeable: Boolean(row?.isUntradeable),
      priceUpdatedAt: row?.priceUpdatedAt ?? null,
      cachedAt: now,
    });
  }
  for (const id of ids) {
    if (!returnedIds.has(String(id))) {
      futPriceCache.set(id, {
        eaId: id,
        price: null,
        missing: true,
        cachedAt: now,
      });
    }
  }
};

const fetchFutPriceBatch = async (ids) => {
  try {
    await fetchFutPriceBatchOnce(ids);
    return { ok: true, ids };
  } catch (firstError) {
    try {
      await delayMs(FUT_PRICE_RETRY_DELAY_MS);
      await fetchFutPriceBatchOnce(ids);
      return { ok: true, ids, retried: true };
    } catch (secondError) {
      const message =
        secondError?.name === "AbortError"
          ? "FUT.GG price request timed out"
          : secondError?.message || firstError?.message || "FUT.GG price request failed";
      markFutPriceBatchError(ids, message);
      return { ok: false, ids, error: message };
    }
  }
};

const handlePriceRequest = (message, sendResponse) => {
  if (!isRecord(message?.payload) || !Array.isArray(message.payload.ids)) {
    sendResponse({
      ok: false,
      error: { code: "FUT_PRICE_PAYLOAD_INVALID", message: "Price ids must be an array" },
    });
    return;
  }
  const ids = normalizePriceIds(message?.payload?.ids);
  const requestId = normalizeRequestId(message?.payload?.requestId);
  const now = Date.now();
  const missing = ids.filter((id) =>
    !isFreshFutPriceCacheEntry(futPriceCache.get(id), now),
  );
  console.log("[EA Data] Price request received", {
    requestId,
    requestedCount: ids.length,
    missingCount: missing.length,
  });

  futPriceQueue = futPriceQueue
    .catch(() => {})
    .then(async () => {
      const errors = [];
      for (let index = 0; index < missing.length; index += FUT_PRICE_BATCH_SIZE) {
        const batch = missing.slice(index, index + FUT_PRICE_BATCH_SIZE);
        if (!batch.length) continue;
        console.log("[EA Data] Price batch start", {
          requestId,
          batchIndex: Math.floor(index / FUT_PRICE_BATCH_SIZE) + 1,
          batchCount: batch.length,
          ids: batch,
        });
        const batchResult = await fetchFutPriceBatch(batch);
        console.log("[EA Data] Price batch done", {
          requestId,
          ok: Boolean(batchResult?.ok),
          batchCount: batch.length,
          error: batchResult?.error ?? null,
        });
        if (!batchResult?.ok) {
          errors.push({
            ids: batch,
            message: batchResult?.error ?? "FUT.GG price request failed",
          });
        }
      }
      const prices = {};
      for (const id of ids) {
        const cached = futPriceCache.get(id);
        if (cached) prices[id] = cached;
      }
      console.log("[EA Data] Price request complete", {
        requestId,
        requestedCount: ids.length,
        returnedCount: Object.keys(prices).length,
        errorCount: errors.length,
      });
      sendResponse({
        ok: true,
        data: {
          prices,
          requestedCount: ids.length,
          fetchedCount: missing.length,
          errorCount: errors.length,
          errors,
          cacheTtlMs: FUT_PRICE_CACHE_TTL_MS,
        },
      });
    })
    .catch((error) => {
      console.log("[EA Data] Price request failed", {
        requestId,
        message: error?.message || String(error),
      });
      sendResponse({
        ok: false,
        error: {
          code: "FUT_PRICE_REQUEST_FAILED",
          message: error?.message || "FUT.GG price request failed",
        },
      });
    });
};

const normalizeFutPlayersRequest = (payload = {}) => {
  const pagesRaw = Number(payload?.pages);
  const pages = Number.isFinite(pagesRaw)
    ? Math.max(1, Math.min(FUT_PLAYERS_MAX_PAGES, Math.floor(pagesRaw)))
    : 2;
  const rarityIds = Array.isArray(payload?.rarityIds)
    ? payload.rarityIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 6)
    : [];
  const priceGteRaw = Number(payload?.priceGte);
  const priceGte = Number.isFinite(priceGteRaw)
    ? Math.max(0, Math.floor(priceGteRaw))
    : FUT_PLAYERS_PRICE_GTE;
  const sorts = String(payload?.sorts || "current_price").trim();
  const rawFilters =
    payload?.filters && typeof payload.filters === "object"
      ? payload.filters
      : {};
  const filters = {};
  for (const [key, value] of Object.entries(rawFilters)) {
    if (!FUT_PLAYERS_ALLOWED_FILTERS.has(key)) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    filters[key] = Math.floor(numeric);
  }
  return { pages, rarityIds, priceGte, sorts, filters };
};

const validateFutPlayersPayload = (payload) => {
  if (!isRecord(payload)) {
    return { code: "FUTGG_PLAYERS_PAYLOAD_INVALID", message: "Players payload must be an object" };
  }
  if (payload.rarityIds != null && !Array.isArray(payload.rarityIds)) {
    return { code: "FUTGG_PLAYERS_PAYLOAD_INVALID", message: "rarityIds must be an array" };
  }
  if (payload.filters != null && !isRecord(payload.filters)) {
    return { code: "FUTGG_PLAYERS_PAYLOAD_INVALID", message: "filters must be an object" };
  }
  const sorts = String(payload.sorts || "current_price").trim();
  if (!FUT_PLAYERS_ALLOWED_SORTS.has(sorts)) {
    return {
      code: "FUTGG_PLAYERS_SORT_INVALID",
      message: `Unsupported FUT.GG sort: ${sorts || "<empty>"}`,
    };
  }
  return null;
};

const createFutPlayersDeadlineError = () => {
  const error = new Error("FUT.GG players request deadline exceeded");
  error.code = "FUTGG_PLAYERS_DEADLINE_EXCEEDED";
  return error;
};

const isFutPlayersDeadlineError = (error) =>
  error?.code === "FUTGG_PLAYERS_DEADLINE_EXCEEDED";

const fetchFutPlayersPage = async ({
  page,
  rarityId,
  priceGte,
  sorts,
  filters = {},
  deadlineAt,
  signal,
}) => {
  if (signal?.aborted || Date.now() >= deadlineAt) {
    throw createFutPlayersDeadlineError();
  }
  const paceWaitMs = futPlayersLastFetchAt + FUT_PLAYERS_MIN_GAP_MS - Date.now();
  if (paceWaitMs > 0) {
    if (Date.now() + paceWaitMs >= deadlineAt) {
      throw createFutPlayersDeadlineError();
    }
    await delayMs(paceWaitMs);
  }
  if (signal?.aborted || Date.now() >= deadlineAt) {
    throw createFutPlayersDeadlineError();
  }
  futPlayersLastFetchAt = Date.now();
  const url = new URL(FUT_PLAYERS_API_URL);
  url.searchParams.set("page", String(page));
  if (rarityId != null) url.searchParams.set("rarity_id", String(rarityId));
  url.searchParams.set("price__gte", String(priceGte));
  for (const [key, value] of Object.entries(filters)) {
    if (key === "rarity_id" || key === "price__gte") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("sorts", sorts);
  const controller = new AbortController();
  const abortForDeadline = () => controller.abort();
  signal?.addEventListener("abort", abortForDeadline, { once: true });
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, Math.min(FUT_PLAYERS_FETCH_TIMEOUT_MS, remainingMs));
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortForDeadline);
  }
  if (signal?.aborted || Date.now() >= deadlineAt) {
    throw createFutPlayersDeadlineError();
  }
  if (!response.ok)
    throw new Error(`FUT.GG players request failed (${response.status})`);
  return response.json();
};

const handleFutPlayersRequest = (message, sendResponse) => {
  const payloadError = validateFutPlayersPayload(message?.payload);
  if (payloadError) {
    sendResponse({ ok: false, error: payloadError });
    return;
  }
  const requestId = normalizeRequestId(message?.payload?.requestId);
  const params = normalizeFutPlayersRequest(message.payload);
  const deadlineAt = Date.now() + FUT_PLAYERS_TOTAL_DEADLINE_MS;
  const deadlineController = new AbortController();
  const rows = [];
  const errors = [];
  let completed = false;

  const respondOnce = (response) => {
    if (completed) return false;
    completed = true;
    sendResponse(response);
    return true;
  };

  const buildResponseData = ({ timedOut = false } = {}) => ({
    rows: rows.slice(),
    requestedRarityIds: params.rarityIds,
    pages: params.pages,
    priceGte: params.priceGte,
    sorts: params.sorts,
    filters: params.filters,
    rowCount: rows.length,
    errorCount: errors.length,
    errors: errors.slice(),
    timedOut,
    deadlineMs: FUT_PLAYERS_TOTAL_DEADLINE_MS,
  });

  const deadlineTimer = setTimeout(() => {
    deadlineController.abort();
    respondOnce({ ok: true, data: buildResponseData({ timedOut: true }) });
  }, FUT_PLAYERS_TOTAL_DEADLINE_MS);

  console.log("[EA Data] FUT.GG players request received", {
    requestId,
    pages: params.pages,
    rarityIds: params.rarityIds,
    priceGte: params.priceGte,
    sorts: params.sorts,
    filters: params.filters,
  });

  futPlayersQueue = futPlayersQueue
    .catch(() => {})
    .then(async () => {
      if (deadlineController.signal.aborted || Date.now() >= deadlineAt) return;
      const rarityIds = params.rarityIds.length ? params.rarityIds : [null];
      let timedOut = false;
      rarityLoop: for (const rarityId of rarityIds) {
        for (let page = 1; page <= params.pages; page += 1) {
          if (deadlineController.signal.aborted || Date.now() >= deadlineAt) {
            timedOut = true;
            break rarityLoop;
          }
          try {
            const json = await fetchFutPlayersPage({
              page,
              rarityId,
              priceGte: params.priceGte,
              sorts: params.sorts,
              filters: params.filters,
              deadlineAt,
              signal: deadlineController.signal,
            });
            const pageRows = Array.isArray(json?.data) ? json.data : [];
            rows.push(...pageRows);
            console.log("[EA Data] FUT.GG players page", {
              requestId,
              rarityId,
              page,
              count: pageRows.length,
            });
            if (!pageRows.length) break;
          } catch (error) {
            if (isFutPlayersDeadlineError(error) || deadlineController.signal.aborted) {
              timedOut = true;
            }
            errors.push({
              rarityId,
              page,
              code: error?.code || null,
              message: error?.message || String(error),
            });
            if (timedOut) break rarityLoop;
            break;
          }
        }
      }
      respondOnce({ ok: true, data: buildResponseData({ timedOut }) });
    })
    .catch((error) => {
      respondOnce({
        ok: false,
        error: {
          code: "FUTGG_PLAYERS_REQUEST_FAILED",
          message: error?.message || "FUT.GG players request failed",
        },
      });
    })
    .finally(() => {
      clearTimeout(deadlineTimer);
    });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRecord(message)) return false;
  const knownType =
    message.type === BRIDGE_INJECT_REQUEST ||
    message.type === PRICE_BRIDGE_REQUEST ||
    message.type === FUTGG_PLAYERS_BRIDGE_REQUEST ||
    message.type === SOLVER_BRIDGE_REQUEST;
  if (!knownType) return false;

  const senderError = validateEaSender(sender);
  if (senderError) {
    sendResponse({ ok: false, error: senderError });
    return false;
  }

  if (message?.type === BRIDGE_INJECT_REQUEST) {
    handleBridgeInjectRequest(message, sender, sendResponse);
    return true;
  }
  if (message?.type === PRICE_BRIDGE_REQUEST) {
    handlePriceRequest(message, sendResponse);
    return true;
  }
  if (message?.type === FUTGG_PLAYERS_BRIDGE_REQUEST) {
    handleFutPlayersRequest(message, sendResponse);
    return true;
  }
  console.log("[EA Data] Background request", {
    type: message?.payload?.type ?? null,
    debug: message?.payload?.payload?.debug ?? null,
  });
  handleSolverRequest(message, sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== SOLVER_PORT_NAME) return;
  const senderError = validateEaSender(port.sender);
  if (senderError) {
    try {
      port.postMessage({
        type: SOLVER_WORKER_RESPONSE,
        requestId: null,
        ok: false,
        error: senderError,
      });
    } catch {}
    try {
      port.disconnect();
    } catch {}
    return;
  }

  port.onMessage.addListener((msg) => {
    if (!isRecord(msg)) return;
    if (
      msg.type !== SOLVER_WORKER_REQUEST &&
      msg.type !== LEGACY_SOLVER_WORKER_REQUEST
    ) {
      return;
    }
    const requestId = normalizeRequestId(msg.requestId);
    const workerType = String(msg.workerType ?? "SOLVE").trim().toUpperCase();
    const workerPayload = msg.payload ?? null;
    if (!requestId) {
      try {
        port.postMessage({
          type: SOLVER_WORKER_RESPONSE,
          requestId: null,
          ok: false,
          error: { code: "SOLVER_REQUEST_INVALID", message: "Missing request id" },
        });
      } catch {}
      return;
    }

    handleSolverRequest(
      { payload: { type: workerType, payload: workerPayload } },
      (response) => {
        try {
          port.postMessage({
            type: SOLVER_WORKER_RESPONSE,
            requestId,
            ...(response || {}),
          });
        } catch {}
      },
    );
  });
});
