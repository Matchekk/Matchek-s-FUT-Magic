import assert from "node:assert/strict";
import test from "node:test";

import {
  DeveloperModeDisabledError,
  createDeveloperMode,
  discoverCapabilities,
  discoverUTClasses,
} from "../src/dev/index.js";

test("UT discovery is read-only and never invokes accessors", () => {
  let getterCalls = 0;
  class UTPlayerItemView {
    renderItem(item, target) {
      return [item, target];
    }

    get dangerousState() {
      getterCalls += 1;
      throw new Error("must not execute");
    }

    static findById(id) {
      return id;
    }
  }
  const originalRender = UTPlayerItemView.prototype.renderItem;
  const root = { UTPlayerItemView, NotAUTClass: class {} };
  Object.defineProperty(root, "UTPoison", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not execute");
    },
  });

  const result = discoverUTClasses(root);

  assert.equal(getterCalls, 0);
  assert.equal(result.classes.length, 1);
  assert.equal(result.classes[0].name, "UTPlayerItemView");
  assert.deepEqual(
    result.classes[0].prototypeMembers.find((entry) => entry.name === "renderItem"),
    { name: "renderItem", kind: "method", arity: 2 },
  );
  assert.deepEqual(
    result.classes[0].prototypeMembers.find((entry) => entry.name === "dangerousState"),
    { name: "dangerousState", kind: "accessor", getter: true, setter: false },
  );
  assert.equal(UTPlayerItemView.prototype.renderItem, originalRender);
});

test("capability discovery blocks getters and validates expected types", () => {
  let getterCalls = 0;
  const root = { UTServices: { solve: () => true, version: "26" } };
  Object.defineProperty(root.UTServices, "session", {
    get() {
      getterCalls += 1;
      return "secret";
    },
  });

  const capabilities = discoverCapabilities(root, [
    { id: "solver", path: "UTServices.solve", expectedType: "function" },
    { id: "wrong-type", path: ["UTServices", "version"], expectedType: "number" },
    { id: "blocked", path: "UTServices.session" },
    { id: "missing", path: "UTServices.claimReward" },
  ]);

  assert.equal(getterCalls, 0);
  assert.equal(capabilities.find((entry) => entry.id === "solver").available, true);
  assert.equal(
    capabilities.find((entry) => entry.id === "wrong-type").reason,
    "type_mismatch",
  );
  assert.equal(
    capabilities.find((entry) => entry.id === "blocked").reason,
    "accessor_blocked",
  );
  assert.equal(capabilities.find((entry) => entry.id === "missing").reason, "missing");
});

test("Developer Mode is disabled by default and installs no hooks", () => {
  class UTController {}
  const root = { UTController };
  const originalNames = Object.getOwnPropertyNames(root);
  const mode = createDeveloperMode({ root, now: () => 123 });

  assert.equal(mode.isEnabled(), false);
  assert.equal(mode.getStatus().hooksInstalled, false);
  assert.throws(() => mode.discover(), DeveloperModeDisabledError);
  assert.deepEqual(Object.getOwnPropertyNames(root), originalNames);

  mode.enable();
  assert.equal(mode.discover().classes[0].name, "UTController");
  mode.disable();
  assert.equal(mode.isEnabled(), false);
  assert.deepEqual(Object.getOwnPropertyNames(root), originalNames);
});
