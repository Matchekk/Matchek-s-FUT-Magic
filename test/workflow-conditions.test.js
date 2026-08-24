import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCondition,
  readConditionPath,
  validateCondition,
} from "../src/workflow/index.js";

const path = (value) => ({ type: "PATH", path: value });
const literal = (value) => ({ type: "LITERAL", value });
const compare = (left, operator, right) => ({
  type: "COMPARE",
  left,
  operator,
  right,
});

test("evaluates nested typed conditions without JavaScript evaluation", () => {
  const condition = {
    type: "ALL",
    conditions: [
      compare(path("inventory.duplicateRating"), "GTE", literal(90)),
      {
        type: "NOT",
        condition: compare(path("inventory.unresolved"), "GT", literal(0)),
      },
      {
        type: "EXISTS",
        operand: path(["targetProject", "name"]),
      },
    ],
  };
  const context = {
    inventory: { duplicateRating: 92, unresolved: 0 },
    targetProject: { name: "Icon Project" },
  };
  assert.equal(evaluateCondition(condition, context), true);
  assert.equal(
    evaluateCondition(condition, {
      ...context,
      inventory: { duplicateRating: 89, unresolved: 0 },
    }),
    false,
  );
});

test("COUNT_IN_RANGE supports inventory threshold conditions", () => {
  const condition = compare(
    {
      type: "COUNT_IN_RANGE",
      collection: path("inventory.clubPlayers"),
      field: "rating",
      min: 85,
      max: 88,
    },
    "GTE",
    literal(3),
  );
  const context = {
    inventory: {
      clubPlayers: [
        { itemId: 1, rating: 84 },
        { itemId: 2, rating: 85 },
        { itemId: 3, rating: 87 },
        { itemId: 4, rating: 88 },
        { itemId: 5, rating: 90 },
      ],
    },
  };
  assert.equal(evaluateCondition(condition, context), true);
});

test("rejects unknown operations and prototype traversal paths", () => {
  const invalidOperator = validateCondition(
    compare(path("value"), "EXECUTE", literal(true)),
  );
  assert.equal(invalidOperator.ok, false);
  assert.equal(readConditionPath({}, "constructor.prototype"), undefined);
  const unsafePath = validateCondition({
    type: "TRUTHY",
    operand: path("__proto__.polluted"),
  });
  assert.equal(unsafePath.ok, false);
});

