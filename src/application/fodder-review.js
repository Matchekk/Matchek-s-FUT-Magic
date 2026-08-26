import { FodderPolicy } from "../policies/fodder-policy.js";
import { TargetProjectService } from "../policies/target-project-service.js";
import { cloneAndFreeze, stableFingerprint, stableStringify } from "./immutable.js";
import { GoalKind } from "./goals.js";

export const FODDER_REVIEW_KIND = "PROTECTION_REVIEW_V1";
export const FODDER_REVIEW_SAFETY_BOUNDARY = "READ_ONLY_NO_EXECUTION";
export const FODDER_REVIEW_CAPABILITIES = Object.freeze(["ea.inventory.read"]);
export const FODDER_REVIEW_LIMITS = Object.freeze({
  maxItems: 5_000,
  maxActiveProjects: 100,
  maxExamplesPerReason: 5,
  maxSpecialReserveSignals: 100,
  maxSignalsPerProject: 12,
  maxProjectNameLength: 120,
});

export const FodderReviewVerificationState = Object.freeze({
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
});

const REASON_DEFINITIONS = Object.freeze([
  ["locked-item", "EA item lock", "ea_item"],
  ["protected-item-flag", "EA protected-item flag", "ea_item"],
  ["protected-item", "Protected owned card", "user_policy"],
  ["protected-player", "Protected footballer", "user_or_project_policy"],
  ["protected-resource", "Protected card version", "user_or_project_policy"],
  ["protected-rating", "Protected rating threshold", "user_or_project_policy"],
  ["target-project-rating", "Target Project exact rating", "target_project"],
  ["protected-card-type", "Protected card type", "user_policy"],
  ["special-type-not-allowed", "Special type is not allowed", "user_policy"],
  ["starting-squad", "Active Squad protection", "safety_invariant"],
  ["favorite", "Favorite-card protection", "user_policy"],
  ["tradable", "Tradable-card protection", "user_policy"],
]);

const REASON_ORDER = new Map(REASON_DEFINITIONS.map(([code], index) => [code, index]));
const REASON_META = new Map(
  REASON_DEFINITIONS.map(([code, label, source]) => [code, { label, source }]),
);

const FIELD_LABELS = Object.freeze({
  locked: "item-lock",
  protected: "protected-item",
  favorite: "favorite-card",
  special: "special-card",
  tradability: "tradability",
  startingSquad: "Active Squad",
});

const normalizeState = (value) => {
  const raw = value && typeof value === "object" ? value.state : value;
  return String(raw || "unverified").trim().toLowerCase() === "verified"
    ? FodderReviewVerificationState.VERIFIED
    : FodderReviewVerificationState.UNVERIFIED;
};

const normalizeActiveSquadEvidence = (value = {}) => ({
  state: normalizeState(value),
  mode: value?.mode == null ? null : String(value.mode),
});

const canonicalSourceEvidence = (sourceEvidence = {}) => {
  const fields = sourceEvidence?.fields || {};
  return {
    schemaVersion: Math.max(0, Number(sourceEvidence?.schemaVersion || 0)),
    fields: Object.fromEntries(
      Object.keys(FIELD_LABELS).sort().map((field) => [field, normalizeState(fields[field])]),
    ),
    activeSquadProtection: normalizeActiveSquadEvidence(
      sourceEvidence?.activeSquadProtection,
    ),
    loansIncluded: sourceEvidence?.loansIncluded === true,
  };
};

const toSortedUniqueStrings = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map(String))].sort();

const canonicalMapEntries = (value) => {
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  return entries
    .map(([key, entry]) => [String(key), Number(entry) || 0])
    .sort(([left], [right]) => left.localeCompare(right));
};

const canonicalProjectDemand = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => ({
      projectId: String(entry?.projectId || ""),
      rating: Number(entry?.rating || 0),
      count: Math.max(0, Number(entry?.count || 0)),
      priority: Math.max(0, Number(entry?.priority || 0)),
    }))
    .sort((left, right) =>
      left.projectId.localeCompare(right.projectId) ||
      left.rating - right.rating ||
      left.count - right.count ||
      left.priority - right.priority);

const canonicalPolicy = (policy) => {
  const config = policy?.config || {};
  return {
    protectRatingAtOrAbove: config.protectRatingAtOrAbove ?? null,
    preferredFodderRange: {
      min: Number(config.preferredFodderRange?.min || 0),
      max: Number(config.preferredFodderRange?.max || 0),
    },
    protectedCardTypes: toSortedUniqueStrings(config.protectedCardTypes),
    allowedSpecialTypes: toSortedUniqueStrings(config.allowedSpecialTypes),
    restrictSpecialTypes: config.restrictSpecialTypes === true,
    protectedItemIds: toSortedUniqueStrings(config.protectedItemIds),
    protectedPlayerIds: toSortedUniqueStrings(config.protectedPlayerIds),
    protectedResourceIds: toSortedUniqueStrings(config.protectedResourceIds),
    protectedExactRatings: [...new Set(config.protectedExactRatings || [])]
      .map(Number).sort((left, right) => left - right),
    protectStartingSquad: config.protectStartingSquad === true,
    protectFavorites: config.protectFavorites === true,
    protectTradables: config.protectTradables === true,
    preferUntradeables: config.preferUntradeables === true,
    preferDuplicates: config.preferDuplicates === true,
    preferSbcStorage: config.preferSbcStorage === true,
    minimumReserveByRating: canonicalMapEntries(config.minimumReserveByRating),
    specialReserveByCardType: canonicalMapEntries(config.specialReserveByCardType),
    projectRatingDemand: canonicalProjectDemand(config.projectRatingDemand),
    activeTargetProjectIds: toSortedUniqueStrings(config.activeTargetProjectIds),
  };
};

const canonicalInventory = (snapshot = {}) => ({
  storageCapacity: snapshot?.storageCapacity ?? null,
  items: (Array.isArray(snapshot?.items) ? snapshot.items : [])
    .map((item) => ({
      itemId: String(item?.itemId ?? item?.id ?? ""),
      resourceId: item?.resourceId == null ? null : String(item.resourceId),
      baseId: item?.baseId ?? item?.basePlayerId ?? null,
      assetId: item?.assetId ?? null,
      location: item?.location ?? null,
      rating: Number(item?.rating || 0),
      cardType: item?.cardType ?? null,
      rarityName: item?.rarityName ?? null,
      isSpecial: item?.isSpecial ?? null,
      isTradable: item?.isTradable ?? item?.isTradeable ?? null,
      isDuplicate: item?.isDuplicate ?? null,
      isStorage: item?.isStorage ?? null,
      isLocked: item?.isLocked ?? item?.locked ?? null,
      isProtected: item?.isProtected ?? null,
      isFavorite: item?.isFavorite ?? item?.isFavourite ?? null,
      isInStartingSquad: item?.isInStartingSquad ?? item?.isInActive11 ?? null,
      hasTradabilityEvidence: item?.hasTradabilityEvidence ?? null,
      hasLockedEvidence: item?.hasLockedEvidence ?? null,
      hasProtectedEvidence: item?.hasProtectedEvidence ?? null,
      hasFavoriteEvidence: item?.hasFavoriteEvidence ?? null,
      hasStartingSquadEvidence: item?.hasStartingSquadEvidence ?? null,
      hasSpecialEvidence: item?.hasSpecialEvidence ?? null,
      hasMovableEvidence: item?.hasMovableEvidence ?? null,
      hasStorableEvidence: item?.hasStorableEvidence ?? null,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId)),
});

const sortCanonicalArray = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => canonicalValue(value))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));

const canonicalValue = (value) => {
  if (Array.isArray(value)) return sortCanonicalArray(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
};

const getActiveProjects = (targetProjects) => {
  if (targetProjects instanceof TargetProjectService) {
    return targetProjects.getActiveProjects();
  }
  return new TargetProjectService(Array.isArray(targetProjects) ? targetProjects : [])
    .getActiveProjects();
};

const canonicalProjects = (projects) =>
  sortCanonicalArray(projects).sort((left, right) =>
    String(left?.id || "").localeCompare(String(right?.id || "")));

const canonicalCapabilityEvidence = (evidence) => {
  if (!evidence || typeof evidence !== "object") return null;
  const keys = ["kind", "source", "schemaVersion", "adapterVersion", "mode"];
  const result = Object.fromEntries(
    keys.filter((key) => evidence[key] != null).map((key) => [key, evidence[key]]),
  );
  return Object.keys(result).length ? canonicalValue(result) : null;
};

const canonicalCapabilities = (snapshot = {}) => ({
  capabilities: (Array.isArray(snapshot?.capabilities) ? snapshot.capabilities : [])
    .filter((entry) => FODDER_REVIEW_CAPABILITIES.includes(entry?.id))
    .map((entry) => ({
      id: String(entry.id),
      state: String(entry.state || "unverified"),
      evidence: canonicalCapabilityEvidence(entry.evidence),
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
});

export const buildFodderReviewFingerprints = ({
  gameContext,
  inventorySnapshot,
  policy,
  targetProjects = [],
  capabilitySnapshot,
  sourceEvidence,
} = {}) => {
  if (!(policy instanceof FodderPolicy)) {
    throw new TypeError("Fodder review requires a FodderPolicy");
  }
  const projects = getActiveProjects(targetProjects);
  const components = {
    game: stableFingerprint({
      gameVersion: gameContext?.gameVersion ?? null,
      state: gameContext?.state ?? null,
    }),
    inventory: stableFingerprint(canonicalInventory(inventorySnapshot)),
    policy: stableFingerprint(canonicalPolicy(policy)),
    projects: stableFingerprint(canonicalProjects(projects)),
    capabilities: stableFingerprint(canonicalCapabilities(capabilitySnapshot)),
    sourceEvidence: stableFingerprint(canonicalSourceEvidence(sourceEvidence)),
  };
  return cloneAndFreeze({
    ...components,
    combined: stableFingerprint(components),
    inventoryGeneration: Math.max(0, Number(inventorySnapshot?.generation || 0)),
  });
};

export const compareFodderReviewFingerprints = (expected, current) => {
  const keys = ["game", "inventory", "policy", "projects", "capabilities", "sourceEvidence"];
  const changed = keys.filter((key) => expected?.[key] !== current?.[key]);
  return cloneAndFreeze({ ok: changed.length === 0, changed });
};

const getCardType = (item) => String(
  item?.cardType ?? item?.specialCardGroup ?? item?.rarityGroup ?? item?.rarityName ?? "base",
).trim().toLowerCase();

const locationCounts = (items) => {
  const counts = { club: 0, sbcStorage: 0, unassigned: 0 };
  for (const item of items) {
    if (item?.location === "club") counts.club += 1;
    else if (item?.location === "sbc_storage" || item?.isStorage === true) counts.sbcStorage += 1;
    else if (item?.location === "unassigned") counts.unassigned += 1;
  }
  return counts;
};

const parseObservedAt = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const boundedText = (value, maxLength) => String(value || "").slice(0, maxLength);

const buildProjectSignals = (projects, { maxSignalsPerProject, maxProjectNameLength }) =>
  projects.map((project) => {
    const hardExclusions = [];
    if (project.protectedRatings?.atOrAbove != null) {
      hardExclusions.push(`${project.protectedRatings.atOrAbove}+ rating threshold`);
    }
    for (const rating of project.protectedRatings?.exact || []) {
      hardExclusions.push(`Exact ${rating} rating`);
    }
    const reserveEntries = Object.entries(project.protectedRatings?.reserveByRating || {});
    if (project.protectedPlayerIds?.length) {
      hardExclusions.push(`${project.protectedPlayerIds.length} protected footballer${project.protectedPlayerIds.length === 1 ? "" : "s"}`);
    }
    if (project.protectedResourceIds?.length) {
      hardExclusions.push(`${project.protectedResourceIds.length} protected card version${project.protectedResourceIds.length === 1 ? "" : "s"}`);
    }
    const conservationPreferences = reserveEntries.map(([rating, count]) =>
      `Keep ${count} at ${rating} rating`);
    for (const requirement of project.ratingRequirements || []) {
      const remaining = Math.max(0, Number(requirement.count || 0) - Number(requirement.completed || 0));
      if (remaining > 0) conservationPreferences.push(
        `${remaining} remaining ${requirement.rating}-rated squad signal${remaining === 1 ? "" : "s"}`,
      );
    }
    for (const requirement of project.specialCardRequirements || []) {
      const remaining = Math.max(0, Number(requirement.count || 0) - Number(requirement.completed || 0));
      if (remaining > 0) conservationPreferences.push(
        `Keep ${remaining} ${String(requirement.cardType).toUpperCase()} special signal${remaining === 1 ? "" : "s"}`,
      );
    }
    const unknownRequirementCount = (project.sourceChallenges || []).reduce(
      (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
      0,
    );
    return {
      name: boundedText(project.name || "Target Project", maxProjectNameLength),
      hardExclusions: hardExclusions.slice(0, maxSignalsPerProject),
      conservationPreferences: conservationPreferences.slice(0, maxSignalsPerProject),
      unknownRequirementCount,
    };
  });

const buildCoverage = (policy, sourceEvidence) => {
  const evidence = canonicalSourceEvidence(sourceEvidence);
  const required = new Set(["locked", "protected"]);
  if (policy.config.protectFavorites) required.add("favorite");
  if (policy.config.protectTradables) required.add("tradability");
  if (policy.config.restrictSpecialTypes ||
      Object.keys(policy.config.specialReserveByCardType || {}).length > 0) {
    required.add("special");
  }
  if (policy.config.protectStartingSquad &&
      evidence.activeSquadProtection.state !== FodderReviewVerificationState.VERIFIED) {
    required.add("startingSquad");
  }
  const missingFields = [...required]
    .filter((field) => evidence.fields[field] !== FodderReviewVerificationState.VERIFIED)
    .sort();
  const warnings = missingFields.map((field) =>
    `${FIELD_LABELS[field] || field} evidence is UNVERIFIED; cards without a known hard reason are not classified as safe fodder.`);
  return {
    evidence,
    missingFields,
    warnings,
    state: missingFields.length
      ? FodderReviewVerificationState.UNVERIFIED
      : FodderReviewVerificationState.VERIFIED,
  };
};

const emptyPreview = ({ itemCount, projectCount, warnings }) => ({
  kind: FODDER_REVIEW_KIND,
  safetyBoundary: FODDER_REVIEW_SAFETY_BOUNDARY,
  readOnly: true,
  canApprove: false,
  verificationState: FodderReviewVerificationState.UNVERIFIED,
  analyzedItemCount: 0,
  observedItemCount: itemCount,
  observedAt: null,
  activeProjectCount: projectCount,
  uniqueHardProtectedCount: 0,
  notHardProtectedCount: null,
  reasonGroups: [],
  projectSignals: [],
  softConservation: {
    ratingReserves: [], specialReserves: [], projectRatingDemand: [],
    preferences: {}, activeTargetProjectIds: [],
  },
  sourceCoverage: null,
  warnings,
  limits: { ...FODDER_REVIEW_LIMITS },
});

export const summarizeFodderReview = ({
  inventorySnapshot,
  policy,
  targetProjects = [],
  sourceEvidence = {},
  limits = FODDER_REVIEW_LIMITS,
} = {}) => {
  if (!(policy instanceof FodderPolicy)) {
    throw new TypeError("Fodder review requires a FodderPolicy");
  }
  const items = Array.isArray(inventorySnapshot?.items) ? inventorySnapshot.items : [];
  const projects = getActiveProjects(targetProjects);
  const boundedLimit = (value, fallback, minimum) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(fallback, Math.max(minimum, Math.trunc(parsed)));
  };
  const maxItems = boundedLimit(
    limits?.maxItems,
    FODDER_REVIEW_LIMITS.maxItems,
    1,
  );
  const maxActiveProjects = boundedLimit(
    limits?.maxActiveProjects,
    FODDER_REVIEW_LIMITS.maxActiveProjects,
    1,
  );
  const maxExamples = boundedLimit(
    limits?.maxExamplesPerReason,
    FODDER_REVIEW_LIMITS.maxExamplesPerReason,
    0,
  );
  const maxSignalsPerProject = boundedLimit(
    limits?.maxSignalsPerProject,
    FODDER_REVIEW_LIMITS.maxSignalsPerProject,
    0,
  );
  const maxProjectNameLength = boundedLimit(
    limits?.maxProjectNameLength,
    FODDER_REVIEW_LIMITS.maxProjectNameLength,
    1,
  );
  const maxSpecialReserveSignals = boundedLimit(
    limits?.maxSpecialReserveSignals,
    FODDER_REVIEW_LIMITS.maxSpecialReserveSignals,
    1,
  );
  const conservation = policy.toSolverConservationPolicy();
  const blockers = [];
  if (items.length > maxItems) {
    blockers.push({
      code: "REVIEW_INPUT_TOO_LARGE",
      message: `Protection Review supports at most ${maxItems} inventory items without truncation.`,
    });
  }
  if (projects.length > maxActiveProjects) {
    blockers.push({
      code: "REVIEW_INPUT_TOO_LARGE",
      message: `Protection Review supports at most ${maxActiveProjects} active projects without truncation.`,
    });
  }
  if (Object.keys(conservation.specialReserveByCardType || {}).length > maxSpecialReserveSignals) {
    blockers.push({
      code: "REVIEW_INPUT_TOO_LARGE",
      message: `Protection Review supports at most ${maxSpecialReserveSignals} special-card reserve signals without truncation.`,
    });
  }
  if (blockers.length) {
    return cloneAndFreeze({
      blockers,
      preview: emptyPreview({
        itemCount: items.length,
        projectCount: projects.length,
        warnings: blockers.map((blocker) => blocker.message),
      }),
    });
  }

  const analysis = policy.analyze(items);
  const byId = new Map(analysis.items.map((item) => [String(item.itemId), item]));
  const groups = new Map();
  for (const [itemId, reasons] of Object.entries(analysis.reasonsByItemId)) {
    const item = byId.get(String(itemId));
    for (const code of reasons) {
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push({ itemId: String(itemId), item });
    }
  }
  const reasonGroups = [...groups.entries()]
    .sort(([left], [right]) =>
      (REASON_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (REASON_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right))
    .map(([code, entries]) => {
      const meta = REASON_META.get(code) || {
        label: code.replaceAll("-", " "),
        source: "policy",
      };
      const sorted = entries.sort((left, right) => left.itemId.localeCompare(right.itemId));
      return {
        code,
        label: meta.label,
        source: meta.source,
        itemCount: sorted.length,
        examples: sorted.slice(0, maxExamples).map(({ item }) => ({
          name: item?.name == null ? null : String(item.name),
          rating: Number(item?.rating || 0),
          location: item?.location ?? (item?.isStorage ? "sbc_storage" : null),
          cardType: getCardType(item),
        })),
      };
    });

  const coverage = buildCoverage(policy, sourceEvidence);
  const ratingReserves = Object.entries(conservation.minimumReserveByRating || {})
    .map(([rating, reserved]) => {
      const matches = analysis.items.filter((item) => Number(item?.rating || 0) === Number(rating));
      return {
        rating: Number(rating),
        reserved: Math.max(0, Number(reserved || 0)),
        observedCount: matches.length,
        observedByLocation: locationCounts(matches),
        signal: "soft_conservation",
      };
    })
    .sort((left, right) => left.rating - right.rating);
  const specialReserves = Object.entries(conservation.specialReserveByCardType || {})
    .map(([cardType, reserved]) => {
      const normalizedType = String(cardType).trim().toLowerCase();
      const matches = analysis.items.filter((item) =>
        item?.isSpecial === true && getCardType(item) === normalizedType);
      return {
        cardType: normalizedType,
        reserved: Math.max(0, Number(reserved || 0)),
        observedCount: coverage.evidence.fields.special === FodderReviewVerificationState.VERIFIED
          ? matches.length
          : null,
        observedByLocation: coverage.evidence.fields.special === FodderReviewVerificationState.VERIFIED
          ? locationCounts(matches)
          : null,
        signal: "soft_conservation",
      };
    })
    .sort((left, right) => left.cardType.localeCompare(right.cardType));
  const projectWarnings = projects.flatMap((project) => {
    const unknown = (project.sourceChallenges || []).reduce(
      (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
      0,
    );
    return unknown > 0
      ? [`Target Project ${project.name} has ${unknown} unknown requirement${unknown === 1 ? "" : "s"}; its conservation signals are incomplete.`]
      : [];
  });
  const projectSignals = buildProjectSignals(projects, {
    maxSignalsPerProject,
    maxProjectNameLength,
  });
  const warnings = [...coverage.warnings, ...projectWarnings];
  return cloneAndFreeze({
    blockers: [],
    preview: {
      kind: FODDER_REVIEW_KIND,
      safetyBoundary: FODDER_REVIEW_SAFETY_BOUNDARY,
      readOnly: true,
      canApprove: false,
      verificationState: coverage.state,
      analyzedItemCount: analysis.items.length,
      observedItemCount: items.length,
      observedAt: parseObservedAt(inventorySnapshot?.updatedAt),
      activeProjectCount: projects.length,
      uniqueHardProtectedCount: analysis.protectedItemIds.length,
      notHardProtectedCount: coverage.state === FodderReviewVerificationState.VERIFIED
        ? analysis.eligibleItems.length
        : null,
      reasonGroups,
      projectSignals,
      softConservation: {
        ratingReserves,
        specialReserves,
        projectRatingDemand: canonicalProjectDemand(conservation.projectRatingDemand),
        preferences: {
          preferDuplicates: conservation.preferDuplicates === true,
          preferSbcStorage: conservation.preferSbcStorage === true,
          preferUntradeables: conservation.preferUntradeables === true,
          preferredFodderRange: { ...conservation.preferredFodderRange },
        },
        activeTargetProjectIds: toSortedUniqueStrings(analysis.activeTargetProjectIds),
      },
      sourceCoverage: coverage.evidence,
      warnings,
      limits: {
        maxItems,
        maxActiveProjects,
        maxExamplesPerReason: maxExamples,
        maxSignalsPerProject,
        maxProjectNameLength,
        maxSpecialReserveSignals,
      },
    },
  });
};

export const buildFodderReview = ({
  gameContext,
  inventorySnapshot,
  policy,
  targetProjects = [],
  capabilitySnapshot,
  sourceEvidence,
  limits,
} = {}) => {
  const summary = summarizeFodderReview({
    inventorySnapshot, policy, targetProjects, sourceEvidence, limits,
  });
  return cloneAndFreeze({
    requiredCapabilities: [...FODDER_REVIEW_CAPABILITIES],
    blockers: summary.blockers,
    fingerprints: buildFodderReviewFingerprints({
      gameContext,
      inventorySnapshot,
      policy,
      targetProjects,
      capabilitySnapshot,
      sourceEvidence,
    }),
    explanation: [
      "This review reports current hard protections and soft conservation signals.",
      "It does not select fodder, optimize an SBC, change cards, or create an executable workflow.",
    ],
    preview: summary.preview,
    steps: [],
  });
};

export const createFodderReviewStrategy = ({ readEvidence, limits } = {}) => {
  if (typeof readEvidence !== "function") {
    throw new TypeError("Fodder review strategy requires readEvidence");
  }
  const strategy = async ({ goal, gameContext }) => {
    if (goal?.kind !== GoalKind.OPTIMIZE_FODDER) {
      throw new TypeError("Fodder review strategy requires an OPTIMIZE_FODDER goal");
    }
    const evidence = await readEvidence({ goal, gameContext });
    return buildFodderReview({ ...evidence, gameContext, limits });
  };
  strategy.requiredCapabilities = FODDER_REVIEW_CAPABILITIES;
  return strategy;
};
