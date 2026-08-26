import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_LOG_REDACTION,
  ActivityLogger,
  redactSecrets,
} from "../src/core/activity-logger.js";

test("recursive redaction removes credentials without mutating caller data", () => {
  const input = {
    safe: "visible",
    auth: {
      accessToken: "top-secret",
      nested: [{ cookie: "sid=abc", rating: 92 }],
    },
    header: "Bearer abc.def.ghi",
  };
  input.loop = input;
  const redacted = redactSecrets(input);

  assert.equal(redacted.safe, "visible");
  assert.equal(redacted.auth.accessToken, ACTIVITY_LOG_REDACTION);
  assert.equal(redacted.auth.nested[0].cookie, ACTIVITY_LOG_REDACTION);
  assert.equal(redacted.auth.nested[0].rating, 92);
  assert.equal(redacted.header, `Bearer ${ACTIVITY_LOG_REDACTION}`);
  assert.equal(redacted.loop, "[Circular]");
  assert.equal(input.auth.accessToken, "top-secret");
});

test("free-text activity fields redact common credential forms", () => {
  const logger = new ActivityLogger({ clock: () => new Date(0) });
  const entry = logger.error(
    "Basic dXNlcjpwYXNz",
    "cookie=session-value password=hunter2 x-ut-sid:abc123 ?code=oauth-code&safe=1",
  );
  const serialized = JSON.stringify(entry);
  for (const secret of ["dXNlcjpwYXNz", "session-value", "hunter2", "abc123", "oauth-code"]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked`);
  }
});

test("activity logger retains a bounded, structured history", () => {
  let seconds = 0;
  const logger = new ActivityLogger({
    maxEntries: 2,
    clock: () => new Date(Date.UTC(2026, 7, 24, 12, 0, seconds++)),
  });
  logger.info("Solve", "first", { rating: 84 });
  logger.warn("Submit", "second", { rating: 85 });
  logger.error("Pause", "third", { sessionToken: "secret" });

  const entries = logger.entries();
  assert.deepEqual(entries.map((entry) => entry.id), [2, 3]);
  assert.equal(entries[0].timestamp, "2026-08-24T12:00:01.000Z");
  assert.equal(entries[1].data.sessionToken, ACTIVITY_LOG_REDACTION);
  assert.equal(logger.entries({ level: "error", limit: 1 }).length, 1);

  entries[0].message = "caller mutation";
  assert.equal(logger.entries()[0].message, "second");
});

test("activity subscriptions return an unsubscribe function", () => {
  const logger = new ActivityLogger();
  const received = [];
  const unsubscribe = logger.subscribe((entry) => received.push(entry.action));
  logger.info("Solve", "started");
  unsubscribe();
  unsubscribe();
  logger.info("Submit", "finished");
  assert.deepEqual(received, ["Solve"]);
});
