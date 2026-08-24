export class SolverRequestError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SolverRequestError";
    this.code = "INVALID_SOLVER_REQUEST";
    this.details = details;
  }
}

export const validateSolverRequest = (request) => {
  if (!request || typeof request !== "object") {
    throw new SolverRequestError("solver request must be an object");
  }
  if (!Array.isArray(request.players)) {
    throw new SolverRequestError("solver request requires a players array");
  }
  if (!Array.isArray(request.requirementsNormalized)) {
    throw new SolverRequestError(
      "solver request requires a requirementsNormalized array",
    );
  }
  return request;
};

/**
 * Stable boundary for the in-browser solver and future optional engines.
 * Implementations may return a result directly or a Promise of a result.
 */
export class SolverInterface {
  constructor(id) {
    if (!id) throw new TypeError("solver adapter requires an id");
    this.id = String(id);
  }

  get capabilities() {
    return Object.freeze({ browser: true, sidecarRequired: false });
  }

  solve(_request) {
    throw new Error(`${this.id}.solve() is not implemented`);
  }
}
