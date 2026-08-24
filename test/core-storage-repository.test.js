import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_CODES, isGrindPilotError } from "../src/core/errors.js";
import {
  MemoryStorageAdapter,
  RevisionedStorageRepository,
} from "../src/core/storage-repository.js";

const createRepository = (overrides = {}) =>
  new RevisionedStorageRepository({
    storage: new MemoryStorageAdapter(),
    allowlist: {
      profiles: { maxBytes: 4096 },
      workflow: { maxBytes: 4096 },
      tiny: { maxBytes: 180 },
    },
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
    ...overrides,
  });

test("repository rejects non-allowlisted keys before touching storage", async () => {
  const repository = createRepository();
  await assert.rejects(
    repository.set("authentication", { token: "never" }),
    (error) => isGrindPilotError(error, ERROR_CODES.STORAGE_KEY_NOT_ALLOWED),
  );
});

test("records have monotonic revisions and protect against stale writes", async () => {
  const repository = createRepository();
  const absent = await repository.get("profiles");
  assert.deepEqual(absent, {
    key: "profiles",
    exists: false,
    revision: 0,
    updatedAt: null,
    value: null,
  });

  const first = await repository.set("profiles", [{ name: "Daily" }], {
    expectedRevision: 0,
  });
  assert.equal(first.revision, 1);
  assert.equal(first.updatedAt, "2026-08-24T12:00:00.000Z");
  await assert.rejects(
    repository.set("profiles", [], { expectedRevision: 0 }),
    (error) => {
      assert.equal(error.details.actualRevision, 1);
      return isGrindPilotError(error, ERROR_CODES.STORAGE_REVISION_CONFLICT);
    },
  );

  const removed = await repository.remove("profiles", { expectedRevision: 1 });
  assert.equal(removed.exists, false);
  assert.equal(removed.revision, 2);
  const restored = await repository.set("profiles", [], { expectedRevision: 2 });
  assert.equal(restored.revision, 3);
});

test("queued updates do not lose increments inside one repository instance", async () => {
  const repository = createRepository();
  await repository.set("workflow", { iterations: 0 });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      repository.update("workflow", async (value) => {
        await Promise.resolve();
        return { iterations: value.iterations + 1 };
      }),
    ),
  );
  const record = await repository.get("workflow");
  assert.equal(record.value.iterations, 20);
  assert.equal(record.revision, 21);
});

test("size limits count UTF-8 bytes and fail before adapter write", async () => {
  const storage = new MemoryStorageAdapter();
  const repository = createRepository({ storage });
  await assert.rejects(
    repository.set("tiny", { text: "⚽".repeat(100) }),
    (error) => {
      assert.equal(error.details.bytes > error.details.maxBytes, true);
      return isGrindPilotError(error, ERROR_CODES.STORAGE_SIZE_EXCEEDED);
    },
  );
  assert.equal(await storage.read("grindpilot:tiny"), null);
});

test("corrupt envelopes fail closed", async () => {
  const storage = new MemoryStorageAdapter({ "grindpilot:profiles": "not-json" });
  const repository = createRepository({ storage });
  await assert.rejects(
    repository.get("profiles"),
    (error) => isGrindPilotError(error, ERROR_CODES.STORAGE_CORRUPT),
  );
});

test("stored and returned values cannot mutate repository state by reference", async () => {
  const repository = createRepository();
  const original = { nested: { value: 1 } };
  const stored = await repository.set("profiles", original);
  original.nested.value = 2;
  stored.value.nested.value = 3;
  assert.equal((await repository.get("profiles")).value.nested.value, 1);
});
