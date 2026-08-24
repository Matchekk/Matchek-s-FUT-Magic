import assert from "node:assert/strict";
import test from "node:test";

import {
  appendBoundedSnapshot,
  createWebAppSnapshot,
  diffWebAppSnapshots,
  jsonByteLength,
} from "../src/dev/index.js";

function classEntry(name, prototypeMembers = [], staticMembers = []) {
  return { name, prototypeMembers, staticMembers };
}

test("snapshot normalization is deterministic, scoped and byte bounded", () => {
  const classes = Array.from({ length: 50 }, (_, index) =>
    classEntry(`UTClass${String(index).padStart(3, "0")}`, [
      { name: "render", kind: "method", arity: index },
    ]),
  ).reverse();
  const snapshot = createWebAppSnapshot(
    { capturedAt: 42, classes, extensionVersion: "3.0.0" },
    { maxClasses: 50, maxSnapshotBytes: 2_000 },
  );

  assert.equal(snapshot.capturedAt, 42);
  assert.ok(jsonByteLength(snapshot) <= 2_000);
  assert.equal(snapshot.truncated.bytes, true);
  assert.deepEqual(
    snapshot.classes.map((entry) => entry.name),
    [...snapshot.classes.map((entry) => entry.name)].sort(),
  );
});

test("snapshot diff keeps prototype and static changes separate", () => {
  const before = createWebAppSnapshot({
    capturedAt: 1,
    classes: [
      classEntry("UTController", [
        { name: "navigate", kind: "method", arity: 1 },
      ]),
    ],
    capabilities: [{ id: "reward", available: false, reason: "missing" }],
  });
  const after = createWebAppSnapshot({
    capturedAt: 2,
    classes: [
      classEntry(
        "UTController",
        [{ name: "submit", kind: "method", arity: 0 }],
        [{ name: "navigate", kind: "method", arity: 1 }],
      ),
      classEntry("UTRewardController"),
    ],
    capabilities: [{ id: "reward", available: true, valueType: "function" }],
  });

  const diff = diffWebAppSnapshots(before, after);

  assert.deepEqual(diff.addedClasses, ["UTRewardController"]);
  assert.deepEqual(diff.changedClasses[0].prototypeRemoved, ["navigate:method:1"]);
  assert.deepEqual(diff.changedClasses[0].prototypeAdded, ["submit:method:0"]);
  assert.deepEqual(diff.changedClasses[0].staticAdded, ["navigate:method:1"]);
  assert.equal(diff.capabilityChanges[0].id, "reward");
});

test("snapshot history enforces count and aggregate byte limits without mutation", () => {
  const original = [{ id: 1 }];
  const next = appendBoundedSnapshot(original, { id: 2 }, { maxSnapshots: 2 });
  const newest = appendBoundedSnapshot(next, { id: 3 }, { maxSnapshots: 2 });

  assert.deepEqual(original, [{ id: 1 }]);
  assert.deepEqual(newest, [{ id: 2 }, { id: 3 }]);

  const oversized = appendBoundedSnapshot([], { payload: "x".repeat(5_000) }, {
    maxSnapshots: 5,
    maxSnapshotHistoryBytes: 1_000,
  });
  assert.deepEqual(oversized, []);
});
