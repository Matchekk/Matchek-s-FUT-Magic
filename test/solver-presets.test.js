import test from "node:test";
import assert from "node:assert/strict";
import {
  compileSolverPreset,
  getSolverPreset,
  mapSbcStorageMode,
  SbcStorageMode,
  SolverPresetId,
} from "../src/application/solver-presets.js";

test("solver presets map to existing fodder-policy inputs", () => {
  assert.deepEqual(getSolverPreset(SolverPresetId.BALANCED).fodderPolicy, {
    preferDuplicates: true,
    preferSbcStorage: true,
    preferUntradeables: true,
    protectTradables: false,
  });
  assert.equal(getSolverPreset(SolverPresetId.CONSERVATIVE).fodderPolicy.protectTradables, true);
  assert.equal(getSolverPreset(SolverPresetId.DUPLICATES_FIRST).fodderPolicy.preferDuplicates, true);
  assert.equal(getSolverPreset(SolverPresetId.STORAGE_FIRST).storageMode, SbcStorageMode.PREFER);
});

test("storage modes are deterministic and reflect actual availability", () => {
  assert.deepEqual(
    mapSbcStorageMode(SbcStorageMode.AVOID, { storageAvailable: true }).allowedLocations,
    ["club", "unassigned"],
  );
  assert.deepEqual(
    mapSbcStorageMode(SbcStorageMode.SMART, { storageAvailable: false }).allowedLocations,
    ["club", "unassigned"],
  );
  assert.equal(
    mapSbcStorageMode(SbcStorageMode.PREFER, { storageAvailable: true }).preferSbcStorage,
    true,
  );
});

test("Storage Only fails closed unless an enforcing solver boundary is verified", () => {
  const blocked = compileSolverPreset({
    presetId: SolverPresetId.STORAGE_FIRST,
    storageMode: SbcStorageMode.ONLY,
    storageAvailable: true,
  });
  assert.equal(blocked.canApply, false);
  assert.equal(blocked.reason, "STORAGE_ONLY_FILTER_UNVERIFIED");

  const ready = compileSolverPreset({
    storageMode: SbcStorageMode.ONLY,
    storageAvailable: true,
    supportsAllowedLocations: true,
  });
  assert.equal(ready.canApply, true);
  assert.deepEqual(ready.solverSettings.allowedLocations, ["sbc_storage"]);
});

test("unknown presets and storage modes are rejected", () => {
  assert.throws(() => getSolverPreset("FASTEST"), /Unsupported solver preset/);
  assert.throws(() => mapSbcStorageMode("SOMEWHERE"), /Unsupported SBC Storage mode/);
});
