export const SolverPresetId = Object.freeze({
  BALANCED: "BALANCED",
  CONSERVATIVE: "CONSERVATIVE",
  DUPLICATES_FIRST: "DUPLICATES_FIRST",
  STORAGE_FIRST: "STORAGE_FIRST",
});

export const SbcStorageMode = Object.freeze({
  SMART: "SMART",
  PREFER: "PREFER",
  ONLY: "ONLY",
  AVOID: "AVOID",
});

const PRESETS = Object.freeze({
  BALANCED: Object.freeze({ id: "BALANCED", translationKey: "solver.preset.balanced", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: false }), storageMode: "SMART" }),
  CONSERVATIVE: Object.freeze({ id: "CONSERVATIVE", translationKey: "solver.preset.conservative", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: true }), storageMode: "SMART" }),
  DUPLICATES_FIRST: Object.freeze({ id: "DUPLICATES_FIRST", translationKey: "solver.preset.duplicatesFirst", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: false, preferUntradeables: true, protectTradables: false }), storageMode: "AVOID" }),
  STORAGE_FIRST: Object.freeze({ id: "STORAGE_FIRST", translationKey: "solver.preset.storageFirst", fodderPolicy: Object.freeze({ preferDuplicates: true, preferSbcStorage: true, preferUntradeables: true, protectTradables: false }), storageMode: "PREFER" }),
});

const assertEnum = (value, values, label) => {
  if (!values.includes(value)) throw new TypeError(`Unsupported ${label}: ${String(value)}`);
};

export function getSolverPreset(id = SolverPresetId.BALANCED) {
  assertEnum(id, Object.values(SolverPresetId), "solver preset");
  const preset = PRESETS[id];
  return Object.freeze({ ...preset, fodderPolicy: Object.freeze({ ...preset.fodderPolicy }) });
}

/**
 * Maps the simple Storage UX onto existing FodderPolicy preferences and a
 * closed location hint. ONLY is never silently downgraded: the solver boundary
 * must prove that it enforces allowed locations.
 */
export function mapSbcStorageMode(mode = SbcStorageMode.SMART, {
  storageAvailable = false,
  supportsAllowedLocations = false,
} = {}) {
  assertEnum(mode, Object.values(SbcStorageMode), "SBC Storage mode");
  const available = storageAvailable === true;
  if (mode === SbcStorageMode.ONLY && (!available || supportsAllowedLocations !== true)) {
    return Object.freeze({
      mode,
      status: "BLOCKED",
      reason: available ? "STORAGE_ONLY_FILTER_UNVERIFIED" : "SBC_STORAGE_UNAVAILABLE",
      preferSbcStorage: true,
      allowedLocations: Object.freeze([]),
      canApply: false,
    });
  }
  const allowedLocations = mode === SbcStorageMode.ONLY
    ? ["sbc_storage"]
    : mode === SbcStorageMode.AVOID
      ? ["club", "unassigned"]
      : available
        ? ["club", "sbc_storage", "unassigned"]
        : ["club", "unassigned"];
  return Object.freeze({
    mode,
    status: "READY",
    reason: null,
    preferSbcStorage: available && mode !== SbcStorageMode.AVOID,
    allowedLocations: Object.freeze(allowedLocations),
    canApply: true,
  });
}

export function compileSolverPreset({
  presetId = SolverPresetId.BALANCED,
  storageMode = null,
  storageAvailable = false,
  supportsAllowedLocations = false,
} = {}) {
  const preset = getSolverPreset(presetId);
  const storage = mapSbcStorageMode(storageMode ?? preset.storageMode, {
    storageAvailable,
    supportsAllowedLocations,
  });
  return Object.freeze({
    presetId: preset.id,
    translationKey: preset.translationKey,
    status: storage.status,
    reason: storage.reason,
    canApply: storage.canApply,
    fodderPolicy: Object.freeze({ ...preset.fodderPolicy, preferSbcStorage: storage.preferSbcStorage }),
    solverSettings: Object.freeze({ storageMode: storage.mode, allowedLocations: storage.allowedLocations }),
  });
}
