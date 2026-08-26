const SOLVER_BRIDGE_REQUEST = "EA_SOLVER_REQUEST";
const SOLVER_PORT_NAME = "EA_SOLVER_PORT";
const SOLVER_WORKER_REQUEST = "SOLVER_WORKER_REQUEST";
const SOLVER_WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";
// Accept the legacy response tag as an incoming request while older installed
// content scripts are still alive in already-open EA tabs.
const LEGACY_SOLVER_WORKER_REQUEST = SOLVER_WORKER_RESPONSE;
const BRIDGE_INJECT_REQUEST = "EA_PAGE_BRIDGE_INJECT";
const GRINDPILOT_RPC_INSTALL_REQUEST = "EA_GRINDPILOT_RPC_INSTALL";
const GRINDPILOT_RPC_CALL_REQUEST = "EA_GRINDPILOT_RPC_CALL_V2";
const grindPilotRpcSecrets = new Map();
const PRICE_BRIDGE_REQUEST = "EA_DATA_PRICE_REQUEST";
const FUTGG_PLAYERS_BRIDGE_REQUEST = "EA_DATA_FUTGG_PLAYERS_REQUEST";
const GP_STATE_COMMAND = "GRINDPILOT_STATE_COMMAND_V2";
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
} from "./solver/solver.js?v=2026-08-26a";
import { normalizeProfile } from "./src/profiles/profile-service.js";
import { normalizeWorkflowDefinition } from "./src/workflow/definitions.js";

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

export const installGrindPilotMainWorldRpc = (secret) => {
  if (window.__grindPilotEaRpcInstalled) return;
  if (typeof secret !== "string" || secret.length < 32) throw new Error("EA RPC secret missing");
  const methods = new Set([
    "getHealth", "getCapabilityHealth", "getContext", "readInventory", "readCurrentSbcProject", "findSbcTarget", "readLegacySequences", "solveCurrentSbc",
    "submitCurrentSbc", "listOwnedRewardPacks", "claimCurrentReward",
    "openOwnedRewardPack", "resolveUnassigned", "readPlayerPick",
    "selectPlayerPick", "openSequencePlanner", "organizeIntoSbc", "readSbcChallengeState",
  ]);
  const cloneSafe = (root) => {
    const seen = new WeakSet();
    let visited = 0;
    const copy = (value, depth = 0) => {
      if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
      if (["function", "symbol", "undefined", "bigint"].includes(typeof value)) return undefined;
      if (depth > 32 || ++visited > 20_000) return null;
      if (typeof value !== "object") return String(value);
      if (seen.has(value)) return null;
      seen.add(value);
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      const output = Array.isArray(value) ? [] : {};
      let keys = [];
      try { keys = Object.getOwnPropertyNames(value).slice(0, 500); } catch { return null; }
      for (const key of keys) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { continue; }
        if (!descriptor || !("value" in descriptor)) continue;
        const next = copy(descriptor.value, depth + 1);
        if (next === undefined) continue;
        if (Array.isArray(output) && /^\d+$/.test(key)) output[Number(key)] = next;
        else output[key] = next;
      }
      return output;
    };
    return copy(root);
  };
  const api = window.eaData?.grindPilot;
  if (!api) throw new Error("EA operation bridge unavailable");
  const encoder = new TextEncoder();
  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const keyPromise = crypto.subtle.importKey("raw", fromBase64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const used = new Set();
  const invoke = async (ticket) => {
    const requestId = String(ticket?.requestId ?? "");
    const method = String(ticket?.method ?? "");
    const expiresAt = Number(ticket?.expiresAt ?? 0);
    const payloadJson = String(ticket?.payloadJson ?? "null");
    if (!requestId || !methods.has(method) || used.has(requestId) || expiresAt < Date.now() || expiresAt > Date.now() + 30_000)
      throw new Error("EA RPC capability rejected");
    const signed = `${requestId}\n${method}\n${expiresAt}\n${payloadJson}`;
    const valid = await crypto.subtle.verify("HMAC", await keyPromise, fromBase64(String(ticket?.signature ?? "")), encoder.encode(signed));
    if (!valid) throw new Error("EA RPC capability signature invalid");
    used.add(requestId);
    if (used.size > 1000) used.delete(used.values().next().value);
    try {
      const target = method === "openSequencePlanner"
        ? window.eaData
        : api;
      const operation = target?.[method];
      if (typeof operation !== "function") throw new Error(`EA operation unavailable: ${method}`);
      const value = await operation(JSON.parse(payloadJson));
      return { ok: true, value: cloneSafe(value) };
    } catch (error) {
      return { ok: false, error: {
        code: error?.code || "EA_RPC_FAILED",
        message: error?.message || "EA operation failed",
      } };
    }
  };
  Object.defineProperty(window, "__grindPilotEaRpcBrokerV2", { value: Object.freeze({ invoke }), writable: false, configurable: false });
  const safeNames = ["getHealth", "getCapabilityHealth", "getContext", "readInventory", "readCurrentSbcProject", "findSbcTarget", "readLegacySequences", "listOwnedRewardPacks", "readPlayerPick", "readSbcChallengeState"];
  window.eaData.grindPilot = Object.freeze(Object.fromEntries(safeNames.filter((name) => typeof api[name] === "function").map((name) => [name, api[name]])));
  window.__grindPilotEaRpcInstalled = true;
};

const gpBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const gpRpcSecret = async (tabId) => {
  let secret = grindPilotRpcSecrets.get(tabId);
  const storageKey = `grindpilot.rpc.secret.${tabId}`;
  if (!secret && chrome.storage?.session) {
    const stored = await chrome.storage.session.get(storageKey);
    if (typeof stored?.[storageKey] === "string" && stored[storageKey].length >= 32) secret = stored[storageKey];
  }
  if (!secret) secret = gpBase64(crypto.getRandomValues(new Uint8Array(32)));
  grindPilotRpcSecrets.set(tabId, secret);
  if (chrome.storage?.session) await chrome.storage.session.set({ [storageKey]: secret });
  return secret;
};
const gpSignRpcTicket = async (secret, ticket) => {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret), (char) => char.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = `${ticket.requestId}\n${ticket.method}\n${ticket.expiresAt}\n${ticket.payloadJson}`;
  return gpBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
};

const handleGrindPilotRpcInstallRequest = async (sender, sendResponse) => {
  try {
    const secret = await gpRpcSecret(sender.tab.id);
    const result = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] },
      world: "MAIN",
      injectImmediately: true,
      func: installGrindPilotMainWorldRpc,
      args: [secret],
    });
    sendResponse({ ok: true, data: { installed: true, results: result?.length ?? 0 } });
  } catch (error) {
    sendResponse({ ok: false, error: { code: "EA_RPC_INSTALL_FAILED", message: error?.message || "EA RPC installation failed" } });
  }
};

const handleGrindPilotRpcCallRequest = async (message, sender, sendResponse) => {
  const methods = new Set(["getHealth","getCapabilityHealth","getContext","readInventory","readCurrentSbcProject","findSbcTarget","readLegacySequences","solveCurrentSbc","organizeIntoSbc","readSbcChallengeState","submitCurrentSbc","listOwnedRewardPacks","claimCurrentReward","openOwnedRewardPack","resolveUnassigned","readPlayerPick","selectPlayerPick","openSequencePlanner"]);
  try {
    const requestId = String(message?.requestId ?? "");
    const method = String(message?.method ?? "");
    if (!requestId || !methods.has(method)) throw new Error("EA RPC method forbidden");
    const payload = message?.payload ?? null;
    const requireText = (value, field) => { if (!String(value ?? "").trim()) throw new Error(`EA RPC intent missing ${field}`); };
    const requireArray = (value, field) => { if (!Array.isArray(value)) throw new Error(`EA RPC intent missing ${field}`); };
    if (method === "submitCurrentSbc") { requireText(payload?.expectedChallengeId, "expectedChallengeId"); requireArray(payload?.expectedItemIds, "expectedItemIds"); requireArray(payload?.protectedItemIds, "protectedItemIds"); }
    if (method === "organizeIntoSbc") { requireText(payload?.challengeId, "challengeId"); requireArray(payload?.requiredItemIds, "requiredItemIds"); requireArray(payload?.protectedItemIds, "protectedItemIds"); }
    if (method === "openOwnedRewardPack") requireText(payload?.packId, "packId");
    if (method === "claimCurrentReward") requireArray(payload?.beforePacks, "beforePacks");
    if (method === "resolveUnassigned") requireArray(payload?.expectedActions, "expectedActions");
    if (method === "selectPlayerPick") { requireText(payload?.pickIdentity, "pickIdentity"); requireText(payload?.itemId, "itemId"); }
    const payloadJson = JSON.stringify(message?.payload ?? null);
    if (payloadJson.length > 250_000) throw new Error("EA RPC payload too large");
    const ticket = { requestId, method, expiresAt: Date.now() + 15_000, payloadJson };
    ticket.signature = await gpSignRpcTicket(await gpRpcSecret(sender.tab.id), ticket);
    const result = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [0] }, world: "MAIN", injectImmediately: true,
      func: async (capability) => {
        const broker = window.__grindPilotEaRpcBrokerV2;
        if (!broker?.invoke) throw new Error("EA RPC broker unavailable");
        return broker.invoke(capability);
      }, args: [ticket] });
    sendResponse(result?.[0]?.result ?? { ok: false, error: { code: "EA_RPC_EMPTY", message: "EA RPC returned no result" } });
  } catch (error) {
    sendResponse({ ok: false, error: { code: "EA_RPC_FAILED", message: error?.message || "EA RPC failed" } });
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

const GP_KEYS = Object.freeze({
  activeRun: "grindpilot.activeRun.v1",
  activity: "grindpilot.activity.v1",
  profiles: "grindpilot.profiles.v1",
  projects: "grindpilot.projects.v1",
  settings: "grindpilot.settings.v1",
});
const GP_MAX_STATE_BYTES = 2 * 1024 * 1024;
const GP_LEASE_MS = 15 * 60_000;
const GP_TERMINAL_STATUSES = new Set(["completed", "stopped", "failed"]);
const GP_RUN_STATUSES = new Set([
  "running", "waiting", "paused", "stopping", "stopped", "completed",
  "failed", "recovery_required",
]);
const GP_SETTINGS_FIELDS = new Set([
  "mode", "maxIterations", "storageCapacity", "protectRatingAtOrAbove",
  "protectedCardTypes", "protectedItemIds", "protectedPlayerIds",
  "protectedResourceIds", "protectStartingSquad", "protectFavorites",
  "protectTradables", "preferUntradeables", "preferDuplicates",
  "preferSbcStorage", "minimumReserveByRating", "preferredFodderRange",
  "protectedRatings", "allowedSpecialTypes", "specialReserveByCardType",
  "packMode", "maxPacks",
  "pickMode", "stopConditions", "solverSettings", "duplicatePolicy",
  "packPolicy", "pickPolicy", "workflow", "runLimits", "loadedProfileId",
  "profileCeilings",
]);
const GP_BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
let grindPilotStateQueue = Promise.resolve();

const gpStateError = (code, message, details = null) =>
  Object.assign(new Error(message), { code, details });

const gpStorageGet = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(gpStateError("GP_STATE_STORAGE_FAILED", error.message));
      else resolve(items ?? {});
    });
  });

const gpStorageSet = (entries) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(gpStateError("GP_STATE_STORAGE_FAILED", error.message));
      else resolve(true);
    });
  });

const gpStorageRemove = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(gpStateError("GP_STATE_STORAGE_FAILED", error.message));
      else resolve(true);
    });
  });

const gpCloneJson = (value, label = "State value") => {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw gpStateError("GP_STATE_INVALID", `${label} must be JSON serializable`);
  }
  if (encoded === undefined) {
    throw gpStateError("GP_STATE_INVALID", `${label} must be JSON serializable`);
  }
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (bytes > GP_MAX_STATE_BYTES) {
    throw gpStateError("GP_STATE_TOO_LARGE", `${label} exceeds the 2 MiB limit`);
  }
  const clone = JSON.parse(encoded);
  const visit = (entry, depth = 0) => {
    if (depth > 64) throw gpStateError("GP_STATE_INVALID", `${label} is too deeply nested`);
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry)) {
      if (GP_BLOCKED_KEYS.has(key)) {
        throw gpStateError("GP_STATE_INVALID", `${label} contains a blocked key`);
      }
      visit(child, depth + 1);
    }
  };
  visit(clone);
  return clone;
};

const gpSafeId = (value, label) => {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) {
    throw gpStateError("GP_STATE_INVALID", `${label} is invalid`);
  }
  return id;
};

const gpValidateSettings = (value) => {
  const settings = gpCloneJson(value, "Settings");
  if (!isRecord(settings)) throw gpStateError("GP_STATE_INVALID", "Settings must be an object");
  for (const key of Object.keys(settings)) {
    if (!GP_SETTINGS_FIELDS.has(key)) {
      throw gpStateError("GP_STATE_INVALID", `Unsupported settings field: ${key}`);
    }
  }
  if (settings.workflow != null) settings.workflow = normalizeWorkflowDefinition(settings.workflow);
  if (settings.runLimits != null) {
    const limits = settings.runLimits;
    if (!isRecord(limits) || !Number.isSafeInteger(limits.maxIterations) || limits.maxIterations < 1 || limits.maxIterations > 10_000) {
      throw gpStateError("GP_STATE_INVALID", "runLimits.maxIterations is invalid");
    }
    for (const field of ["maxSbcSubmissions", "maxPacksOpened", "maxDurationMinutes"]) {
      if (limits[field] != null && (!Number.isSafeInteger(limits[field]) || limits[field] < 1)) {
        throw gpStateError("GP_STATE_INVALID", `runLimits.${field} is invalid`);
      }
    }
  }
  if (settings.duplicatePolicy?.quicksell === true) {
    throw gpStateError("GP_STATE_INVALID", "Implicit quicksell cannot be persisted");
  }
  return settings;
};

const gpValidateActivity = (value) => {
  const activity = gpCloneJson(value, "Activity");
  if (!Array.isArray(activity) || activity.length > 500 || activity.some((entry) => !isRecord(entry))) {
    throw gpStateError("GP_STATE_INVALID", "Activity must contain at most 500 records");
  }
  return activity;
};

const gpValidateProjects = (value) => {
  const projects = gpCloneJson(value, "Target projects");
  if (!Array.isArray(projects) || projects.length > 100) {
    throw gpStateError("GP_STATE_INVALID", "Target projects must contain at most 100 records");
  }
  for (const project of projects) {
    if (!isRecord(project)) throw gpStateError("GP_STATE_INVALID", "Target project must be an object");
    gpSafeId(project.id, "Target project id");
    if (typeof project.name !== "string" || !project.name.trim() || project.name.length > 120) {
      throw gpStateError("GP_STATE_INVALID", "Target project name is invalid");
    }
  }
  return projects;
};

const gpValidateRun = (value) => {
  const run = gpCloneJson(value, "Workflow run");
  if (!isRecord(run)) throw gpStateError("GP_RUN_INVALID", "Workflow run must be an object");
  gpSafeId(run.runId, "Workflow run id");
  if (!Number.isSafeInteger(run.revision) || run.revision < 0) {
    throw gpStateError("GP_RUN_INVALID", "Workflow revision is invalid");
  }
  if (!GP_RUN_STATUSES.has(String(run.status))) {
    throw gpStateError("GP_RUN_INVALID", "Workflow status is invalid");
  }
  run.definition = normalizeWorkflowDefinition(run.definition);
  if (!Array.isArray(run.nodes) || run.nodes.length > 10_000) {
    throw gpStateError("GP_RUN_INVALID", "Workflow execution nodes are invalid");
  }
  return run;
};

const gpNormalizeRunRecord = (stored) => {
  if (!stored) return null;
  if (isRecord(stored) && isRecord(stored.run)) {
    return { run: gpValidateRun(stored.run), lease: isRecord(stored.lease) ? stored.lease : null };
  }
  return { run: gpValidateRun(stored), lease: null };
};

const gpCaller = (sender, ownerValue) => ({
  tabId: sender.tab.id,
  ownerId: gpSafeId(ownerValue, "Workflow owner id"),
});

const gpIsMissingTabError = (error) =>
  /^No tab with id\b/i.test(String(error?.message ?? error ?? "").trim());

const gpIsTabGone = (tabId) => {
  if (!Number.isInteger(tabId) || typeof chrome.tabs?.get !== "function") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (gone) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(gone === true);
    };
    timeoutId = setTimeout(() => finish(false), 1000);
    try {
      const pending = chrome.tabs.get(tabId, () => {
        const error = chrome.runtime?.lastError;
        finish(error ? gpIsMissingTabError(error) : false);
      });
      if (pending && typeof pending.then === "function") {
        pending.then(
          () => finish(false),
          (error) => finish(gpIsMissingTabError(error)),
        );
      }
    } catch (error) {
      finish(gpIsMissingTabError(error));
    }
  });
};

const gpAssertOrClaimOwner = (
  record,
  caller,
  { allowClaim = false, ownerTabGone = false } = {},
) => {
  const now = Date.now();
  const lease = record.lease;
  const ownedByCaller =
    lease?.tabId === caller.tabId && lease?.ownerId === caller.ownerId;
  const sameTab = lease?.tabId === caller.tabId;
  const expired =
    !Number.isFinite(Number(lease?.expiresAt)) || Number(lease.expiresAt) <= now;
  if (
    !ownedByCaller &&
    !(allowClaim && (sameTab || expired || ownerTabGone || !lease))
  ) {
    throw gpStateError(
      "WORKFLOW_OWNED_BY_OTHER_TAB",
      "This active workflow is owned by another EA Web App tab",
      { ownerTabId: lease?.tabId ?? null, leaseExpiresAt: lease?.expiresAt ?? null },
    );
  }
  record.lease = { ...caller, expiresAt: now + GP_LEASE_MS };
  return record;
};

const gpReadRunRecord = async () => {
  const stored = await gpStorageGet([GP_KEYS.activeRun]);
  return gpNormalizeRunRecord(stored[GP_KEYS.activeRun] ?? null);
};

const gpWriteRunRecord = (record) =>
  gpStorageSet({ [GP_KEYS.activeRun]: gpCloneJson(record, "Workflow record") });

const gpHandleStateAction = async (action, payload, sender) => {
  const input = isRecord(payload) ? payload : {};
  if (action === "BOOTSTRAP_LOAD") {
    const stored = await gpStorageGet([GP_KEYS.activity, GP_KEYS.projects, GP_KEYS.settings]);
    const safeStored = (validator, value, fallback) => {
      try { return validator(value); } catch { return fallback; }
    };
    return {
      activity: safeStored(gpValidateActivity, stored[GP_KEYS.activity] ?? [], []),
      projects: safeStored(gpValidateProjects, stored[GP_KEYS.projects] ?? [], []),
      settings: safeStored(gpValidateSettings, stored[GP_KEYS.settings] ?? {}, {}),
    };
  }
  if (action === "SETTINGS_SAVE") {
    await gpStorageSet({ [GP_KEYS.settings]: gpValidateSettings(input.value) });
    return true;
  }
  if (action === "ACTIVITY_SAVE") {
    await gpStorageSet({ [GP_KEYS.activity]: gpValidateActivity(input.value) });
    return true;
  }
  if (action === "PROJECTS_SAVE") {
    await gpStorageSet({ [GP_KEYS.projects]: gpValidateProjects(input.value) });
    return true;
  }
  if (["PROFILE_LIST", "PROFILE_GET", "PROFILE_PUT", "PROFILE_DELETE"].includes(action)) {
    const stored = await gpStorageGet([GP_KEYS.profiles]);
    const profiles = isRecord(stored[GP_KEYS.profiles]) ? stored[GP_KEYS.profiles] : {};
    if (action === "PROFILE_LIST") return Object.values(profiles).map((profile) => normalizeProfile(profile));
    const id = gpSafeId(input.id ?? input.profile?.id, "Profile id");
    if (action === "PROFILE_GET") return profiles[id] ? normalizeProfile(profiles[id]) : null;
    if (action === "PROFILE_PUT") {
      const profile = normalizeProfile(input.profile);
      profiles[id] = profile;
      await gpStorageSet({ [GP_KEYS.profiles]: gpCloneJson(profiles, "Profiles") });
      return profile;
    }
    if (!Object.hasOwn(profiles, id)) return false;
    delete profiles[id];
    if (Object.keys(profiles).length) await gpStorageSet({ [GP_KEYS.profiles]: profiles });
    else await gpStorageRemove([GP_KEYS.profiles]);
    return true;
  }

  const caller = gpCaller(sender, input.ownerId);
  if (action === "RUN_CREATE") {
    const run = gpValidateRun(input.run);
    const existing = await gpReadRunRecord();
    if (existing && !GP_TERMINAL_STATUSES.has(existing.run.status)) {
      throw gpStateError("WORKFLOW_ALREADY_ACTIVE", "A workflow run is already active");
    }
    const record = gpAssertOrClaimOwner({ run, lease: null }, caller, { allowClaim: true });
    await gpWriteRunRecord(record);
    return record.run;
  }
  const record = await gpReadRunRecord();
  if (!record) return null;
  if (action === "RUN_LOAD_ACTIVE" || action === "RUN_LOAD") {
    if (action === "RUN_LOAD" && String(record.run.runId) !== String(input.runId)) return null;
    if (!GP_TERMINAL_STATUSES.has(record.run.status)) {
      const ownerTabGone =
        record.lease?.tabId !== caller.tabId &&
        (await gpIsTabGone(record.lease?.tabId));
      gpAssertOrClaimOwner(record, caller, { allowClaim: true, ownerTabGone });
      await gpWriteRunRecord(record);
    }
    return record.run;
  }
  if (String(record.run.runId) !== String(input.runId ?? input.run?.runId ?? "")) {
    throw gpStateError("WORKFLOW_NOT_FOUND", "Workflow run was not found");
  }
  gpAssertOrClaimOwner(record, caller);
  if (action === "RUN_ASSERT_OWNER") {
    await gpWriteRunRecord(record);
    return true;
  }
  if (action === "RUN_SAVE") {
    const run = gpValidateRun(input.run);
    if (input.expectedRevision != null && Number(record.run.revision) !== Number(input.expectedRevision)) {
      throw gpStateError("WORKFLOW_REVISION_CONFLICT", "Workflow run revision changed", {
        expectedRevision: input.expectedRevision,
        actualRevision: record.run.revision,
      });
    }
    record.run = run;
    if (GP_TERMINAL_STATUSES.has(run.status)) record.lease = null;
    await gpWriteRunRecord(record);
    return run;
  }
  if (action === "RUN_CLEAR") {
    await gpStorageRemove([GP_KEYS.activeRun]);
    return true;
  }
  throw gpStateError("GP_STATE_ACTION_FORBIDDEN", "State command is not allowed");
};

const handleGrindPilotStateCommand = (message, sender, sendResponse) => {
  const action = String(message?.action ?? "").toUpperCase();
  const requestId = normalizeRequestId(message?.requestId);
  const allowed = new Set([
    "BOOTSTRAP_LOAD", "SETTINGS_SAVE", "ACTIVITY_SAVE", "PROJECTS_SAVE",
    "PROFILE_LIST", "PROFILE_GET", "PROFILE_PUT", "PROFILE_DELETE",
    "RUN_LOAD_ACTIVE", "RUN_LOAD", "RUN_CREATE", "RUN_SAVE",
    "RUN_ASSERT_OWNER", "RUN_CLEAR",
  ]);
  if (!requestId || !allowed.has(action)) {
    sendResponse({ requestId, action, ok: false, data: null, error: { code: "GP_STATE_ACTION_FORBIDDEN", message: "State command is not allowed" } });
    return;
  }
  const execute = () => gpHandleStateAction(action, message?.payload, sender);
  const pending = grindPilotStateQueue.then(execute, execute);
  grindPilotStateQueue = pending.catch(() => {});
  pending.then(
    (data) => sendResponse({ requestId, action, ok: true, data: data ?? null, error: null }),
    (error) => sendResponse({ requestId, action, ok: false, data: null, error: {
      code: error?.code || "GP_STATE_FAILED",
      message: error?.message || "State command failed",
      details: error?.details ?? null,
    } }),
  );
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRecord(message)) return false;
  const knownType =
    message.type === BRIDGE_INJECT_REQUEST ||
    message.type === GRINDPILOT_RPC_INSTALL_REQUEST ||
    message.type === GRINDPILOT_RPC_CALL_REQUEST ||
    message.type === PRICE_BRIDGE_REQUEST ||
    message.type === FUTGG_PLAYERS_BRIDGE_REQUEST ||
    message.type === GP_STATE_COMMAND ||
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
  if (message?.type === GRINDPILOT_RPC_INSTALL_REQUEST) {
    handleGrindPilotRpcInstallRequest(sender, sendResponse);
    return true;
  }
  if (message?.type === GRINDPILOT_RPC_CALL_REQUEST) {
    handleGrindPilotRpcCallRequest(message, sender, sendResponse);
    return true;
  }
  if (message?.type === GP_STATE_COMMAND) {
    handleGrindPilotStateCommand(message, sender, sendResponse);
    return true;
  }
  console.log("[EA Data] Background request", {
    type: message?.payload?.type ?? null,
    debug: message?.payload?.payload?.debug ?? null,
  });
  handleSolverRequest(message, sendResponse);
  return true;
});

if (chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!Number.isInteger(tabId)) return;
    grindPilotRpcSecrets.delete(tabId);
    chrome.storage?.session?.remove?.(`grindpilot.rpc.secret.${tabId}`).catch?.(() => {});
    const releaseLease = async () => {
      const record = await gpReadRunRecord();
      if (!record || record.lease?.tabId !== tabId) return;
      record.lease = null;
      await gpWriteRunRecord(record);
    };
    const pending = grindPilotStateQueue.then(releaseLease, releaseLease);
    grindPilotStateQueue = pending.catch((error) => {
      console.warn("[GrindPilot] Failed to release removed-tab workflow lease", {
        tabId,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
    });
  });
}

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
