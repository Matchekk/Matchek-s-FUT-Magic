import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeveloperMode,
  createDiagnosticsExport,
  jsonByteLength,
  serializeDiagnosticsExport,
} from "../src/dev/index.js";

test("diagnostics exports redact secrets and enforce byte/item limits", () => {
  const bundle = createDiagnosticsExport(
    {
      generatedAt: 99,
      developerMode: { enabled: true, sessionToken: "private" },
      logs: Array.from({ length: 20 }, (_, index) => ({
        index,
        message: `Bearer secret-${index}`,
        password: "private",
        detail: "x".repeat(300),
      })),
      healthChecks: Array.from({ length: 10 }, () => ({ ok: true, token: "private" })),
      network: [
        {
          url: "https://utas.example.test/club?token=private",
          status: 200,
        },
      ],
    },
    {
      allowedOrigins: ["https://utas.example.test"],
      maxLogs: 5,
      maxExportBytes: 3_000,
    },
  );
  const serialized = JSON.stringify(bundle);

  assert.ok(bundle.logs.length <= 5);
  assert.ok(jsonByteLength(bundle) <= 3_000);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("secret-"), false);
  assert.equal(bundle.network[0].pathname, "/club");
  assert.doesNotThrow(() => JSON.parse(serializeDiagnosticsExport(bundle, {
    allowedOrigins: ["https://utas.example.test"],
    maxExportBytes: 3_000,
  })));
});

test("diagnostics omit network data when no origin was explicitly allowed", () => {
  const bundle = createDiagnosticsExport({
    network: [{ url: "https://utas.example.test/private", status: 200 }],
  });
  assert.deepEqual(bundle.network, []);
});

test("Developer Mode captures, compares and exports only after opt-in", () => {
  class UTWorkflowController {
    start() {}
  }
  const root = { UTWorkflowController, Services: { claim: () => true } };
  let timestamp = 100;
  const mode = createDeveloperMode({
    root,
    now: () => timestamp,
    extensionVersion: "3.0.0",
    capabilityDefinitions: [
      { id: "claim", path: "Services.claim", expectedType: "function" },
    ],
    allowedNetworkOrigins: ["https://utas.example.test"],
  });

  assert.equal(mode.recordRoute({ to: "https://www.ea.com/web-app/sbc" }), false);
  assert.equal(mode.recordNetwork({ url: "https://utas.example.test/club" }), false);

  mode.enable();
  mode.captureSnapshot();
  UTWorkflowController.prototype.stop = function stop() {};
  timestamp = 101;
  mode.captureSnapshot();
  assert.equal(mode.compareLatestSnapshots().changedClasses.length, 1);
  assert.equal(
    mode.recordRoute({ to: "https://www.ea.com/web-app/sbc?token=private" }),
    true,
  );
  assert.equal(
    mode.recordNetwork({
      url: "https://utas.example.test/club?token=private",
      status: 200,
    }),
    true,
  );
  mode.recordLog({ message: "resolved", cookie: "private" });

  const exported = mode.exportDiagnostics();
  const serialized = JSON.stringify(exported);
  assert.equal(exported.developerMode.hooksInstalled, false);
  assert.equal(exported.network.length, 1);
  assert.equal(exported.navigation.length, 1);
  assert.equal(serialized.includes("private"), false);

  mode.disable();
  assert.equal(mode.getStatus().networkCount, 0);
  assert.equal(mode.getStatus().routeCount, 0);
});
