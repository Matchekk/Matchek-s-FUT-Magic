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

const normalizeSourceChallenges = (challenges) =>
  (Array.isArray(challenges) ? challenges : [])
    .map((challenge) => {
      const id = String(challenge?.id ?? challenge?.challengeId ?? "").trim();
      if (!id) return null;
      const rating = finiteNumber(
        challenge?.requiredSquadRating ?? challenge?.rating,
        null,
      );
      return {
        id,
        name: challenge?.name == null ? null : String(challenge.name),
        completed: challenge?.completed === true,
        requiredSquadRating:
          rating == null ? null : Math.max(1, Math.min(99, Math.trunc(rating))),
        specialCardRequirements: normalizeSpecialRequirements(
          challenge?.specialCardRequirements,
        ),
        unknownRequirements: Array.isArray(challenge?.unknownRequirements)
          ? challenge.unknownRequirements.map((value) => String(value))
          : [],
      };
    })
    .filter(Boolean);

const aggregateSourceChallenges = (challenges) => {
  const rating = new Map();
  const specials = new Map();
  for (const challenge of challenges) {
    if (challenge.requiredSquadRating != null) {
      const entry = rating.get(challenge.requiredSquadRating) || {
        rating: challenge.requiredSquadRating,
        count: 0,
        completed: 0,
      };
      entry.count += 1;
      if (challenge.completed) entry.completed += 1;
      rating.set(challenge.requiredSquadRating, entry);
    }
    for (const requirement of challenge.specialCardRequirements) {
      const entry = specials.get(requirement.cardType) || {
        cardType: requirement.cardType,
        count: 0,
        completed: 0,
        perRemainingSquad: false,
      };
      entry.count += requirement.count;
      if (challenge.completed) entry.completed += requirement.count;
      specials.set(requirement.cardType, entry);
    }
  }
  const completedChallenges = challenges.filter((challenge) => challenge.completed).length;
  return {
    ratingRequirements: [...rating.values()].sort((a, b) => a.rating - b.rating),
    specialCardRequirements: [...specials.values()].sort((a, b) => a.cardType.localeCompare(b.cardType)),
    requiredSquadsRemaining: Math.max(0, challenges.length - completedChallenges),
    completionProgress: challenges.length ? completedChallenges / challenges.length : 0,
  };
};

export const normalizeTargetProject = (project, index = 0) => {
  if (!project || typeof project !== "object") {
    throw new TypeError("target project must be an object");
  }
  const id = String(project.id ?? `target-project-${index + 1}`);
  const name = String(project.name ?? "").trim();
  if (!name) throw new TypeError(`target project ${id} requires a name`);
  const sourceChallenges = normalizeSourceChallenges(project.sourceChallenges);
  const sourceChallengeIds = normalizeIdList(
    project.sourceChallengeIds?.length
      ? project.sourceChallengeIds
      : sourceChallenges.map((challenge) => challenge.id),
  );
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
    sourceSetId:
      project.sourceSetId == null || project.sourceSetId === ""
        ? null
        : String(project.sourceSetId),
    sourceChallengeIds,
    sourceChallenges,
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

  importCurrentSbc(snapshot, overrides = {}) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.setId) {
      throw new TypeError("A verified current SBC set is required");
    }
    const sourceChallenges = normalizeSourceChallenges(snapshot.challenges);
    if (!sourceChallenges.length) {
      throw new TypeError("The current SBC exposes no verifiable challenges");
    }
    const aggregated = aggregateSourceChallenges(sourceChallenges);
    return this.upsert({
      id: overrides.id ?? `project-${String(snapshot.setId)}`,
      name: overrides.name ?? snapshot.setName ?? "Imported Target SBC",
      active: overrides.active !== false,
      priority: overrides.priority ?? 50,
      ...aggregated,
      protectedRatings: overrides.protectedRatings ?? {},
      protectedPlayerIds: overrides.protectedPlayerIds ?? [],
      protectedResourceIds: overrides.protectedResourceIds ?? [],
      sourceSetId: String(snapshot.setId),
      sourceChallengeIds: sourceChallenges.map((challenge) => challenge.id),
      sourceChallenges,
    });
  }

  synchronizeFromCurrentSbc(id, snapshot) {
    const current = this.#projects.find((project) => project.id === String(id));
    if (!current) throw new TypeError(`Unknown target project: ${String(id)}`);
    if (!current.sourceSetId || String(snapshot?.setId ?? "") !== current.sourceSetId) {
      throw new TypeError("The open SBC set does not match this Target Project");
    }
    const observed = normalizeSourceChallenges(snapshot?.challenges);
    const observedById = new Map(observed.map((challenge) => [challenge.id, challenge]));
    if (
      current.sourceChallengeIds.length === 0 ||
      current.sourceChallengeIds.some((challengeId) => !observedById.has(challengeId))
    ) {
      throw new TypeError("Target Project challenges could not be mapped uniquely");
    }
    const sourceChallenges = current.sourceChallengeIds.map((challengeId) =>
      observedById.get(challengeId),
    );
    const aggregated = aggregateSourceChallenges(sourceChallenges);
    return this.upsert({
      ...current,
      ...aggregated,
      sourceChallenges,
    });
  }

  markVerifiedChallengeCompleted({ setId, challengeId } = {}) {
    const matches = this.#projects.filter(
      (project) =>
        project.sourceSetId === String(setId ?? "") &&
        project.sourceChallengeIds.includes(String(challengeId ?? "")),
    );
    if (matches.length !== 1) return null;
    const project = matches[0];
    const sourceChallenges = project.sourceChallenges.map((challenge) =>
      challenge.id === String(challengeId)
        ? { ...challenge, completed: true }
        : challenge,
    );
    return this.upsert({
      ...project,
      ...aggregateSourceChallenges(sourceChallenges),
      sourceChallenges,
    });
  }

  getDashboard(items = []) {
    const ratingCounts = {};
    for (const item of Array.isArray(items) ? items : []) {
      const rating = nonNegativeInteger(item?.rating);
      if (rating > 0) ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
    }
    return this.getActiveProjects().map((project) => ({
      id: project.id,
      name: project.name,
      priority: project.priority,
      completedSquads:
        project.sourceChallenges.filter((challenge) => challenge.completed).length,
      totalSquads:
        project.sourceChallenges.length ||
        project.requiredSquadsRemaining +
          project.ratingRequirements.reduce((sum, requirement) => sum + requirement.completed, 0),
      requiredSquadsRemaining: project.requiredSquadsRemaining,
      remainingRatings: project.ratingRequirements.map((requirement) => ({
        rating: requirement.rating,
        remaining: Math.max(0, requirement.count - requirement.completed),
        clubCount: ratingCounts[requirement.rating] || 0,
        covered:
          (ratingCounts[requirement.rating] || 0) >=
          Math.max(0, requirement.count - requirement.completed),
      })),
      remainingSpecials: project.specialCardRequirements.map((requirement) => ({
        cardType: requirement.cardType,
        remaining:
          Math.max(0, requirement.count - requirement.completed) *
          (requirement.perRemainingSquad
            ? Math.max(1, project.requiredSquadsRemaining)
            : 1),
      })),
      protectedRatings: project.protectedRatings,
      completionProgress: project.completionProgress,
      sourceSetId: project.sourceSetId,
    }));
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
