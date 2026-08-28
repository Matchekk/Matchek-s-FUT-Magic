import { normalizeIdentifier } from "../../inventory/item-model.js";

export const RESERVATION_SCHEMA_VERSION = 1;

export class ReservationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReservationError";
    this.code = code;
    this.details = details;
  }
}

const safeId = (value, field) => {
  const normalized = normalizeIdentifier(value, { required: true, name: field });
  if (normalized.length > 160) throw new ReservationError("INVALID_RESERVATION", `${field} is too long`);
  return normalized;
};

const normalizeCandidate = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ReservationError("INVALID_RESERVATION", "Reservation candidate must be an object");
  }
  const candidateId = safeId(candidate.candidateId, "candidateId");
  const challengeId = safeId(candidate.challengeId, "challengeId");
  const projectId = safeId(candidate.projectId, "projectId");
  if (!Array.isArray(candidate.ownedItemIds) || candidate.ownedItemIds.length > 100) {
    throw new ReservationError("INVALID_RESERVATION", "ownedItemIds must contain at most 100 items");
  }
  const ownedItemIds = candidate.ownedItemIds.map((itemId) => safeId(itemId, "itemId"));
  if (new Set(ownedItemIds).size !== ownedItemIds.length) {
    throw new ReservationError("OWNED_ITEM_REUSED", "Candidate contains the same owned item more than once");
  }
  const conceptRefs = candidate.conceptRefs == null ? [] : candidate.conceptRefs;
  if (!Array.isArray(conceptRefs) || conceptRefs.length > 100) {
    throw new ReservationError("INVALID_RESERVATION", "conceptRefs must contain at most 100 entries");
  }
  return Object.freeze({
    candidateId,
    challengeId,
    projectId,
    ownedItemIds: Object.freeze([...ownedItemIds].sort()),
    conceptRefs: Object.freeze(conceptRefs.map((entry) => String(entry)).sort()),
  });
};

export class ReservationLedger {
  #byItem = new Map();
  #byCandidate = new Map();

  static fromSnapshot(snapshot = {}) {
    if (snapshot.schemaVersion !== RESERVATION_SCHEMA_VERSION || !Array.isArray(snapshot.reservations)) {
      throw new ReservationError("INVALID_RESERVATION_SNAPSHOT", "Reservation snapshot is invalid");
    }
    const ledger = new ReservationLedger();
    const grouped = new Map();
    for (const entry of snapshot.reservations) {
      const candidateId = safeId(entry?.candidateId, "candidateId");
      const candidate = grouped.get(candidateId) ?? {
        candidateId,
        challengeId: entry.challengeId,
        projectId: entry.projectId,
        ownedItemIds: [],
        conceptRefs: [],
      };
      candidate.ownedItemIds.push(entry?.itemRef?.itemId);
      grouped.set(candidateId, candidate);
    }
    for (const candidate of grouped.values()) ledger.reserveCandidate(candidate);
    return ledger;
  }

  reserveCandidate(input) {
    const candidate = normalizeCandidate(input);
    const current = this.#byCandidate.get(candidate.candidateId);
    if (current) {
      if (JSON.stringify(current) === JSON.stringify(candidate)) return this.snapshot();
      throw new ReservationError("CANDIDATE_ALREADY_RESERVED", "Candidate ID already has another reservation");
    }
    const conflicts = candidate.ownedItemIds
      .map((itemId) => this.#byItem.get(itemId))
      .filter(Boolean);
    if (conflicts.length) {
      throw new ReservationError("CONFLICTING_RESERVATION", "Owned item is already reserved", {
        conflicts: conflicts.map(({ candidateId, challengeId, itemId }) => ({ candidateId, challengeId, itemId })),
      });
    }
    this.#byCandidate.set(candidate.candidateId, candidate);
    for (const itemId of candidate.ownedItemIds) {
      this.#byItem.set(itemId, Object.freeze({
        itemId,
        candidateId: candidate.candidateId,
        challengeId: candidate.challengeId,
        projectId: candidate.projectId,
      }));
    }
    return this.snapshot();
  }

  releaseCandidate(candidateId) {
    const id = safeId(candidateId, "candidateId");
    const candidate = this.#byCandidate.get(id);
    if (!candidate) return false;
    for (const itemId of candidate.ownedItemIds) this.#byItem.delete(itemId);
    this.#byCandidate.delete(id);
    return true;
  }

  isItemAvailable(itemId) {
    return !this.#byItem.has(safeId(itemId, "itemId"));
  }

  getConflicts(input) {
    const candidate = normalizeCandidate(input);
    return Object.freeze(candidate.ownedItemIds
      .map((itemId) => this.#byItem.get(itemId))
      .filter(Boolean)
      .map((entry) => Object.freeze({ ...entry })));
  }

  reservedItemIds() {
    return Object.freeze([...this.#byItem.keys()].sort());
  }

  snapshot() {
    const reservations = [...this.#byItem.values()]
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
      .map((entry) => Object.freeze({
        itemRef: Object.freeze({ kind: "owned", itemId: entry.itemId }),
        projectId: entry.projectId,
        challengeId: entry.challengeId,
        candidateId: entry.candidateId,
      }));
    return Object.freeze({
      schemaVersion: RESERVATION_SCHEMA_VERSION,
      reservations: Object.freeze(reservations),
    });
  }
}
