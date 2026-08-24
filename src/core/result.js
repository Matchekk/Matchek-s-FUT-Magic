import { toGrindPilotError } from "./errors.js";

/** @template T @typedef {{ok: true, value: T}} SuccessResult */
/** @template E @typedef {{ok: false, error: E}} FailureResult */
/** @template T, E @typedef {SuccessResult<T> | FailureResult<E>} Result */

/** @template T @param {T} value @returns {SuccessResult<T>} */
export const ok = (value) => Object.freeze({ ok: true, value });

/** @template E @param {E} error @returns {FailureResult<E>} */
export const fail = (error) => Object.freeze({ ok: false, error });

/** @param {unknown} value @returns {value is Result<unknown, unknown>} */
export const isResult = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof value.ok === "boolean" &&
      (value.ok ? Object.hasOwn(value, "value") : Object.hasOwn(value, "error")),
  );

/** @template T, E @param {Result<T, E>} result @returns {result is SuccessResult<T>} */
export const isOk = (result) => result?.ok === true;

/** @template T, E @param {Result<T, E>} result @returns {result is FailureResult<E>} */
export const isFailure = (result) => result?.ok === false;

/**
 * @template T
 * @param {() => T} operation
 * @param {Parameters<typeof toGrindPilotError>[1]} [fallback]
 * @returns {Result<T, import('./errors.js').GrindPilotError>}
 */
export const capture = (operation, fallback) => {
  try {
    return ok(operation());
  } catch (error) {
    return fail(toGrindPilotError(error, fallback));
  }
};

/**
 * @template T
 * @param {() => Promise<T> | T} operation
 * @param {Parameters<typeof toGrindPilotError>[1]} [fallback]
 * @returns {Promise<Result<T, import('./errors.js').GrindPilotError>>}
 */
export const captureAsync = async (operation, fallback) => {
  try {
    return ok(await operation());
  } catch (error) {
    return fail(toGrindPilotError(error, fallback));
  }
};

/**
 * @template T, E
 * @param {Result<T, E>} result
 * @returns {T}
 */
export const unwrap = (result) => {
  if (!isResult(result)) throw new TypeError("unwrap requires a Result");
  if (result.ok) return result.value;
  throw result.error;
};
