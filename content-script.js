const waitForInjectionHost = ({ timeoutMs = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    const host = document.head || document.documentElement;
    if (host) {
      resolve(host);
      return;
    }

    const timeoutId = setTimeout(() => {
      try {
        observer.disconnect();
      } catch {}
      reject(new Error("Timed out waiting for document root"));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const nextHost = document.head || document.documentElement;
      if (!nextHost) return;
      clearTimeout(timeoutId);
      try {
        observer.disconnect();
      } catch {}
      resolve(nextHost);
    });

    try {
      observer.observe(document, { childList: true, subtree: true });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });

const injectPageScript = async (path, { type = "module" } = {}) =>
  new Promise(async (resolve, reject) => {
    const script = document.createElement("script");
    const src = chrome.runtime.getURL(path);
    script.src = src;
    if (type) script.type = type;
    script.onload = function () {
      script.parentNode?.removeChild(script);
      resolve({ path, type: type || "classic", src });
    };
    script.onerror = function (errorEvent) {
      script.parentNode?.removeChild(script);
      const error = new Error(
        `[EA Data] Failed to inject script: ${path} (${type || "classic"})`,
      );
      error.path = path;
      error.injectType = type || "classic";
      error.src = src;
      error.eventType = errorEvent?.type ?? null;
      reject(error);
    };
    try {
      const host = await waitForInjectionHost();
      host.appendChild(script);
    } catch (error) {
      reject(error);
    }
  });

const BRIDGE_INJECT_REQUEST = "EA_PAGE_BRIDGE_INJECT";
const GRINDPILOT_RPC_INSTALL_REQUEST = "EA_GRINDPILOT_RPC_INSTALL";
const GRINDPILOT_RPC_CALL_REQUEST = "EA_GRINDPILOT_RPC_CALL_V2";

const requestBackgroundBridgeInject = (path) =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: BRIDGE_INJECT_REQUEST,
          payload: { path, href: location.href },
        },
        (response) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(
              new Error(
                runtimeError.message || "Background bridge injection failed",
              ),
            );
            return;
          }
          if (response?.ok) {
            resolve(response?.data ?? { injected: true, path });
            return;
          }
          reject(
            new Error(
              response?.error?.message || "Background bridge injection failed",
            ),
          );
        },
      );
    } catch (error) {
      reject(error);
    }
  });

const exposeExtensionMetadataToPage = async () => {
  try {
    const root = document.documentElement;
    const manifest = chrome.runtime.getManifest?.() ?? null;
    const version = String(manifest?.version ?? "").trim();
    const baseUrl = String(chrome.runtime.getURL("") ?? "").trim();
    if (root?.dataset) {
      if (version) root.dataset.eaDataExtensionVersion = version;
      if (baseUrl) root.dataset.eaDataExtensionBaseUrl = baseUrl;
    }
    const host = document.head || document.documentElement;
    if (host instanceof HTMLElement) {
      let metaNode = document.getElementById("ea-data-extension-meta");
      if (!(metaNode instanceof HTMLMetaElement)) {
        metaNode = document.createElement("meta");
        metaNode.id = "ea-data-extension-meta";
        metaNode.setAttribute("name", "ea-data-extension-meta");
        host.appendChild(metaNode);
      }
      if (version) metaNode.setAttribute("data-version", version);
      if (baseUrl) metaNode.setAttribute("data-base-url", baseUrl);
    }
  } catch (error) {
    console.warn("[EA Data] Failed to expose extension metadata", {
      message: error?.message ?? String(error),
    });
  }
};

globalThis.__grindPilotIsolatedReady = (async () => {
  if (window !== window.top) return;
  await exposeExtensionMetadataToPage();
  const bridgePath = "page/ea-data-bridge.js";
  let bridgeInjected = false;
  try {
    await injectPageScript(bridgePath, { type: "module" });
    bridgeInjected = true;
  } catch (error) {
    console.warn("[EA Data] Module script injection failed; retrying classic", {
      path: error?.path ?? bridgePath,
      type: error?.injectType ?? "module",
      src: error?.src ?? null,
      message: error?.message ?? String(error),
    });
    try {
      await injectPageScript(bridgePath, { type: null });
      bridgeInjected = true;
      console.warn("[EA Data] Classic script injection fallback succeeded", {
        path: bridgePath,
      });
    } catch (fallbackError) {
      try {
        await requestBackgroundBridgeInject(bridgePath);
        bridgeInjected = true;
        console.warn(
          "[EA Data] Background executeScript injection fallback succeeded",
          {
            path: bridgePath,
          },
        );
      } catch (backgroundError) {
        console.error("[EA Data] Script injection failed", {
          moduleError: {
            path: error?.path ?? bridgePath,
            type: error?.injectType ?? "module",
            src: error?.src ?? null,
            message: error?.message ?? String(error),
          },
          fallbackError: {
            path: fallbackError?.path ?? bridgePath,
            type: fallbackError?.injectType ?? "classic",
            src: fallbackError?.src ?? null,
            message: fallbackError?.message ?? String(fallbackError),
          },
          backgroundError: {
            path: bridgePath,
            message: backgroundError?.message ?? String(backgroundError),
          },
          href: location.href,
          frame: window === window.top ? "top" : "child",
          ua: navigator.userAgent,
          at: new Date().toISOString(),
        });
      }
    }
  }
  if (!bridgeInjected) throw new Error("EA page bridge injection failed");
  const workspacePath = "page/fut-magic-ea-workspace.js";
  try {
    await injectPageScript(workspacePath, { type: null });
  } catch (workspaceError) {
    try {
      await requestBackgroundBridgeInject(workspacePath);
    } catch (backgroundWorkspaceError) {
      console.warn("[FUT Magic] EA-native workspace unavailable; using overlay fallback", {
        path: workspacePath,
        injectionError: workspaceError?.message ?? String(workspaceError),
        fallbackError:
          backgroundWorkspaceError?.message ?? String(backgroundWorkspaceError),
      });
    }
  }
  await requestGrindPilotRpcInstall();
  installIsolatedGrindPilotEaProxy();
  return { ready: true };
})();
void globalThis.__grindPilotIsolatedReady.catch((error) => {
  const message = error?.message ?? String(error);
  console.error(`[GrindPilot] Isolated bridge setup failed: ${message}`);
});

const CONTENT_SCRIPT_VERSION = "2026-08-25-static-bundle";
console.log("[EA Data] Content script loaded", {
  version: CONTENT_SCRIPT_VERSION,
});

const SOLVER_BRIDGE_REQUEST = "EA_SOLVER_REQUEST";
const SOLVER_BRIDGE_RESPONSE = "EA_SOLVER_RESPONSE";
const SOLVER_BRIDGE_TRACE = "EA_SOLVER_TRACE";
const SOLVER_BRIDGE_PING = "EA_SOLVER_PING";
const SOLVER_BRIDGE_PONG = "EA_SOLVER_PONG";
const SOLVER_BRIDGE_SOURCE = "ea-data-bridge";
const WORKER_REQUEST = "SOLVER_WORKER_REQUEST";
const WORKER_RESPONSE = "SOLVER_WORKER_RESPONSE";
// Older background versions used the response type for requests as well.
const LEGACY_WORKER_REQUEST = WORKER_RESPONSE;
const SOLVER_PORT_NAME = "EA_SOLVER_PORT";
const EA_DATA_LOG = "EA_DATA_LOG";
const SOLVER_DEFAULT_TIMEOUT_MS = 120000;
const SOLVER_MAX_TIMEOUT_MS = 120000;
const SOLVER_INIT_TIMEOUT_MS = 10000;
const SOLVER_PROTOCOL_PROBE_TIMEOUT_MS = 1500;
const SOLVER_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const SOLVER_MAX_PAYLOAD_DEPTH = 64;
const SOLVER_ALLOWED_OPERATIONS = new Set(["INIT", "SOLVE"]);

const PREF_BRIDGE_GET = "EA_DATA_PREF_GET";
const PREF_BRIDGE_SET = "EA_DATA_PREF_SET";
const PREF_BRIDGE_RES = "EA_DATA_PREF_RES";
const PREF_ALLOWED_KEYS = new Set(["eaData.preferences.v1"]);
const storageLocalGet = (key) =>
  new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get([key], (items) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || "Local preference read failed"));
          return;
        }
        resolve(items?.[key] ?? null);
      });
    } catch (error) {
      reject(error);
    }
  });
const storageLocalSet = (key, value) =>
  new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || "Local preference write failed"));
          return;
        }
        resolve(true);
      });
    } catch (error) {
      reject(error);
    }
  });
const PRICE_BRIDGE_REQUEST = "EA_DATA_PRICE_REQUEST";
const PRICE_BRIDGE_RESPONSE = "EA_DATA_PRICE_RESPONSE";
const FUTGG_PLAYERS_BRIDGE_REQUEST = "EA_DATA_FUTGG_PLAYERS_REQUEST";
const FUTGG_PLAYERS_BRIDGE_RESPONSE = "EA_DATA_FUTGG_PLAYERS_RESPONSE";

// Relay page-world log messages to the content-script console.
// The page script (ea-data-bridge.js) runs in the main world where EA overrides
// console. This listener runs in the isolated world with the native console.
window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    if (event?.data?.type !== EA_DATA_LOG) return;
    const args = event.data.args;
    if (!Array.isArray(args)) return;
    console.log(...args);
  },
  true,
);

const FUT_MAGIC_TAB_REQUEST = "FUT_MAGIC_TAB_REQUEST_V1";
if (chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== FUT_MAGIC_TAB_REQUEST) return false;
    if (sender?.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: { code: "UNTRUSTED_SENDER", message: "Sender extension is not trusted" } });
      return false;
    }
    const requestId = String(message?.requestId || "").slice(0, 128);
    const runtime = window.__grindPilotRuntime;
    if (!runtime?.getProductShellViewModel) {
      sendResponse({ requestId, ok: false, error: { code: "FUT_MAGIC_RUNTIME_NOT_READY", message: "FUT Magic is still connecting to this tab" } });
      return false;
    }
    const action = String(message?.action || "SNAPSHOT");
    const execute = action === "SNAPSHOT"
      ? Promise.resolve(runtime.getProductShellViewModel())
      : action === "COMMAND"
        ? runtime.executeProductShellCommand(message?.command || {})
        : Promise.reject(Object.assign(new Error("FUT Magic tab action is not allowed"), { code: "FUT_MAGIC_TAB_ACTION_FORBIDDEN" }));
    Promise.resolve(execute).then(
      (data) => sendResponse({ requestId, ok: true, data }),
      (error) => sendResponse({ requestId, ok: false, error: {
        code: error?.code || "FUT_MAGIC_TAB_REQUEST_FAILED",
        message: error?.message || "FUT Magic tab request failed",
      } }),
    );
    return true;
  });
}

const solverBridgeSeen = new Set();

let solverWorkerInitPromise = null;
const solverWorkerRequests = new Map();
let solverPort = null;
let solverPortProtocol = null;

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRequestId = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `ea-data-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isTrustedPageMessageEvent = (event) => {
  if (!event) return false;
  if (event.source !== window) return false;
  try {
    const expectedOrigin = window.location?.origin ?? "";
    const origin = event.origin;
    if (origin && origin !== "null" && expectedOrigin && origin !== expectedOrigin) {
      return false;
    }
  } catch {}
  return true;
};

const postSolverTrace = (stage, requestId, details = null) => {
  const detail = { type: SOLVER_BRIDGE_TRACE, requestId, stage, details, source: SOLVER_BRIDGE_SOURCE };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const markListenerReady = () => {
  try {
    document.documentElement.dataset.eaSolverBridge = "ready";
    document.documentElement.dataset.eaSolverBridgeAt = String(Date.now());
  } catch {}
  postSolverTrace("listener-ready", "content-script", {
    href: location.href,
    frame: window === window.top ? "top" : "child",
  });
};

const postSolverPong = (requestId) => {
  const detail = {
    type: SOLVER_BRIDGE_PONG,
    requestId,
    frame: window === window.top ? "top" : "child",
    href: location.href,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

if (window === window.top) markListenerReady();

const ensureSolverPort = () => {
  if (solverPort) return solverPort;
  try {
    solverPort = chrome.runtime.connect({ name: SOLVER_PORT_NAME });
  } catch (error) {
    solverPort = null;
    throw error;
  }

  solverPort.onMessage.addListener((msg) => {
    if (!msg || msg.type !== WORKER_RESPONSE) return;
    const requestId = msg.requestId;
    if (!requestId) return;
    const pending = solverWorkerRequests.get(requestId);
    if (!pending) return;
    solverWorkerRequests.delete(requestId);
    try {
      clearTimeout(pending.timerId);
    } catch {}
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(msg.error || new Error("Solver failed"));
  });

  solverPort.onDisconnect.addListener(() => {
    solverPort = null;
    solverPortProtocol = null;
    try {
      solverWorkerInitPromise = null;
    } catch {}
    // Fail any in-flight calls quickly.
    for (const [requestId, pending] of solverWorkerRequests.entries()) {
      try {
        clearTimeout(pending.timerId);
      } catch {}
      try {
        pending.reject(new Error("Solver port disconnected"));
      } catch {}
      solverWorkerRequests.delete(requestId);
    }
  });

  return solverPort;
};

const initSolverWorker = () => {
  if (solverWorkerInitPromise) return solverWorkerInitPromise;
  solverWorkerInitPromise = (async () => {
    let result;
    try {
      result = await callSolverWorkerOnce(
        "INIT",
        null,
        SOLVER_PROTOCOL_PROBE_TIMEOUT_MS,
        "v2",
      );
      solverPortProtocol = "v2";
    } catch (error) {
      if (isRetryableSolverError(error)) throw error;
      // Transitional compatibility for background versions that still expect
      // SOLVER_WORKER_RESPONSE as the incoming request type.
      result = await callSolverWorkerOnce(
        "INIT",
        null,
        SOLVER_INIT_TIMEOUT_MS,
        "legacy",
      );
      solverPortProtocol = "legacy";
    }
    if (!result || result.ready !== true) {
      throw new Error("Solver background failed its INIT readiness check");
    }
    return result;
  })().catch((error) => {
    solverWorkerInitPromise = null;
    solverPortProtocol = null;
    throw error;
  });
  return solverWorkerInitPromise;
};

const requestGrindPilotRpcInstall = () =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: GRINDPILOT_RPC_INSTALL_REQUEST }, (response) => {
      const runtimeError = chrome.runtime?.lastError;
      if (runtimeError || !response?.ok) {
        reject(new Error(runtimeError?.message || response?.error?.message || "EA RPC installation failed"));
      } else resolve(response.data);
    });
  });

const installIsolatedGrindPilotEaProxy = () => {
  const invoke = (method, payload) => new Promise((resolve, reject) => {
    const requestId = createRequestId();
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      reject(Object.assign(new Error(`EA RPC timed out: ${method}`), { code: "EA_RPC_TIMEOUT" }));
    }, 130_000);
    chrome.runtime.sendMessage({ type: GRINDPILOT_RPC_CALL_REQUEST, requestId, method, payload }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const runtimeError = chrome.runtime?.lastError;
      if (runtimeError || !response?.ok) reject(Object.assign(new Error(runtimeError?.message || response?.error?.message || "EA RPC failed"), { code: response?.error?.code || "EA_RPC_FAILED" }));
      else resolve(response.value);
    });
  });
  const method = (name) => (payload) => invoke(name, payload);
  window.eaData = {
    grindPilot: {
      getHealth: method("getHealth"), getCapabilityHealth: method("getCapabilityHealth"), getContext: method("getContext"),
      readInventory: method("readInventory"), readCurrentSbcProject: method("readCurrentSbcProject"), findSbcTarget: method("findSbcTarget"), readLegacySequences: method("readLegacySequences"), solveCurrentSbc: method("solveCurrentSbc"),
      submitCurrentSbc: method("submitCurrentSbc"), listOwnedRewardPacks: method("listOwnedRewardPacks"),
      claimCurrentReward: method("claimCurrentReward"), openOwnedRewardPack: method("openOwnedRewardPack"),
      resolveUnassigned: method("resolveUnassigned"), readPlayerPick: method("readPlayerPick"),
      selectPlayerPick: method("selectPlayerPick"), organizeIntoSbc: method("organizeIntoSbc"),
      readSbcChallengeState: method("readSbcChallengeState"),
    },
    openSequencePlanner: method("openSequencePlanner"),
  };
};

const isRetryableSolverError = (error) => {
  const message = String(error?.message || error || "");
  if (!message) return false;
  if (message.includes("disconnected")) return true;
  if (message.includes("Receiving end does not exist")) return true;
  if (message.includes("Could not establish connection")) return true;
  if (message.includes("message port closed")) return true;
  if (message.includes("Attempting to use a disconnected port object"))
    return true;
  if (message.includes("Extension context invalidated")) return true;
  return false;
};

const normalizeSolverTimeoutMs = (
  value,
  fallback = SOLVER_DEFAULT_TIMEOUT_MS,
) => {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.min(SOLVER_MAX_TIMEOUT_MS, Math.max(1000, Math.trunc(resolved)));
};

const estimateSolverPayloadBytes = (payload) => {
  if (payload == null) return 0;
  const seen = new WeakSet();
  const stack = [{ value: payload, depth: 0 }];
  let bytes = 0;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (value == null) {
      bytes += 4;
    } else if (typeof value === "string") {
      // UTF-16 length is a safe upper bound for the common JSON payload here.
      bytes += value.length * 2 + 2;
    } else if (typeof value === "number" || typeof value === "bigint") {
      bytes += 16;
    } else if (typeof value === "boolean") {
      bytes += 5;
    } else if (typeof value === "object") {
      if (seen.has(value)) continue;
      if (depth >= SOLVER_MAX_PAYLOAD_DEPTH) {
        throw new Error("Solver payload nesting is too deep");
      }
      seen.add(value);
      bytes += 2;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          stack.push({ value: value[index], depth: depth + 1 });
        }
      } else {
        for (const [key, child] of Object.entries(value)) {
          bytes += key.length * 2 + 3;
          stack.push({ value: child, depth: depth + 1 });
        }
      }
    } else {
      throw new Error("Solver payload contains an unsupported value");
    }

    if (bytes > SOLVER_MAX_PAYLOAD_BYTES) return bytes;
  }
  return bytes;
};

const validateSolverOperation = (type, payload) => {
  if (!SOLVER_ALLOWED_OPERATIONS.has(type)) {
    const error = new Error(`Solver operation not allowed: ${type || "missing"}`);
    error.code = "SOLVER_OPERATION_FORBIDDEN";
    throw error;
  }
  if (type === "INIT" && payload != null) {
    const error = new Error("INIT does not accept a payload");
    error.code = "SOLVER_PAYLOAD_INVALID";
    throw error;
  }
  if (
    type === "SOLVE" &&
    (!payload || typeof payload !== "object" || Array.isArray(payload))
  ) {
    const error = new Error("SOLVE requires an object payload");
    error.code = "SOLVER_PAYLOAD_INVALID";
    throw error;
  }
  const payloadBytes = estimateSolverPayloadBytes(payload);
  if (payloadBytes > SOLVER_MAX_PAYLOAD_BYTES) {
    const error = new Error("Solver payload exceeds the 8 MiB limit");
    error.code = "SOLVER_PAYLOAD_TOO_LARGE";
    throw error;
  }
  return payloadBytes;
};

const callSolverWorkerOnce = (
  type,
  payload,
  timeoutMs,
  protocol = solverPortProtocol || "v2",
) =>
  new Promise((resolve, reject) => {
    let port;
    try {
      port = ensureSolverPort();
    } catch (error) {
      reject(error);
      return;
    }

    const requestId = createRequestId();
    const timerId = setTimeout(
      () => {
        solverWorkerRequests.delete(requestId);
        reject(new Error("Solver timeout"));
      },
      normalizeSolverTimeoutMs(timeoutMs),
    );

    solverWorkerRequests.set(requestId, { resolve, reject, timerId });
    try {
      port.postMessage({
        type: protocol === "legacy" ? LEGACY_WORKER_REQUEST : WORKER_REQUEST,
        requestId,
        workerType: type,
        payload,
        protocolVersion: protocol === "legacy" ? 1 : 2,
      });
    } catch (error) {
      solverWorkerRequests.delete(requestId);
      try {
        clearTimeout(timerId);
      } catch {}
      reject(error);
    }
  });

const callSolverWorker = async (
  type,
  payload,
  timeoutMs,
  { retries = 1 } = {},
) => {
  try {
    if (type !== "INIT" && !solverPortProtocol) await initSolverWorker();
    return await callSolverWorkerOnce(type, payload, timeoutMs);
  } catch (error) {
    if (!retries || !isRetryableSolverError(error)) throw error;
    // Force a clean reconnect and retry once for MV3 service worker restarts.
    try {
      solverPort?.disconnect?.();
    } catch {}
    solverPort = null;
    solverPortProtocol = null;
    try {
      solverWorkerInitPromise = null;
    } catch {}
    await delayMs(60);
    return callSolverWorker(type, payload, timeoutMs, { retries: retries - 1 });
  }
};

const handleSolverError = (error) => {
  const message = error?.message || "Solver bridge failed";
  if (message.includes("Receiving end does not exist")) {
    return {
      code: "BACKGROUND_UNAVAILABLE",
      message:
        "Extension background unavailable. Reload the extension and retry.",
    };
  }
  if (message.includes("disconnected")) {
    return {
      code: "BACKGROUND_UNAVAILABLE",
      message: "Solver disconnected. Retry the solve.",
    };
  }
  return error;
};

const postSolverResponse = (requestId, ok, data = null, error = null) => {
  const responsePayload = {
    type: SOLVER_BRIDGE_RESPONSE,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(responsePayload, "*");
  } catch {}
};

const handleSolverBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, payload, source } = data || {};
  if (type !== SOLVER_BRIDGE_REQUEST) return;
  if (typeof requestId !== "string" || !requestId || requestId.length > 200)
    return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  if (solverBridgeSeen.has(requestId)) return;
  solverBridgeSeen.add(requestId);
  // Prevent unbounded growth if the user runs many solves in a single session.
  if (solverBridgeSeen.size > 3000) solverBridgeSeen.clear();

  const shouldDebugLog = Boolean(
    payload?.debug === true || payload?.payload?.debug === true,
  );
  if (shouldDebugLog) {
    console.log("[EA Data] Solver bridge request", {
      requestId,
      workerType: payload?.type,
      debug: true,
      pageDebug: Boolean(payload?.debug),
      solverDebug: Boolean(payload?.payload?.debug),
    });
  }
  postSolverTrace("received", requestId, {
    workerType: payload?.type ?? "SOLVE",
  });

  try {
    const workerType = String(payload?.type ?? "SOLVE").toUpperCase();
    const hasWorkerPayload =
      payload != null &&
      typeof payload === "object" &&
      Object.prototype.hasOwnProperty.call(payload, "payload");
    const workerPayload = hasWorkerPayload ? payload.payload : payload ?? null;
    const payloadBytes = validateSolverOperation(workerType, workerPayload);
    const requestedTimeoutMs =
      data?.timeoutMs ?? payload?.timeoutMs ?? payload?.payload?.timeoutMs;
    const timeoutMs = normalizeSolverTimeoutMs(
      requestedTimeoutMs,
      workerType === "INIT" ? SOLVER_INIT_TIMEOUT_MS : SOLVER_DEFAULT_TIMEOUT_MS,
    );
    let result;
    if (workerType === "INIT") {
      result = await initSolverWorker();
    } else {
      result = await callSolverWorker(workerType, workerPayload, timeoutMs);
    }
    postSolverTrace("responded", requestId, { ok: true, payloadBytes, timeoutMs });
    postSolverResponse(requestId, true, result, null);
  } catch (error) {
    const normalized = handleSolverError(error);
    const responseError = normalized?.code
      ? {
          code: String(normalized.code),
          message: normalized?.message || "Solver bridge failed",
        }
      : {
          code: error?.code || "SOLVER_BRIDGE_FAILED",
          message: error?.message || "Solver bridge failed",
        };
    postSolverTrace("responded", requestId, {
      ok: false,
      message: error?.message || "Solver bridge failed",
    });
    postSolverResponse(requestId, false, null, responseError);
  }
};

const postPrefResponse = (requestId, ok, data, error) => {
  const detail = {
    type: PREF_BRIDGE_RES,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const handlePrefBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, key, value } = data || {};
  if (type !== PREF_BRIDGE_GET && type !== PREF_BRIDGE_SET) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  if (!key) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_INVALID",
      message: "Missing preference key",
    });
    return;
  }
  if (!PREF_ALLOWED_KEYS.has(String(key))) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_FORBIDDEN_KEY",
      message: "Preference key not allowed",
    });
    return;
  }

  try {
    if (type === PREF_BRIDGE_GET) {
      const result = await storageLocalGet(key);
      postPrefResponse(requestId, true, result, null);
      return;
    }
    await storageLocalSet(key, value);
    postPrefResponse(requestId, true, true, null);
  } catch (error) {
    postPrefResponse(requestId, false, null, {
      code: "PREF_FAILED",
      message: error?.message || "Preference request failed",
    });
  }
};

const postPriceResponse = (requestId, ok, data, error) => {
  const detail = {
    type: PRICE_BRIDGE_RESPONSE,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const postFutggPlayersResponse = (requestId, ok, data, error) => {
  const detail = {
    type: FUTGG_PLAYERS_BRIDGE_RESPONSE,
    requestId,
    ok: Boolean(ok),
    data,
    error,
    source: SOLVER_BRIDGE_SOURCE,
  };
  try {
    window.postMessage(detail, "*");
  } catch {}
};

const handlePriceBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, ids } = data || {};
  if (type !== PRICE_BRIDGE_REQUEST) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  console.log("[EA Data] Price bridge request", {
    requestId,
    count: Array.isArray(ids) ? ids.length : 0,
  });
  try {
    chrome.runtime.sendMessage(
      {
        type: PRICE_BRIDGE_REQUEST,
        payload: { ids: Array.isArray(ids) ? ids : [], requestId },
      },
      (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          console.log("[EA Data] Price bridge runtime error", {
            requestId,
            message: runtimeError.message || "Price bridge failed",
          });
          postPriceResponse(requestId, false, null, {
            code: "PRICE_BRIDGE_FAILED",
            message: runtimeError.message || "Price bridge failed",
          });
          return;
        }
        if (response?.ok) {
          console.log("[EA Data] Price bridge response", {
            requestId,
            ok: true,
            requestedCount: response?.data?.requestedCount ?? null,
            fetchedCount: response?.data?.fetchedCount ?? null,
            errorCount: response?.data?.errorCount ?? null,
          });
          postPriceResponse(requestId, true, response.data, null);
          return;
        }
        console.log("[EA Data] Price bridge response", {
          requestId,
          ok: false,
          error: response?.error ?? null,
        });
        postPriceResponse(requestId, false, null, response?.error ?? {
          code: "PRICE_BRIDGE_FAILED",
          message: "Price bridge failed",
        });
      },
    );
  } catch (error) {
    console.log("[EA Data] Price bridge exception", {
      requestId,
      message: error?.message || String(error),
    });
    postPriceResponse(requestId, false, null, {
      code: "PRICE_BRIDGE_FAILED",
      message: error?.message || "Price bridge failed",
    });
  }
};

const handleFutggPlayersBridgeRequest = async (data) => {
  if (window !== window.top) return;
  const { type, requestId, source, payload } = data || {};
  if (type !== FUTGG_PLAYERS_BRIDGE_REQUEST) return;
  if (!requestId) return;
  if (source !== SOLVER_BRIDGE_SOURCE) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: FUTGG_PLAYERS_BRIDGE_REQUEST,
        payload: { ...(payload && typeof payload === "object" ? payload : {}), requestId },
      },
      (response) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) {
          postFutggPlayersResponse(requestId, false, null, {
            code: "FUTGG_PLAYERS_BRIDGE_FAILED",
            message: runtimeError.message || "FUT.GG players bridge failed",
          });
          return;
        }
        if (response?.ok) {
          postFutggPlayersResponse(requestId, true, response.data, null);
          return;
        }
        postFutggPlayersResponse(requestId, false, null, response?.error ?? {
          code: "FUTGG_PLAYERS_BRIDGE_FAILED",
          message: "FUT.GG players bridge failed",
        });
      },
    );
  } catch (error) {
    postFutggPlayersResponse(requestId, false, null, {
      code: "FUTGG_PLAYERS_BRIDGE_FAILED",
      message: error?.message || "FUT.GG players bridge failed",
    });
  }
};

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handleSolverBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handlePrefBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handlePriceBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    handleFutggPlayersBridgeRequest(event.data);
  },
  true,
);

window.addEventListener(
  "message",
  (event) => {
    if (window !== window.top) return;
    if (!isTrustedPageMessageEvent(event)) return;
    if (event?.data?.source !== SOLVER_BRIDGE_SOURCE) return;
    if (event?.data?.type !== SOLVER_BRIDGE_PING) return;
    const requestId = event?.data?.requestId || createRequestId();
    postSolverTrace("ping-received", requestId, { channel: "postMessage" });
    postSolverPong(requestId);
  },
  true,
);
