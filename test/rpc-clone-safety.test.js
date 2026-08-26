import test from "node:test";
import assert from "node:assert/strict";

test("signed main-world RPC strips functions, hides mutations, and rejects forged calls", async () => {
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
    },
    tabs: { onRemoved: { addListener() {} } },
    scripting: { executeScript: async () => [] },
    storage: {
      local: {
        get(_keys, callback) { callback({}); },
        set(_value, callback) { callback(); },
        remove(_keys, callback) { callback(); },
      },
    },
  };
  let getterInvoked = false;
  const unsafe = { safe: 7, handler() {} };
  Object.defineProperty(unsafe, "dangerous", {
    enumerable: true,
    get() { getterInvoked = true; return "leaked"; },
  });
  const fakeWindow = {
    eaData: { grindPilot: { getHealth: async () => unsafe } },
  };
  globalThis.window = fakeWindow;
  const { installGrindPilotMainWorldRpc } = await import(`../background.js?rpc-clone=${Date.now()}`);
  const rawSecret = new Uint8Array(32).fill(7);
  const secret = btoa(String.fromCharCode(...rawSecret));
  installGrindPilotMainWorldRpc(secret);
  const ticket = { requestId:"clone-test", method:"getHealth", expiresAt:Date.now()+10_000, payloadJson:"null" };
  const key = await crypto.subtle.importKey("raw", rawSecret, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signed = `${ticket.requestId}\n${ticket.method}\n${ticket.expiresAt}\n${ticket.payloadJson}`;
  ticket.signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)))));
  const response = await fakeWindow.__grindPilotEaRpcBrokerV2.invoke(ticket);
  assert.deepEqual(response?.value, { safe: 7 });
  assert.equal(getterInvoked, false);
  assert.equal(fakeWindow.eaData.grindPilot.submitCurrentSbc, undefined);
  await assert.rejects(() => fakeWindow.__grindPilotEaRpcBrokerV2.invoke({ ...ticket, requestId:"forged", signature:ticket.signature }), /signature invalid/);

  delete globalThis.window;
  delete globalThis.chrome;
});
