import test from "node:test";
import assert from "node:assert/strict";

import { FodderPolicy } from "../src/policies/fodder-policy.js";
import { TargetProjectService } from "../src/policies/target-project-service.js";

test("active arbitrary target projects contribute rating and special reserves", () => {
  const service = new TargetProjectService([
    {
      id: "project-a",
      name: "My long SBC",
      active: true,
      priority: 3,
      requiredSquadsRemaining: 2,
      ratingRequirements: [{ rating: 90, count: 2 }],
      specialCardRequirements: [
        { cardType: "totw", count: 1, perRemainingSquad: true },
      ],
      protectedRatings: {
        atOrAbove: 94,
        reserveByRating: { 89: 1 },
      },
    },
    {
      id: "done",
      name: "Finished project",
      completionProgress: 1,
      protectedRatings: 80,
    },
  ]);
  const overlay = service.getFodderPolicyOverlay();
  assert.equal(overlay.protectRatingAtOrAbove, 94);
  assert.equal(overlay.minimumReserveByRating[89], 1);
  assert.equal(overlay.specialReserveByCardType.totw, 2);
  assert.deepEqual(overlay.activeProjectIds, ["project-a"]);

  const policy = new FodderPolicy({}, { targetProjects: service });
  const analysis = policy.analyze([
    { itemId: "89", resourceId: "r89", basePlayerId: "b89", rating: 89 },
    { itemId: "94", resourceId: "r94", basePlayerId: "b94", rating: 94 },
    {
      itemId: "t1",
      resourceId: "rt1",
      basePlayerId: "bt1",
      rating: 84,
      cardType: "totw",
      isSpecial: true,
    },
    {
      itemId: "t2",
      resourceId: "rt2",
      basePlayerId: "bt2",
      rating: 83,
      cardType: "totw",
      isSpecial: true,
    },
  ]);
  assert.deepEqual(new Set(analysis.protectedItemIds), new Set(["94"]));
  const softPolicy = policy.toSolverConservationPolicy();
  assert.equal(softPolicy.minimumReserveByRating[89], 1);
  assert.equal(softPolicy.specialReserveByCardType.totw, 2);
  assert.ok(softPolicy.projectRatingDemand.some((entry) => entry.rating === 90));
});

test("project CRUD is immutable to callers", () => {
  const service = new TargetProjectService([]);
  service.upsert({ id: "x", name: "Target X", protectedRatings: [90] });
  const listed = service.list();
  listed[0].name = "mutated";
  assert.equal(service.list()[0].name, "Target X");
  assert.equal(service.remove("x"), true);
  assert.deepEqual(service.list(), []);
});
