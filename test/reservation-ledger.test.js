import test from "node:test";
import assert from "node:assert/strict";

import { ReservationLedger } from "../src/sbc/planning/index.js";

const candidate = (candidateId, challengeId, ownedItemIds) => ({
  candidateId,
  challengeId,
  projectId: "project",
  ownedItemIds,
});

test("reservations canonicalize owned identity and reserve atomically", () => {
  const ledger = new ReservationLedger();
  ledger.reserveCandidate(candidate("a", "challenge-a", [42, "43"]));
  assert.equal(ledger.isItemAvailable("42"), false);
  assert.equal(ledger.isItemAvailable(44), true);
  assert.throws(
    () => ledger.reserveCandidate(candidate("b", "challenge-b", ["44", "42"])),
    { code: "CONFLICTING_RESERVATION" },
  );
  assert.equal(ledger.isItemAvailable("44"), true);
});

test("duplicate owned item inside one candidate is rejected", () => {
  const ledger = new ReservationLedger();
  assert.throws(
    () => ledger.reserveCandidate(candidate("a", "challenge-a", [42, "42"])),
    { code: "OWNED_ITEM_REUSED" },
  );
});

test("release and serialized restore preserve exact reservations", () => {
  const ledger = new ReservationLedger();
  ledger.reserveCandidate(candidate("a", "challenge-a", ["one", "two"]));
  const restored = ReservationLedger.fromSnapshot(JSON.parse(JSON.stringify(ledger.snapshot())));
  assert.deepEqual(restored.snapshot(), ledger.snapshot());
  assert.equal(restored.releaseCandidate("a"), true);
  assert.equal(restored.releaseCandidate("a"), false);
  assert.equal(restored.isItemAvailable("one"), true);
});

test("concept references never reserve owned items", () => {
  const ledger = new ReservationLedger();
  ledger.reserveCandidate({
    ...candidate("concept", "challenge", []),
    conceptRefs: ["one", "two"],
  });
  assert.deepEqual(ledger.reservedItemIds(), []);
});
