import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "../src/core/event-bus.js";

test("event bus delivers in subscription order and unsubscribe is idempotent", () => {
  const bus = new EventBus();
  const received = [];
  const unsubscribeFirst = bus.on("step", (payload) => received.push(`a:${payload.id}`));
  bus.on("step", (payload) => received.push(`b:${payload.id}`));

  assert.equal(bus.emit("step", { id: 1 }), 2);
  unsubscribeFirst();
  unsubscribeFirst();
  assert.equal(bus.emit("step", { id: 2 }), 1);
  assert.deepEqual(received, ["a:1", "b:1", "b:2"]);
});

test("once and snapshot delivery tolerate subscription changes during emit", () => {
  const bus = new EventBus();
  const received = [];
  let unsubscribeSecond = () => {};
  bus.once("run", () => {
    received.push("once");
    unsubscribeSecond();
  });
  unsubscribeSecond = bus.on("run", () => received.push("second"));

  bus.emit("run", null);
  bus.emit("run", null);
  assert.deepEqual(received, ["once", "second"]);
  assert.equal(bus.listenerCount("run"), 0);
});

test("listener failures are surfaced after all observers receive the event", () => {
  const bus = new EventBus();
  const received = [];
  bus.on("failure", () => {
    throw new Error("first failed");
  });
  bus.on("failure", () => received.push("still delivered"));

  assert.throws(() => bus.emit("failure", {}), /first failed/);
  assert.deepEqual(received, ["still delivered"]);
});

test("an old unsubscribe cannot clear subscriptions added after clear", () => {
  const bus = new EventBus();
  const oldUnsubscribe = bus.on("state", () => {});
  bus.clear("state");
  bus.on("state", () => {});
  oldUnsubscribe();
  assert.equal(bus.listenerCount("state"), 1);
});
