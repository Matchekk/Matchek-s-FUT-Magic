import test from "node:test";
import assert from "node:assert/strict";

import {
  DomClickStatus,
  DomFallbackAdapter,
  DomWaitStatus,
} from "../src/ea/dom-fallback-adapter.js";

class FakeMutationObserver {
  static active = new Set();

  constructor(callback) {
    this.callback = callback;
    this.root = null;
  }

  observe(root) {
    this.root = root;
    root.observers.add(this);
    FakeMutationObserver.active.add(this);
  }

  disconnect() {
    this.root?.observers.delete(this);
    FakeMutationObserver.active.delete(this);
    this.root = null;
  }
}

class FakeElement {
  constructor({ tag = "div", text = "", attrs = {}, hidden = false, disabled = false } = {}) {
    this.tag = tag;
    this.textContent = text;
    this.attrs = new Map(Object.entries(attrs));
    this.hidden = hidden;
    this.disabled = disabled;
    this.children = [];
    this.observers = new Set();
    this.style = { display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto" };
    this.clicked = 0;
    this.onClick = null;
    this.fingerprint = "initial";
  }

  append(element, { notify = true } = {}) {
    this.children.push(element);
    if (notify) this.mutate();
    return element;
  }

  mutate() {
    for (const observer of [...this.observers]) observer.callback([{ target: this }], observer);
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  getClientRects() {
    return [{}];
  }

  matches(selector) {
    if (selector === ":disabled") return this.disabled;
    if (this.tag === "button" && selector.includes("button")) return true;
    if (this.tag === "a" && selector.includes("a[href]") && this.attrs.has("href")) return true;
    if (this.attrs.get("role") === "button" && selector.includes('[role="button"]')) return true;
    if (this.attrs.has("data-action") && selector.includes("[data-action]")) return true;
    return false;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (element) => {
      if (element.matches(selector)) found.push(element);
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  click() {
    this.clicked += 1;
    this.onClick?.();
  }
}

function createAdapter() {
  return new DomFallbackAdapter({
    document: new FakeElement(),
    window: { getComputedStyle: (element) => element.style },
    MutationObserver: FakeMutationObserver,
  });
}

test.beforeEach(() => {
  FakeMutationObserver.active.clear();
});

test("findAction stays inside its root and ignores hidden, disabled, and generic text nodes", () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const otherRoot = new FakeElement();
  root.append(new FakeElement({ tag: "div", text: "Submit" }), { notify: false });
  root.append(new FakeElement({ tag: "button", text: "Submit", hidden: true }), { notify: false });
  root.append(new FakeElement({ tag: "button", text: "Submit", disabled: true }), { notify: false });
  const intended = root.append(new FakeElement({ tag: "button", text: "  Submit  " }), { notify: false });
  otherRoot.append(new FakeElement({ tag: "button", text: "Submit" }), { notify: false });

  assert.equal(adapter.findAction({ root, text: "submit" }), intended);
  assert.deepEqual(adapter.findActions({ root, text: "Submit" }), [intended]);
});

test("findAction supports explicit startsWith matching without enabling it by default", () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const action = root.append(new FakeElement({ tag: "button", text: "Submit squad" }), { notify: false });

  assert.equal(adapter.findAction({ root, text: "Submit" }), null);
  assert.equal(adapter.findAction({ root, text: "Submit", match: "startsWith" }), action);
});

test("waitForAction reacts to a mutation and disconnects its observer", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const waiting = adapter.waitForAction({ root, text: "Claim reward", timeoutMs: 100 });

  const action = new FakeElement({ tag: "button", text: "Claim reward" });
  root.append(action);

  const outcome = await waiting;
  assert.equal(outcome.status, DomWaitStatus.FOUND);
  assert.equal(outcome.element, action);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("waitForAction reports timeout and never upgrades it to success", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();

  const outcome = await adapter.waitForAction({ root, text: "Missing", timeoutMs: 8 });
  root.append(new FakeElement({ tag: "button", text: "Missing" }));

  assert.equal(outcome.status, DomWaitStatus.TIMED_OUT);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("waitForAction aborts and releases observer resources", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const controller = new AbortController();
  const waiting = adapter.waitForAction({ root, text: "Submit", timeoutMs: 100, signal: controller.signal });

  controller.abort("stopped-by-user");
  const outcome = await waiting;

  assert.equal(outcome.status, DomWaitStatus.ABORTED);
  assert.equal(outcome.reason, "stopped-by-user");
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("waitForSquadSettle requires a quiet stable fingerprint accepted by the verifier", async () => {
  const adapter = createAdapter();
  const pitch = new FakeElement();
  const verified = [];
  const waiting = adapter.waitForSquadSettle({
    root: pitch,
    quietMs: 12,
    timeoutMs: 120,
    getFingerprint: (root) => root.fingerprint,
    verifyFingerprint: (fingerprint) => {
      verified.push(fingerprint);
      return fingerprint === "eleven-valid-items";
    },
  });

  pitch.fingerprint = "half-built";
  pitch.mutate();
  await new Promise((resolve) => setTimeout(resolve, 4));
  pitch.fingerprint = "eleven-valid-items";
  pitch.mutate();

  const outcome = await waiting;
  assert.equal(outcome.status, DomWaitStatus.SETTLED);
  assert.equal(outcome.fingerprint, "eleven-valid-items");
  assert.deepEqual(verified, ["eleven-valid-items"]);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("a rejected fingerprint reaches TIMED_OUT rather than SETTLED", async () => {
  const adapter = createAdapter();
  const pitch = new FakeElement();
  pitch.fingerprint = "ten-items";

  const outcome = await adapter.waitForSquadSettle({
    root: pitch,
    quietMs: 3,
    timeoutMs: 15,
    getFingerprint: (root) => root.fingerprint,
    verifyFingerprint: () => false,
  });

  assert.equal(outcome.status, DomWaitStatus.TIMED_OUT);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("settling reports MISSING and ABORTED explicitly", async () => {
  const adapter = createAdapter();
  const callbacks = {
    quietMs: 5,
    timeoutMs: 100,
    getFingerprint: (root) => root.fingerprint,
    verifyFingerprint: () => true,
  };

  const missing = await adapter.waitForSquadSettle({ root: null, ...callbacks });
  assert.equal(missing.status, DomWaitStatus.MISSING);

  const pitch = new FakeElement();
  const controller = new AbortController();
  const waiting = adapter.waitForSquadSettle({ root: pitch, signal: controller.signal, ...callbacks });
  controller.abort("stop");
  const aborted = await waiting;

  assert.equal(aborted.status, DomWaitStatus.ABORTED);
  assert.equal(aborted.reason, "stop");
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("clickAndVerify succeeds only when its postcondition is observable", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const button = root.append(new FakeElement({ tag: "button", text: "Submit" }), { notify: false });
  let completed = false;
  button.onClick = () => {
    completed = true;
    root.mutate();
  };

  const outcome = await adapter.clickAndVerify({
    root,
    action: { text: "Submit" },
    postcondition: () => completed,
    timeoutMs: 50,
  });

  assert.equal(outcome.status, DomClickStatus.SUCCEEDED);
  assert.equal(button.clicked, 1);
  assert.equal(outcome.postconditionValue, true);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("clickAndVerify treats an absent postcondition as a failure", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const button = root.append(new FakeElement({ tag: "button", text: "Open pack" }), { notify: false });

  const outcome = await adapter.clickAndVerify({
    root,
    element: button,
    postcondition: () => false,
    timeoutMs: 8,
  });

  assert.equal(outcome.status, DomClickStatus.POSTCONDITION_TIMED_OUT);
  assert.equal(button.clicked, 1);
  assert.equal(FakeMutationObserver.active.size, 0);
});

test("clickAndVerify does not click when the postcondition was already satisfied", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const button = root.append(new FakeElement({ tag: "button", text: "Submit" }), { notify: false });

  const outcome = await adapter.clickAndVerify({
    root,
    element: button,
    postcondition: () => ({ alreadyCompleted: true }),
    timeoutMs: 20,
  });

  assert.equal(outcome.status, DomClickStatus.POSTCONDITION_ALREADY_SATISFIED);
  assert.equal(button.clicked, 0);
});

test("clickAndVerify subscribes before activation and captures synchronous controller events", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const button = root.append(new FakeElement({ tag: "button", text: "Claim" }), { notify: false });
  let state = false;
  let notify;
  button.onClick = () => {
    state = { claimed: true };
    notify();
  };

  const outcome = await adapter.clickAndVerify({
    root,
    element: button,
    postcondition: () => state,
    timeoutMs: 50,
    subscribe: (check) => {
      notify = check;
    },
  });

  assert.equal(outcome.status, DomClickStatus.SUCCEEDED);
  assert.deepEqual(outcome.postconditionValue, { claimed: true });
  assert.equal(button.clicked, 1);
});

test("clickAndVerify will not activate disabled or missing controls", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  const disabled = root.append(
    new FakeElement({ tag: "button", text: "Claim reward", disabled: true }),
    { notify: false },
  );

  const disabledResult = await adapter.clickAndVerify({
    root,
    element: disabled,
    postcondition: () => true,
    timeoutMs: 20,
  });
  const missingResult = await adapter.clickAndVerify({
    root,
    action: { text: "Different action" },
    postcondition: () => true,
    timeoutMs: 20,
  });
  const outside = new FakeElement({ tag: "button", text: "Claim reward" });
  const outsideResult = await adapter.clickAndVerify({
    root,
    element: outside,
    postcondition: () => true,
    timeoutMs: 20,
  });

  assert.equal(disabledResult.status, DomClickStatus.ACTION_DISABLED);
  assert.equal(missingResult.status, DomClickStatus.ACTION_MISSING);
  assert.equal(outsideResult.status, DomClickStatus.ACTION_MISSING);
  assert.equal(disabled.clicked, 0);
  assert.equal(outside.clicked, 0);
});

test("postconditions can be driven by a controller/event subscription without polling", async () => {
  const adapter = createAdapter();
  const root = new FakeElement();
  let state = false;
  let notify;
  let unsubscribed = false;

  const waiting = adapter.waitForPostcondition({
    root,
    predicate: () => state,
    timeoutMs: 100,
    subscribe: (check) => {
      notify = check;
      return () => {
        unsubscribed = true;
      };
    },
  });
  state = { challengeCompleted: true };
  notify();

  const outcome = await waiting;
  assert.equal(outcome.status, DomWaitStatus.SATISFIED);
  assert.deepEqual(outcome.value, { challengeCompleted: true });
  assert.equal(unsubscribed, true);
  assert.equal(FakeMutationObserver.active.size, 0);
});
