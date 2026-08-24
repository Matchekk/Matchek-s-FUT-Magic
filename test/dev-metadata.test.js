import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeDiagnosticValue,
  sanitizeNetworkBatch,
  sanitizeNetworkMetadata,
  sanitizeRouteMetadata,
} from "../src/dev/index.js";

test("route metadata drops query strings, fragments and credentials", () => {
  const route = sanitizeRouteMetadata({
    timestamp: 10,
    type: "pushState",
    from: "https://www.ea.com/web-app/sbc?access_token=secret#private",
    to: "https://www.ea.com/web-app/store?sid=abc#pack",
  });

  assert.deepEqual(route.from, {
    origin: "https://www.ea.com",
    pathname: "/web-app/sbc",
  });
  assert.deepEqual(route.to, {
    origin: "https://www.ea.com",
    pathname: "/web-app/store",
  });
  assert.equal(JSON.stringify(route).includes("secret"), false);
  assert.equal(sanitizeRouteMetadata({ from: "https://user:pass@ea.com/path" }), null);
});

test("network metadata requires an allowlist and only returns safe fields", () => {
  const raw = {
    url: "https://utas.example.test/ut/game/fc26/club?token=secret#fragment",
    method: "post",
    status: 200,
    durationMs: 12.345,
    size: 321,
    authorization: "Bearer secret",
    headers: { cookie: "private" },
    body: { password: "private" },
    response: { accessToken: "private" },
  };

  assert.equal(sanitizeNetworkMetadata(raw), null);
  assert.equal(
    sanitizeNetworkMetadata(raw, { allowedOrigins: ["https://other.example.test"] }),
    null,
  );
  const safe = sanitizeNetworkMetadata(raw, {
    allowedOrigins: ["https://utas.example.test"],
  });

  assert.deepEqual(safe, {
    timestamp: null,
    requestId: "",
    origin: "https://utas.example.test",
    pathname: "/ut/game/fc26/club",
    method: "POST",
    status: 200,
    ok: true,
    durationMs: 12.35,
    sizeBytes: 321,
    transport: "adapter",
    errorCode: null,
  });
  assert.equal(JSON.stringify(safe).includes("secret"), false);
});

test("already sanitized metadata can be safely sanitized again", () => {
  const allowedOrigins = ["https://utas.example.test"];
  const first = sanitizeNetworkMetadata(
    { url: "https://utas.example.test/path?q=private", status: 204 },
    { allowedOrigins },
  );
  const batch = sanitizeNetworkBatch([first], { allowedOrigins });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].pathname, "/path");
});

test("diagnostic redaction does not invoke getters", () => {
  let getterCalls = 0;
  const input = {
    authorization: "Bearer abc",
    nested: {
      accessToken: "abc",
      text: "token=very-secret",
    },
  };
  Object.defineProperty(input, "dangerous", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "secret";
    },
  });

  const safe = sanitizeDiagnosticValue(input);
  const serialized = JSON.stringify(safe);
  assert.equal(getterCalls, 0);
  assert.equal(safe.authorization, "[REDACTED]");
  assert.equal(safe.nested.accessToken, "[REDACTED]");
  assert.equal(safe.dangerous, "[Accessor omitted]");
  assert.equal(serialized.includes("very-secret"), false);
});
