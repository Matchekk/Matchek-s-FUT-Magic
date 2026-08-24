import test from "node:test";
import assert from "node:assert/strict";

const EA_URL = "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/";

test("service worker serializes revisions and rejects a second-tab workflow owner", async () => {
  const memory = {};
  const liveTabs = new Set([1, 2]);
  let messageListener = null;
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      lastError: null,
      onMessage: { addListener(listener) { messageListener = listener; } },
      onConnect: { addListener() {} },
    },
    tabs: {
      get(tabId, callback) {
        if (liveTabs.has(tabId)) callback({ id: tabId, url: EA_URL });
        else {
          globalThis.chrome.runtime.lastError = { message: `No tab with id: ${tabId}.` };
          callback(undefined);
          globalThis.chrome.runtime.lastError = null;
        }
      },
      onRemoved: { addListener() {} },
    },
    scripting: { executeScript: async () => [] },
    storage: {
      local: {
        get(keys, callback) {
          const list = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(list.filter((key) => Object.hasOwn(memory, key)).map((key) => [key, structuredClone(memory[key])])));
        },
        set(entries, callback) {
          for (const [key, value] of Object.entries(entries)) memory[key] = structuredClone(value);
          callback();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete memory[key];
          callback();
        },
      },
    },
  };

  await import(`../background.js?state-test=${Date.now()}`);
  assert.equal(typeof messageListener, "function");

  const sender = (tabId) => ({
    id: "test-extension",
    frameId: 0,
    tab: { id: tabId, url: EA_URL },
  });
  let nextRequest = 0;
  const dispatch = (action, payload, tabId = 1) => new Promise((resolve, reject) => {
    const returned = messageListener({
      type: "GRINDPILOT_STATE_COMMAND_V2",
      requestId: `request-${++nextRequest}`,
      action,
      payload,
    }, sender(tabId), resolve);
    if (returned !== true) reject(new Error(`State listener did not retain the response channel for ${action}`));
  });

  const workflow = {
    id: "lease-test",
    name: "Lease test",
    version: 1,
    steps: [{ id: "pause", type: "PAUSE", config: {} }],
  };
  const run = {
    runId: "run-lease-test",
    revision: 0,
    status: "paused",
    definition: workflow,
    nodes: [],
  };
  const created = await dispatch("RUN_CREATE", { run, ownerId: "owner-tab-1" }, 1);
  assert.equal(created.ok, true);

  const foreignLoad = await dispatch("RUN_LOAD_ACTIVE", { ownerId: "owner-tab-2" }, 2);
  assert.equal(foreignLoad.ok, false);
  assert.equal(foreignLoad.error.code, "WORKFLOW_OWNED_BY_OTHER_TAB");

  liveTabs.delete(1);
  const recovered = await dispatch("RUN_LOAD_ACTIVE", { ownerId: "owner-tab-2" }, 2);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.data.runId, run.runId);

  const revisionOne = { ...recovered.data, revision: 1 };
  const saved = await dispatch("RUN_SAVE", {
    run: revisionOne,
    expectedRevision: 0,
    ownerId: "owner-tab-2",
  }, 2);
  assert.equal(saved.ok, true);

  const revisionTwo = { ...saved.data, revision: 2 };
  const [first, raced] = await Promise.all([
    dispatch("RUN_SAVE", { run: revisionTwo, expectedRevision: 1, ownerId: "owner-tab-2" }, 2),
    dispatch("RUN_SAVE", { run: revisionTwo, expectedRevision: 1, ownerId: "owner-tab-2" }, 2),
  ]);
  assert.equal(first.ok, true);
  assert.equal(raced.ok, false);
  assert.equal(raced.error.code, "WORKFLOW_REVISION_CONFLICT");

  delete globalThis.chrome;
});
