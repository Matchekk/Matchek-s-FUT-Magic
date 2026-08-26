const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const COMMAND_FIELDS = Object.freeze({
  REFRESH: [],
  PAUSE_RUN: [],
  RESUME_RUN: [],
  STOP_RUN: [],
  IMPORT_CURRENT_SBC_PROJECT: [],
  PREVIEW_CLEAR_DUPLICATES: [],
  PREVIEW_FODDER_REVIEW: [],
  PREVIEW_SBC_PROJECT: ["projectId"],
  APPROVE_SBC_PLAN: ["projectId", "planId"],
  APPROVE_CLEAR_DUPLICATES_PLAN: ["planId"],
  OPEN_LEGACY_UI: ["section"],
});

export const normalizeFutMagicPanelCommand = (input) => {
  if (!isRecord(input)) return null;
  const type = String(input.type || "");
  const fields = COMMAND_FIELDS[type];
  if (!fields) return null;
  const allowedKeys = new Set(["type", ...fields]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  const command = { type };
  for (const field of fields) {
    const value = String(input[field] || "").trim();
    if (!value || value.length > 128) return null;
    command[field] = value;
  }
  return Object.freeze(command);
};
