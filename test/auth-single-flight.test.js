import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthRefreshSingleFlight,
  AuthState,
} from "../src/application/pro-contracts/index.js";

const signedIn = (observedAt = 1_000) => ({
  schemaVersion: 1,
  state: AuthState.SIGNED_IN,
  observedAt,
  expiresAt: observedAt + 60_000,
  errorCode: null,
});

test("concurrent product-auth refreshes share exactly one request", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const flight = new AuthRefreshSingleFlight({
    clock: () => 1_000,
    refresh: async () => {
      calls += 1;
      await gate;
      return signedIn();
    },
  });

  const requests = Array.from({ length: 20 }, () => flight.refresh());
  assert.equal(calls, 0, "refresh begins in the shared promise microtask");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(flight.refreshing, true);
  release();
  const results = await Promise.all(requests);

  assert.equal(calls, 1);
  assert.equal(flight.refreshing, false);
  assert.ok(results.every((snapshot) => snapshot.state === AuthState.SIGNED_IN));
  assert.ok(results.every((snapshot) => Object.isFrozen(snapshot)));
});

test("a failed refresh clears the flight and a later request may retry", async () => {
  let calls = 0;
  const flight = new AuthRefreshSingleFlight({
    clock: () => 1_000,
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return signedIn();
    },
  });

  await assert.rejects(flight.refresh(), /offline/);
  assert.equal(flight.refreshing, false);
  assert.equal((await flight.refresh()).state, AuthState.SIGNED_IN);
  assert.equal(calls, 2);
});

test("single-flight validates the token-free public auth snapshot", async () => {
  const flight = new AuthRefreshSingleFlight({
    clock: () => 1_000,
    refresh: async () => ({ ...signedIn(), accessToken: "must-not-cross-boundary" }),
  });
  await assert.rejects(flight.refresh(), /Forbidden field|not supported|accessToken/i);
});
