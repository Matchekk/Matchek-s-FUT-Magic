const finiteNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nonNegativeInteger = (value, fallback = 0) =>
  Math.max(0, Math.trunc(finiteNumber(value, fallback)));

const normalizeIdList = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map(String),
    ),
  );

const normalizeReserveMap = (value) => {
  const entries = value && typeof value === "object" ? Object.entries(value) : [];
  return Object.fromEntries(
    entries
      .map(([rating, count]) => [String(nonNegativeInteger(rating)), nonNegativeInteger(count)])
      .filter(([rating, count]) => Number(rating) >= 1 && Number(rating) <= 99 && count > 0),
  );
};

const normalizeProtectedRatings = (value) => {
  if (typeof value === "number") {
    return {
      atOrAbove: Math.min(99, Math.max(1, Math.trunc(value))),
      exact: [],
      reserveByRating: {},
    };
  }
  if (Array.isArray(value)) {
    return {
      atOrAbove: null,
      exact: Array.from(
        new Set(value.map((rating) => nonNegativeInteger(rating)).filter((rating) => rating >= 1 && rating <= 99)),
      ),
      reserveByRating: {},
    };
  }
  const source = value && typeof value === "object" ? value : {};
  const threshold = finiteNumber(source.atOrAbove, null);
  return {
    atOrAbove:
      threshold == null ? null : Math.min(99, Math.max(1, Math.trunc(threshold))),
    exact: Array.from(
      new Set(
        (Array.isArray(source.exact) ? source.exact : [])
          .map((rating) => nonNegativeInteger(rating))
          .filter((rating) => rating >= 1 && rating <= 99),
      ),
    ),
    reserveByRating: normalizeReserveMap(
      source.reserveByRating ?? source.minimumReserveByRating,
    ),
  };
};

const normalizeRatingRequirements = (requirements) =>
  (Array.isArray(requirements) ? requirements : [])
    .map((requirement) => {
      const source =
        typeof requirement === "number" ? { rating: requirement } : requirement || {};
      const rating = nonNegativeInteger(source.rating ?? source.squadRating);
      if (rating < 1 || rating > 99) return null;
      return {
        rating,
        count: Math.max(1, nonNegativeInteger(source.count, 1)),
        completed: nonNegativeInteger(source.completed),
      };
    })
    .filter(Boolean);

const normalizeSpecialRequirements = (requirements) =>
  (Array.isArray(requirements) ? requirements : [])
    .map((requirement) => {
      const source = typeof requirement === "string" ? { cardType: requirement } : requirement || {};
      const cardType = String(source.cardType ?? source.type ?? "").trim().toLowerCase();
      if (!cardType) return null;
      return {
        cardType,
        count: Math.max(1, nonNegativeInteger(source.count, 1)),
        completed: nonNegativeInteger(source.completed),
        perRemainingSquad: source.perRemainingSquad === true,
      };
    })
    .filter(Boolean);

export const normalizeTargetProject = (project, index = 0) => {
  if (!project || typeof project !== "object") {
    throw new TypeError("target project must be an object");
  }
  const id = String(project.id ?? `target-project-${index + 1}`);
  const name = String(project.name ?? "").trim();
  if (!name) throw new TypeError(`target project ${id} requires a name`);
  return {
    id,
    name,
    active: project.active !== false,
    priority: Math.max(0, nonNegativeInteger(project.priority, 1)),
    requiredSquadsRemaining: nonNegativeInteger(
      project.requiredSquadsRemaining ?? project.remainingSquads,
    ),
    ratingRequirements: normalizeRatingRequirements(project.ratingRequirements),
    specialCardRequirements: normalizeSpecialRequirements(
      project.specialCardRequirements,
    ),
    protectedRatings: normalizeProtectedRatings(project.protectedRatings),
    protectedPlayerIds: normalizeIdList(project.protectedPlayerIds),
    protectedResourceIds: normalizeIdList(project.protectedResourceIds),
    completionProgress: Math.min(
      1,
      Math.max(0, finiteNumber(project.completionProgress, 0)),
    ),
  };
};

export class TargetProjectService {
  #projects;

  constructor(projects = []) {
    this.#projects = (Array.isArray(projects) ? projects : []).map(
      normalizeTargetProject,
    );
  }

  list() {
    return this.#projects.map((project) => structuredClone(project));
  }

  getActiveProjects() {
    return this.list()
      .filter(
        (project) =>
          project.active &&
          project.completionProgress < 1 &&
          (project.requiredSquadsRemaining > 0 ||
            project.ratingRequirements.length > 0 ||
            project.specialCardRequirements.length > 0 ||
          project.protectedRatings.atOrAbove != null ||
            project.protectedRatings.exact.length > 0 ||
            Object.keys(project.protectedRatings.reserveByRating).length > 0 ||
            project.protectedPlayerIds.length > 0 ||
            project.protectedResourceIds.length > 0),
      )
      .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  }

  upsert(project) {
    const normalized = normalizeTargetProject(project, this.#projects.length);
    const index = this.#projects.findIndex((candidate) => candidate.id === normalized.id);
    if (index >= 0) this.#projects[index] = normalized;
    else this.#projects.push(normalized);
    return structuredClone(normalized);
  }

  remove(id) {
    const before = this.#projects.length;
    this.#projects = this.#projects.filter((project) => project.id !== String(id));
    return this.#projects.length !== before;
  }

  /** Aggregate only explicit hard protection and auditable project demand. */
  getFodderPolicyOverlay() {
    const projects = this.getActiveProjects();
    let protectRatingAtOrAbove = null;
    const protectedExactRatings = new Set();
    const protectedPlayerIds = new Set();
    const protectedResourceIds = new Set();
    const minimumReserveByRating = {};
    const projectRatingDemand = [];
    const specialReserveByCardType = {};

    for (const project of projects) {
      const protectedRatings = project.protectedRatings;
      if (protectedRatings.atOrAbove != null) {
        protectRatingAtOrAbove =
          protectRatingAtOrAbove == null
            ? protectedRatings.atOrAbove
            : Math.min(protectRatingAtOrAbove, protectedRatings.atOrAbove);
      }
      for (const rating of protectedRatings.exact) protectedExactRatings.add(rating);
      for (const id of project.protectedPlayerIds) protectedPlayerIds.add(id);
      for (const id of project.protectedResourceIds) protectedResourceIds.add(id);
      for (const [rating, count] of Object.entries(protectedRatings.reserveByRating)) {
        minimumReserveByRating[rating] =
          (minimumReserveByRating[rating] || 0) + count;
      }
      for (const requirement of project.ratingRequirements) {
        const remaining = Math.max(0, requirement.count - requirement.completed);
        if (!remaining) continue;
        projectRatingDemand.push({
          projectId: project.id,
          rating: requirement.rating,
          count: remaining,
          priority: project.priority,
        });
      }
      for (const requirement of project.specialCardRequirements) {
        const remaining = Math.max(0, requirement.count - requirement.completed);
        const multiplier = requirement.perRemainingSquad
          ? Math.max(1, project.requiredSquadsRemaining)
          : 1;
        specialReserveByCardType[requirement.cardType] =
          (specialReserveByCardType[requirement.cardType] || 0) +
          remaining * multiplier;
      }
    }

    return {
      protectRatingAtOrAbove,
      protectedExactRatings: [...protectedExactRatings].sort((a, b) => a - b),
      protectedPlayerIds: [...protectedPlayerIds],
      protectedResourceIds: [...protectedResourceIds],
      minimumReserveByRating,
      projectRatingDemand,
      specialReserveByCardType,
      activeProjectIds: projects.map((project) => project.id),
    };
  }
}
