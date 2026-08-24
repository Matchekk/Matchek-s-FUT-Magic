import { WorkflowValidationError } from "./errors.js";
import { isPlainObject } from "./serialization.js";

export const ConditionType = Object.freeze({
  COMPARE: "COMPARE",
  ALL: "ALL",
  ANY: "ANY",
  NOT: "NOT",
  TRUTHY: "TRUTHY",
  EXISTS: "EXISTS",
});

export const ConditionOperator = Object.freeze({
  EQ: "EQ",
  NEQ: "NEQ",
  GT: "GT",
  GTE: "GTE",
  LT: "LT",
  LTE: "LTE",
  IN: "IN",
  NOT_IN: "NOT_IN",
  CONTAINS: "CONTAINS",
});

export const OperandType = Object.freeze({
  LITERAL: "LITERAL",
  PATH: "PATH",
  COUNT: "COUNT",
  COUNT_IN_RANGE: "COUNT_IN_RANGE",
});

const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_CONDITION_DEPTH = 20;
const MAX_CONDITION_CHILDREN = 100;

const normalizeType = (value) => String(value ?? "").trim().toUpperCase();

const toPathSegments = (path) => {
  const raw = Array.isArray(path)
    ? path
    : typeof path === "string"
      ? path.split(".")
      : [];
  const segments = raw.map((part) => String(part).trim()).filter(Boolean);
  if (!segments.length || segments.some((part) => BLOCKED_PATH_SEGMENTS.has(part))) {
    return null;
  }
  return segments;
};

export const readConditionPath = (root, path) => {
  const segments = toPathSegments(path);
  if (!segments) return undefined;
  let cursor = root;
  for (const segment of segments) {
    if (cursor == null || (typeof cursor !== "object" && typeof cursor !== "function")) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

const validateOperandInto = (operand, path, issues, depth) => {
  if (depth > MAX_CONDITION_DEPTH) {
    issues.push({ path, code: "CONDITION_TOO_DEEP", message: "Condition is too deeply nested." });
    return;
  }
  if (!isPlainObject(operand)) {
    issues.push({ path, code: "OPERAND_INVALID", message: "Operand must be a typed object." });
    return;
  }
  const type = normalizeType(operand.type);
  if (!Object.values(OperandType).includes(type)) {
    issues.push({ path: `${path}.type`, code: "OPERAND_TYPE_INVALID", message: `Unsupported operand type: ${type || "<empty>"}.` });
    return;
  }
  if (type === OperandType.PATH && !toPathSegments(operand.path)) {
    issues.push({ path: `${path}.path`, code: "OPERAND_PATH_INVALID", message: "PATH requires a safe non-empty path." });
  }
  if (type === OperandType.COUNT) {
    validateOperandInto(operand.value, `${path}.value`, issues, depth + 1);
  }
  if (type === OperandType.COUNT_IN_RANGE) {
    validateOperandInto(operand.collection, `${path}.collection`, issues, depth + 1);
    if (operand.field != null && !toPathSegments(operand.field)) {
      issues.push({ path: `${path}.field`, code: "OPERAND_PATH_INVALID", message: "COUNT_IN_RANGE field must be a safe path." });
    }
    if (operand.min != null && !Number.isFinite(Number(operand.min))) {
      issues.push({ path: `${path}.min`, code: "OPERAND_RANGE_INVALID", message: "Range minimum must be numeric." });
    }
    if (operand.max != null && !Number.isFinite(Number(operand.max))) {
      issues.push({ path: `${path}.max`, code: "OPERAND_RANGE_INVALID", message: "Range maximum must be numeric." });
    }
  }
};

const validateConditionInto = (condition, path, issues, depth) => {
  if (depth > MAX_CONDITION_DEPTH) {
    issues.push({ path, code: "CONDITION_TOO_DEEP", message: "Condition is too deeply nested." });
    return;
  }
  if (!isPlainObject(condition)) {
    issues.push({ path, code: "CONDITION_INVALID", message: "Condition must be a typed object." });
    return;
  }
  const type = normalizeType(condition.type);
  if (!Object.values(ConditionType).includes(type)) {
    issues.push({ path: `${path}.type`, code: "CONDITION_TYPE_INVALID", message: `Unsupported condition type: ${type || "<empty>"}.` });
    return;
  }
  if (type === ConditionType.ALL || type === ConditionType.ANY) {
    if (!Array.isArray(condition.conditions) || !condition.conditions.length) {
      issues.push({ path: `${path}.conditions`, code: "CONDITION_CHILDREN_REQUIRED", message: `${type} requires at least one child condition.` });
      return;
    }
    if (condition.conditions.length > MAX_CONDITION_CHILDREN) {
      issues.push({ path: `${path}.conditions`, code: "CONDITION_CHILDREN_LIMIT", message: `A condition may contain at most ${MAX_CONDITION_CHILDREN} children.` });
      return;
    }
    condition.conditions.forEach((child, index) =>
      validateConditionInto(child, `${path}.conditions[${index}]`, issues, depth + 1),
    );
    return;
  }
  if (type === ConditionType.NOT) {
    validateConditionInto(condition.condition, `${path}.condition`, issues, depth + 1);
    return;
  }
  if (type === ConditionType.COMPARE) {
    const operator = normalizeType(condition.operator);
    if (!Object.values(ConditionOperator).includes(operator)) {
      issues.push({ path: `${path}.operator`, code: "CONDITION_OPERATOR_INVALID", message: `Unsupported comparison operator: ${operator || "<empty>"}.` });
    }
    validateOperandInto(condition.left, `${path}.left`, issues, depth + 1);
    validateOperandInto(condition.right, `${path}.right`, issues, depth + 1);
    return;
  }
  validateOperandInto(condition.operand, `${path}.operand`, issues, depth + 1);
};

export const validateCondition = (condition) => {
  const issues = [];
  validateConditionInto(condition, "condition", issues, 0);
  return { ok: issues.length === 0, issues };
};

export const assertValidCondition = (condition) => {
  const result = validateCondition(condition);
  if (!result.ok) throw new WorkflowValidationError(result.issues);
  return condition;
};

const resolveOperand = (operand, context) => {
  const type = normalizeType(operand?.type);
  if (type === OperandType.LITERAL) return operand.value;
  if (type === OperandType.PATH) return readConditionPath(context, operand.path);
  if (type === OperandType.COUNT) {
    const value = resolveOperand(operand.value, context);
    if (Array.isArray(value) || typeof value === "string") return value.length;
    if (isPlainObject(value)) return Object.keys(value).length;
    return 0;
  }
  if (type === OperandType.COUNT_IN_RANGE) {
    const collection = resolveOperand(operand.collection, context);
    if (!Array.isArray(collection)) return 0;
    const min = operand.min == null ? Number.NEGATIVE_INFINITY : Number(operand.min);
    const max = operand.max == null ? Number.POSITIVE_INFINITY : Number(operand.max);
    return collection.reduce((count, item) => {
      const raw = operand.field == null ? item : readConditionPath(item, operand.field);
      const numeric = Number(raw);
      return Number.isFinite(numeric) && numeric >= min && numeric <= max
        ? count + 1
        : count;
    }, 0);
  }
  return undefined;
};

const compare = (left, operator, right) => {
  switch (operator) {
    case ConditionOperator.EQ:
      return Object.is(left, right);
    case ConditionOperator.NEQ:
      return !Object.is(left, right);
    case ConditionOperator.GT:
      return left > right;
    case ConditionOperator.GTE:
      return left >= right;
    case ConditionOperator.LT:
      return left < right;
    case ConditionOperator.LTE:
      return left <= right;
    case ConditionOperator.IN:
      return Array.isArray(right) ? right.includes(left) : false;
    case ConditionOperator.NOT_IN:
      return Array.isArray(right) ? !right.includes(left) : true;
    case ConditionOperator.CONTAINS:
      return Array.isArray(left)
        ? left.includes(right)
        : typeof left === "string"
          ? left.includes(String(right))
          : false;
    default:
      return false;
  }
};

const evaluateValidCondition = (condition, context) => {
  const type = normalizeType(condition.type);
  if (type === ConditionType.ALL) {
    return condition.conditions.every((child) => evaluateValidCondition(child, context));
  }
  if (type === ConditionType.ANY) {
    return condition.conditions.some((child) => evaluateValidCondition(child, context));
  }
  if (type === ConditionType.NOT) {
    return !evaluateValidCondition(condition.condition, context);
  }
  if (type === ConditionType.COMPARE) {
    return compare(
      resolveOperand(condition.left, context),
      normalizeType(condition.operator),
      resolveOperand(condition.right, context),
    );
  }
  const value = resolveOperand(condition.operand, context);
  if (type === ConditionType.EXISTS) return value !== undefined && value !== null;
  return Boolean(value);
};

export const evaluateCondition = (condition, context = {}) => {
  assertValidCondition(condition);
  return evaluateValidCondition(condition, context);
};

