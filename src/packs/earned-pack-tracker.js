import { PackPolicyError, assertOwnedFreePack } from "./pack-policy.js";

const packIdOf = (pack) => String(pack?.packId ?? pack?.id ?? "");
const packTypeOf = (pack) => String(pack?.packType ?? pack?.type ?? "");

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value) => {
  const input = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalizePackRows = (packs) => {
  if (!Array.isArray(packs)) {
    throw new PackPolicyError("INVALID_PACKS", "Pack snapshot must be an array");
  }
  const rows = packs.map((pack) => {
    const packId = packIdOf(pack);
    const count = Number(pack?.count ?? 1);
    if (!packId || !Number.isSafeInteger(count) || count < 0) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshot contains an invalid ID or count");
    }
    assertOwnedFreePack(pack);
    return Object.freeze({
      packId,
      packType: packTypeOf(pack),
      count,
      pack: Object.freeze({ ...pack }),
    });
  });
  rows.sort((left, right) => left.packId.localeCompare(right.packId) || left.packType.localeCompare(right.packType));
  return rows;
};

const countsOf = (rows) => {
  const counts = new Map();
  for (const row of rows) {
    const next = (counts.get(row.packId) ?? 0) + row.count;
    if (!Number.isSafeInteger(next)) {
      throw new PackPolicyError("INVALID_PACKS", "Pack count exceeds the safe range");
    }
    counts.set(row.packId, next);
  }
  return counts;
};

const asSnapshot = (value, options = {}) => value?.schemaVersion === 1 && Array.isArray(value.rows)
  ? value
  : EarnedPackTracker.capture(value, options);

export class EarnedPackTracker {
  static capture(packs, { observedAt = 0, sourceGeneration = null } = {}) {
    const rows = normalizePackRows(packs);
    const timestamp = Number(observedAt);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new PackPolicyError("INVALID_PACKS", "Pack snapshot time is invalid");
    }
    if (sourceGeneration != null && (!Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0)) {
      throw new PackPolicyError("INVALID_PACKS", "Pack source generation is invalid");
    }
    const canonical = rows.map(({ packId, packType, count }) => ({ packId, packType, count }));
    return Object.freeze({
      schemaVersion: 1,
      observedAt: timestamp,
      sourceGeneration,
      rows: Object.freeze(rows),
      fingerprint: fingerprint(canonical),
    });
  }

  static correlate({
    before,
    after,
    claimEvidence = {},
    operationId,
    sourceChallenge = null,
    inventoryGeneration = null,
    correlatedAt = 0,
  } = {}) {
    if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 160) {
      throw new PackPolicyError("INVALID_REWARD_OPERATION", "Reward operation ID is required");
    }
    const beforeSnapshot = asSnapshot(before);
    const afterSnapshot = asSnapshot(after);
    const beforeCounts = countsOf(beforeSnapshot.rows);
    const afterCounts = countsOf(afterSnapshot.rows);
    const deltas = [...afterCounts.entries()]
      .map(([packId, count]) => ({ packId, delta: count - (beforeCounts.get(packId) ?? 0) }))
      .filter(({ delta }) => delta > 0);
    const explicitId = String(claimEvidence?.packId ?? claimEvidence?.rewardPackId ?? "");
    if (deltas.length !== 1 || deltas[0].delta !== 1 || (explicitId && explicitId !== deltas[0].packId)) {
      throw new PackPolicyError(
        "AMBIGUOUS_REWARD_PACK",
        "Exactly one newly earned pack unit could not be correlated",
        { explicitId: explicitId || null, positiveDeltas: deltas },
      );
    }
    const packId = deltas[0].packId;
    const afterRows = afterSnapshot.rows.filter((row) => row.packId === packId);
    const beforeRows = beforeSnapshot.rows.filter((row) => row.packId === packId);
    if (afterRows.length !== 1) {
      throw new PackPolicyError("AMBIGUOUS_REWARD_PACK", "Correlated pack identity has multiple rows");
    }
    const types = new Set([...beforeRows, ...afterRows].map(({ packType }) => packType));
    if (types.size !== 1) {
      throw new PackPolicyError("AMBIGUOUS_REWARD_PACK", "Correlated pack stack is not homogeneous");
    }
    const identityKind = (beforeCounts.get(packId) ?? 0) === 0
      ? "owned_instance"
      : "verified_fungible_stack";
    const binding = Object.freeze({
      schemaVersion: 1,
      operationId: operationId.trim(),
      packRef: Object.freeze({ packId }),
      identityKind,
      packType: afterRows[0].packType || null,
      quantityDelta: 1,
      sourceChallenge: sourceChallenge == null ? null : String(sourceChallenge),
      inventoryGeneration: inventoryGeneration == null ? null : Number(inventoryGeneration),
      beforeFingerprint: beforeSnapshot.fingerprint,
      afterFingerprint: afterSnapshot.fingerprint,
      correlatedAt: Number(correlatedAt),
    });
    return Object.freeze({ binding, pack: afterRows[0].pack });
  }

  static resolve(binding, packs) {
    if (
      !binding || binding.schemaVersion !== 1 || binding.quantityDelta !== 1 ||
      typeof binding.operationId !== "string" || typeof binding.packRef?.packId !== "string"
    ) {
      throw new PackPolicyError("INVALID_REWARD_BINDING", "Earned pack binding is invalid");
    }
    const rows = normalizePackRows(packs).filter(({ packId }) => packId === binding.packRef.packId);
    if (rows.length !== 1 || (binding.packType != null && rows[0].packType !== binding.packType)) {
      throw new PackPolicyError("REWARD_PACK_AMBIGUOUS", "The bound earned pack is no longer uniquely present");
    }
    return rows[0].pack;
  }
}

export const fingerprintPackSnapshot = fingerprint;
