import { createGameContext, GameVersion } from "../application/game-context.js";

const ACTIVE_RUN_STATUSES = new Set([
  "running", "waiting", "paused", "stopping", "recovery_required",
]);

const STEP_LABELS = Object.freeze({
  SOLVE_SBC: "Build squad",
  SUBMIT_SBC: "Submit squad",
  CLAIM_REWARD: "Claim reward",
  OPEN_REWARD_PACK: "Open reward",
  HANDLE_PLAYER_PICK: "Choose player",
  RESOLVE_ITEMS: "Route items",
  ORGANIZE_ITEMS: "Recycle remaining items",
});

const connectionFor = (state) => {
  if (state.bridgeHealth === "healthy") return "connected";
  if (state.bridgeHealth === "unavailable") return "unavailable";
  return "connecting";
};

const compatibilityFor = (gameContext) => {
  if (gameContext.gameVersion === GameVersion.FC27) {
    const contextVerified = gameContext.state === "verified";
    return {
      gameVersion: GameVersion.FC27,
      versionState: "observed",
      contextState: gameContext.state,
      planningState: "observe_only",
      gameLabel: "FC 27",
      title: "FC 27 detected",
      message: contextVerified
        ? "This screen is verified, but FC 27 planning is not available in this build. FUT Magic won’t run a plan."
        : "The game version is observed. FC 27 planning rules are not verified in this build, so FUT Magic won’t run a plan.",
    };
  }
  if (gameContext.gameVersion === GameVersion.UNKNOWN) {
    return {
      gameVersion: GameVersion.UNKNOWN,
      versionState: "unknown",
      contextState: gameContext.state,
      planningState: "unavailable",
      gameLabel: "Unknown",
      title: "Game version not confirmed",
      message: "FUT Magic can’t verify which game version is open, so planning stays off.",
    };
  }
  return null;
};

const blockerMessage = (blocker = {}) => {
  if (blocker.message) return String(blocker.message);
  const messages = {
    CAPABILITY_UNAVAILABLE: "A required EA capability is not verified right now.",
    GAME_CONTEXT_UNVERIFIED: "Open a verifiable SBC challenge in EA and try again.",
    OPEN_PROJECT_REQUIRED: "Open this project's SBC set in EA and try again.",
    CURRENT_CHALLENGE_NOT_IN_PROJECT: "The open challenge is not part of this project.",
    CHALLENGE_COMPLETED: "The open challenge is already complete.",
    UNKNOWN_REQUIREMENTS: "This challenge contains requirements FUT Magic cannot verify safely.",
    NO_VERIFIED_SOLUTION: "No submit-ready protected squad was found.",
    SOLUTION_ITEMS_UNOBSERVED: "The solver referenced cards outside the current Club snapshot.",
    PROTECTED_ITEM_SELECTED: "The proposed squad included a protected card.",
    ROUTING_CAPABILITY_EVIDENCE_MISSING: "EA did not expose enough move evidence for every proposed card.",
    ROUTE_ITEM_UNOBSERVED: "A proposed card is no longer in the current Unassigned snapshot.",
    ROUTE_COVERAGE_MISMATCH: "The route does not account for every Unassigned item exactly once.",
    NO_SAFE_ROUTE: "No current Unassigned item has a verified safe destination.",
    ROUTE_TOO_LARGE: "The current Unassigned route is too large for one bounded approval.",
    REVIEW_INPUT_TOO_LARGE: "This Club snapshot is too large for one bounded protection review.",
  };
  return messages[String(blocker.code)] || "The preview is blocked safely.";
};

const PROTECTION_REASON_LABELS = Object.freeze({
  "locked-item": "EA-locked cards",
  "protected-item-flag": "EA-protected cards",
  "protected-item": "Specific cards",
  "protected-player": "Specific players",
  "protected-resource": "Specific card versions",
  "protected-rating": "Rating threshold",
  "target-project-rating": "Project rating rules",
  "protected-card-type": "Protected card types",
  "special-type-not-allowed": "Special-card rules",
  "starting-squad": "Active squad",
  favorite: "Favourites",
  tradable: "Tradable cards",
});

const publicCardExample = (card = {}) => ({
  name: card.name == null ? "Unnamed card" : String(card.name),
  rating: Math.max(0, Number(card.rating || 0)),
  location: String(card.location || "club"),
});

const protectionPlanViewModel = (plan, state = {}) => {
  const empty = {
    status: "idle",
    observedAt: null,
    verificationMessage: "Review current protection to see its effect.",
    uniqueHardProtectedCount: null,
    analyzedItemCount: null,
    reasonGroups: [],
    ratingReserves: [],
    specialReserves: [],
    projectSignals: [],
    preferences: [],
    evidenceWarnings: [],
    advancedActive: false,
  };
  if (!plan) return empty;
  const preview = plan.preview || {};
  const conservation = preview.softConservation || {};
  const verificationState = String(preview.verificationState || "unverified").toLowerCase();
  const blocked = plan.state !== "ready";
  const warnings = [
    ...(preview.evidenceWarnings || preview.warnings || []),
    ...(plan.blockers || []).map(blockerMessage),
  ].map(String);
  const preferenceInput = preview.preferences || conservation.preferences;
  const preferences = Array.isArray(preferenceInput)
    ? preferenceInput.map((entry, index) => ({
        id: String(entry.id || `preference-${index + 1}`),
        label: String(entry.label || "Local squad preference"),
        enabled: entry.enabled !== false,
      }))
    : [
        { id: "duplicates", label: "Duplicates", enabled: preferenceInput?.preferDuplicates !== false },
        { id: "sbc-storage", label: "Cards from SBC Storage", enabled: preferenceInput?.preferSbcStorage !== false },
        { id: "untradeables", label: "Untradeable cards", enabled: preferenceInput?.preferUntradeables !== false },
      ];
  const draft = state.draft || {};
  const advancedActive = Boolean(
    (draft.protectedItemIds || []).length ||
    (draft.protectedPlayerIds || []).length ||
    (draft.protectedResourceIds || []).length ||
    (draft.protectedRatings || []).length ||
    (draft.protectedCardTypes || []).length ||
    Array.isArray(draft.allowedSpecialTypes) ||
    Object.keys(draft.minimumReserveByRating || {}).length ||
    Object.keys(draft.specialReserveByCardType || {}).length ||
    draft.protectTradables === true,
  );
  return {
    status: blocked ? "blocked" : verificationState === "verified" ? "ready" : "unverified",
    observedAt: Number.isFinite(Number(preview.observedAt))
      ? Number(preview.observedAt)
      : Number.isFinite(Date.parse(String(preview.observedAt || "")))
        ? Date.parse(String(preview.observedAt))
        : Number(plan.createdAt || 0) || null,
    verificationMessage: blocked
      ? "Current impact is unavailable. Your configured rules still apply to future previews."
      : verificationState === "verified"
        ? "Based on the latest verified Club snapshot."
        : Number(preview.uniqueHardProtectedCount || 0) > 0
          ? "At least the shown exclusions are verified, but EA did not expose every flag needed to prove the full count."
          : "EA did not expose every flag needed to verify current exclusions.",
    uniqueHardProtectedCount: preview.uniqueHardProtectedCount == null
      ? null
      : Math.max(0, Number(preview.uniqueHardProtectedCount)),
    analyzedItemCount: preview.analyzedItemCount == null
      ? null
      : Math.max(0, Number(preview.analyzedItemCount)),
    reasonGroups: (preview.reasonGroups || []).map((group, index) => ({
      code: `reason-${index + 1}`,
      label: PROTECTION_REASON_LABELS[String(group.code)] || "Additional protection rule",
      count: Math.max(0, Number(group.itemCount ?? group.count ?? 0)),
      examples: (group.examples || []).slice(0, 5).map(publicCardExample),
    })),
    ratingReserves: (preview.ratingReserves || conservation.ratingReserves || []).map((entry) => ({
      rating: Math.max(0, Number(entry.rating || 0)),
      minimum: Math.max(0, Number(entry.minimum ?? entry.reserved ?? entry.count ?? 0)),
      observedCount: entry.observedCount == null ? null : Math.max(0, Number(entry.observedCount)),
    })),
    specialReserves: (preview.specialReserves || conservation.specialReserves || []).map((entry) => ({
      cardType: String(entry.cardType || "special card"),
      minimum: Math.max(0, Number(entry.minimum ?? entry.reserved ?? entry.count ?? 0)),
      observedCount: entry.observedCount == null ? null : Math.max(0, Number(entry.observedCount)),
    })),
    projectSignals: (preview.projectSignals || []).map((entry) => ({
      name: String(entry.name || "Active project"),
      hardExclusions: (entry.hardExclusions || []).map(String),
      conservationPreferences: (entry.conservationPreferences || []).map(String),
      unknownRequirementCount: Math.max(0, Number(entry.unknownRequirementCount || 0)),
    })),
    preferences: preferences.slice(0, 3),
    evidenceWarnings: warnings,
    advancedActive: Boolean(preview.advancedActive || advancedActive),
  };
};

const duplicateRoutePlanViewModel = (plan, notice) => {
  if (!plan) return notice == null ? null : {
    id: null,
    state: "blocked",
    status: "expired",
    totalCount: 0,
    safeCount: 0,
    toClubCount: 0,
    toStorageCount: 0,
    attentionCount: 0,
    cards: [],
    explanations: [],
    blockers: [],
    canApprove: false,
    approvalLabel: "Preview again",
    notice: String(notice),
  };
  const preview = plan.preview || {};
  const safeCount = Math.max(0, Number(preview.safeCount || 0));
  return {
    id: String(plan.id),
    state: String(plan.state || "blocked"),
    status: String(preview.status || plan.state || "blocked"),
    createdAt: Number(plan.createdAt || 0),
    totalCount: Math.max(0, Number(preview.totalCount || 0)),
    safeCount,
    toClubCount: Math.max(0, Number(preview.toClubCount || 0)),
    toStorageCount: Math.max(0, Number(preview.toStorageCount || 0)),
    attentionCount: Math.max(0, Number(preview.attentionCount || 0)),
    cards: (preview.cards || []).slice(0, 100).map((card) => ({
      name: card.name == null ? null : String(card.name),
      rating: Number(card.rating || 0),
      isSpecial: Boolean(card.isSpecial),
      isTradable: Boolean(card.isTradable),
      action: String(card.action || "PAUSE"),
      destination: String(card.destination || "unassigned"),
      reason: String(card.reason || "Kept for your decision"),
    })),
    explanations: (plan.explanation || []).slice(0, 4).map(String),
    blockers: (plan.blockers || []).map((blocker) => ({
      code: String(blocker.code || "BLOCKED"),
      message: blockerMessage(blocker),
    })),
    canApprove:
      plan.state === "ready" &&
      preview.status === "ready" &&
      preview.safetyBoundary === "SAFE_ITEM_MOVES_ONLY" &&
      (preview.cards || []).length === Number(preview.totalCount || 0) &&
      Number(preview.totalCount || 0) <= 100 &&
      safeCount > 0,
    approvalLabel: `Move ${safeCount} safe item${safeCount === 1 ? "" : "s"}`,
    notice: notice == null ? null : String(notice),
  };
};

const ROUTER_REASON_COPY = Object.freeze({
  UNASSIGNED_CLEAR: "There is nothing to route right now.",
  EXACT_DUPLICATE_STORAGE_MOVE_VERIFIED:
    "This exact duplicate has a verified SBC Storage destination.",
  UNIQUE_CLUB_MOVE_VERIFIED: "EA verified that this card can return to Club.",
  TRADABLE_DUPLICATE_STORAGE_UNAVAILABLE:
    "SBC Storage has no verified space. This tradable duplicate stays Unassigned for your decision.",
  UNTRADEABLE_DUPLICATE_NO_SAFE_DESTINATION:
    "This untradeable duplicate has no verified Club or SBC Storage destination.",
  DUPLICATE_IDENTITY_UNVERIFIED:
    "The exact card version could not be verified, so no destination was inferred.",
  CLUB_MOVE_EVIDENCE_UNVERIFIED:
    "EA did not expose the per-card evidence needed to verify a Club move.",
  STORAGE_MOVE_EVIDENCE_UNVERIFIED:
    "EA did not expose the per-card evidence needed to verify an SBC Storage move.",
  TRADABILITY_EVIDENCE_UNVERIFIED:
    "EA did not expose enough tradability evidence for a safe routing choice.",
  STORAGE_CAPACITY_UNVERIFIED:
    "Current SBC Storage capacity could not be verified.",
  ITEM_EXPLICITLY_NOT_MOVABLE: "EA reports that this card cannot move right now.",
  ROUTE_EVIDENCE_MISSING: "The current Unassigned route could not be observed completely.",
  ROUTE_EVIDENCE_CONFLICT: "Current Unassigned evidence does not describe one coherent route.",
  INVENTORY_SNAPSHOT_INVALID: "The current Club snapshot is incomplete or inconsistent.",
  INPUT_LIMIT_EXCEEDED: "The current inventory exceeds this bounded local Router review.",
  GAME_CONTEXT_UNVERIFIED: "The current EA game context is not verified for FC 26 routing.",
  READ_CAPABILITY_UNAVAILABLE: "Current Club and Unassigned reads are unavailable.",
  MOVE_CAPABILITY_UNAVAILABLE: "EA item-move capability is not currently verified.",
  ACTIVITY_GUARD_NOT_IDLE: "Finish, stop, or recover the active run before routing items.",
  ACTIVITY_GUARD_UNVERIFIED: "Activity Guard could not verify that routing is currently idle.",
});

const routerRecommendationViewModel = (recommendation, notice) => {
  if (!recommendation) return notice == null ? null : {
    status: "expired",
    kind: "pause",
    title: "Recommendation out of date",
    reason: String(notice),
    evidence: "Nothing moved. Refresh the Router recommendation from current evidence.",
    observedAt: 0,
    card: null,
    destination: null,
    readOnly: true,
  };
  const outcome = recommendation.outcome || {};
  const internalKind = String(outcome.kind || "PAUSE");
  const kind = ({
    KEEP: "keep",
    MOVE_TO_CLUB: "move_to_club",
    MOVE_TO_SBC_STORAGE: "move_to_sbc_storage",
    RESERVE: "reserve",
    PAUSE: "pause",
    ASK_USER: "ask_user",
  })[internalKind] || "pause";
  const status = ({
    READY: "ready",
    ATTENTION: "attention",
    CLEAR: "clear",
    BLOCKED: "blocked",
  })[String(recommendation.state || "BLOCKED")] || "blocked";
  const display = outcome.display || null;
  const cardName = display?.name ? String(display.name) : "this card";
  const title = kind === "move_to_club"
    ? `Move ${cardName} to Club`
    : kind === "move_to_sbc_storage"
      ? `Move ${cardName} to SBC Storage`
      : kind === "ask_user"
        ? "Choose what to do in EA"
        : kind === "reserve"
          ? `Reserve ${cardName}`
          : status === "clear"
            ? "Unassigned is clear"
            : "Routing paused";
  const reasonCode = String(outcome.reasonCode || "ROUTE_EVIDENCE_CONFLICT");
  const evidence = status === "ready"
    ? "Checked the complete bounded Unassigned snapshot, exact card-version identity, destination evidence, EA capabilities, and Activity Guard."
    : status === "clear"
      ? "Checked the complete bounded Unassigned snapshot."
      : "The Router stopped at the first unverified or attention-required boundary.";
  return {
    status,
    kind,
    title,
    reason: ROUTER_REASON_COPY[reasonCode] || ROUTER_REASON_COPY.ROUTE_EVIDENCE_CONFLICT,
    evidence,
    observedAt: Number(recommendation.observedAt || 0),
    card: display ? {
      name: display.name == null ? null : String(display.name),
      rating: Math.max(0, Number(display.rating || 0)),
      isSpecial: Boolean(display.isSpecial),
      isTradable: display.isTradable == null ? null : display.isTradable === true,
    } : null,
    destination: outcome.destination == null ? null : String(outcome.destination),
    readOnly: true,
  };
};

const projectPlanViewModel = (plan, notice) => {
  if (!plan) return null;
  const preview = plan.preview || {};
  return {
    id: String(plan.id),
    state: String(plan.state || "blocked"),
    status: String(preview.status || plan.state || "blocked"),
    createdAt: Number(plan.createdAt || 0),
    challengeName: preview.challengeName == null ? null : String(preview.challengeName),
    targetRating: preview.targetRating == null ? null : Number(preview.targetRating),
    selectedCount: Math.max(0, Number(preview.selectedCount || 0)),
    cards: (preview.cards || []).slice(0, 11).map((card) => ({
      name: card.name == null ? null : String(card.name),
      rating: Number(card.rating || 0),
      location: String(card.location || "club"),
      isSpecial: Boolean(card.isSpecial),
      isDuplicate: Boolean(card.isDuplicate),
      isTradable: Boolean(card.isTradable),
    })),
    ratingRange: preview.ratingRange
      ? { min: Number(preview.ratingRange.min), max: Number(preview.ratingRange.max) }
      : null,
    specialCount: Math.max(0, Number(preview.specialCount || 0)),
    duplicateCount: Math.max(0, Number(preview.duplicateCount || 0)),
    storageCount: Math.max(0, Number(preview.storageCount || 0)),
    protectedCount: Math.max(0, Number(preview.protectedCount || 0)),
    selectedProtectedCount: preview.selectedProtectedCount == null
      ? null
      : Math.max(0, Number(preview.selectedProtectedCount)),
    explanations: (plan.explanation || []).slice(0, 6).map(String),
    blockers: (plan.blockers || []).map((blocker) => ({
      code: String(blocker.code || "BLOCKED"),
      message: blockerMessage(blocker),
    })),
    canApprove:
      plan.state === "ready" &&
      preview.status === "ready" &&
      preview.selectedProtectedCount != null &&
      Number(preview.selectedProtectedCount) === 0,
    approvalLabel: "Build & submit squad",
    notice: notice == null ? null : String(notice),
  };
};

const projectViewModel = (project, storedProject, observedAt, plan, planNotice) => {
  const total = Number(project.totalSquads || 0) || null;
  const completed = Math.max(0, Number(project.completedSquads || 0));
  const fallbackProgress = Number(storedProject?.completionProgress);
  const progress = total
    ? Math.min(1, completed / total)
    : Number.isFinite(fallbackProgress)
      ? Math.min(1, Math.max(0, fallbackProgress))
      : null;
  const protectionSummary = [];
  if (project.protectedRatings?.atOrAbove) {
    protectionSummary.push(`${project.protectedRatings.atOrAbove}+ cards excluded`);
  }
  const exactRatings = project.protectedRatings?.exact || storedProject?.protectedRatings?.exact || [];
  if (exactRatings.length) protectionSummary.push(`Exact ratings ${exactRatings.join(", ")} excluded`);
  const ratingReserves = Object.entries(
    project.protectedRatings?.reserveByRating || storedProject?.protectedRatings?.reserveByRating || {},
  );
  if (ratingReserves.length) {
    protectionSummary.push(`Try to keep ${ratingReserves.map(([rating, count]) => `${count} × ${rating}`).join(" · ")}`);
  }
  if ((project.remainingSpecials || []).length) {
    protectionSummary.push(`Try to keep ${(project.remainingSpecials || []).map((entry) => `${entry.remaining} × ${String(entry.cardType || "special").toUpperCase()}`).join(" · ")}`);
  }
  if (!protectionSummary.length) protectionSummary.push("No additional project protection or reserves");
  return {
    id: String(project.id),
    name: String(project.name || "Untitled project"),
    state: progress === 1 ? "complete" : "active",
    completedSquads: completed,
    totalSquads: total,
    progress,
    requiredSquadsRemaining: Math.max(0, Number(project.requiredSquadsRemaining || 0)),
    remainingRatings: (project.remainingRatings || []).map((entry) => ({
      rating: Number(entry.rating),
      needed: Math.max(0, Number(entry.remaining || 0)),
      exactRatingInClub: Math.max(0, Number(entry.clubCount || 0)),
    })),
    remainingSpecials: (project.remainingSpecials || []).map((entry) => ({
      type: String(entry.cardType || "special"),
      needed: Math.max(0, Number(entry.remaining || 0)),
    })),
    protectionSummary: protectionSummary.slice(0, 4),
    source: project.sourceSetId ? "ea_import" : "manual",
    unknownRequirementCount: (storedProject?.sourceChallenges || []).reduce(
      (sum, challenge) => sum + (challenge.unknownRequirements?.length || 0),
      0,
    ),
    preview: projectPlanViewModel(plan, planNotice),
    planNotice: planNotice == null ? null : String(planNotice),
    observedAt,
  };
};

const buildRun = (state) => {
  if (!ACTIVE_RUN_STATUSES.has(String(state.runStatus || "idle"))) return null;
  const timeline = Array.isArray(state.timeline) ? state.timeline : [];
  const currentIndex = timeline.findIndex((entry) => entry.active);
  const current = currentIndex >= 0 ? timeline[currentIndex] : null;
  const next = currentIndex >= 0
    ? timeline.slice(currentIndex + 1).find((entry) => entry.status === "pending")
    : timeline.find((entry) => entry.status === "pending");
  const status = String(state.runStatus);
  const intervention = state.pauseReason || state.error
    ? {
        title: status === "recovery_required" ? "Needs review" : "Run paused",
        message: String(state.pauseReason || state.error),
      }
    : null;
  const guard = status === "recovery_required"
    ? { state: "recovery", label: "Recovery", reason: intervention?.message || null }
    : status === "paused"
      ? { state: "caution", label: "Caution", reason: intervention?.message || null }
      : { state: "normal", label: "Normal", reason: null };
  return {
    title: String(state.runName || "FUT Magic run"),
    modeLabel: String(state.runModeLabel || "Approved plan"),
    status,
    progress: {
      current: Math.max(0, Number(state.iterations || 0)),
      total: Math.max(0, Number(state.maxIterations || 0)) || null,
      label: "cycles",
    },
    currentStep: current
      ? { label: STEP_LABELS[current.type] || String(current.type), status: current.status }
      : null,
    nextStep: next ? { label: STEP_LABELS[next.type] || String(next.type) } : null,
    timeline: timeline.map((entry) => ({
      label: STEP_LABELS[entry.type] || String(entry.type),
      status: String(entry.status || "pending"),
      active: Boolean(entry.active),
    })),
    guard,
    intervention,
    canPause: status === "running" || status === "waiting",
    canResume: status === "paused",
    canStop: !["stopped", "completed", "failed"].includes(status),
  };
};

const buildClubHealth = (state, observedAt) => {
  const inventory = state.inventory || {};
  const buckets = state.inventoryBuckets || {};
  const ratingBand = (labels) => labels.reduce((sum, label) => {
    const entry = buckets[label] || {};
    return {
      club: sum.club + Number(entry.club || 0),
      storage: sum.storage + Number(entry.storage || 0),
    };
  }, { club: 0, storage: 0 });
  return {
    observedAt,
    available: Boolean(state.inventoryAvailable),
    clubCount: state.inventoryAvailable ? Number(inventory.clubCount || 0) : null,
    unassignedCount: state.inventoryAvailable ? Number(inventory.unassignedCount || 0) : null,
    duplicateGroupCount: state.inventoryAvailable
      ? Number(inventory.duplicateGroupCount || 0)
      : null,
    storage: {
      used: state.inventoryAvailable ? Number(inventory.storageCount || 0) : null,
      capacity: state.inventoryAvailable ? Number(inventory.storageCapacity || 0) || null : null,
      free: state.inventoryAvailable && inventory.storageFreeSlots != null
        ? Number(inventory.storageFreeSlots)
        : null,
    },
    ratingBands: [
      { label: "90+ cards", ...ratingBand(["90", "91", "92", "93", "94+"]) },
      { label: "87–89 cards", ...ratingBand(["87", "88", "89"]) },
      { label: "85–86 cards", ...ratingBand(["85", "86"]) },
    ],
    protectedCount: state.fodderReviewPlan?.preview?.uniqueHardProtectedCount == null
      ? null
      : Number(state.fodderReviewPlan.preview.uniqueHardProtectedCount),
  };
};

const goalActions = (state, activeProject, compatibility) => {
  const unassignedCount = Number(state.inventory?.unassignedCount || 0);
  const actions = [
  {
    id: "complete-sbc",
    label: "Complete an SBC",
    description: state.currentContext?.challengeName
      ? `Continue ${state.currentContext.challengeName}`
      : "Open an SBC in EA to continue",
    enabled: Boolean(state.currentContext?.challengeId),
    command: activeProject
      ? { type: "PREVIEW_SBC_PROJECT", projectId: activeProject.id }
      : { type: "OPEN_LEGACY_UI", section: "SBC Solver" },
    plan: "free",
  },
  {
    id: "grind-upgrades",
    label: "Grind upgrades",
    description: "Build a bounded local recipe",
    enabled: true,
    command: { type: "OPEN_LEGACY_UI", section: "Workflows" },
    plan: "free",
  },
  {
    id: "clear-duplicates",
    label: "Clear duplicates",
    description: unassignedCount > 0
      ? `${unassignedCount} items need attention`
      : "Review the safe routing flow",
    enabled: Boolean(state.inventoryAvailable),
    disabledReason: "Current Unassigned data is unavailable",
    command: state.inventoryAvailable ? { type: "PREVIEW_CLEAR_DUPLICATES" } : null,
    plan: "free",
  },
  {
    id: "protect-cards",
    label: "Protect my cards",
    description: state.fodderReviewPlan?.preview?.uniqueHardProtectedCount == null
      ? "Review exclusions and local squad preferences"
      : `${Number(state.fodderReviewPlan.preview.uniqueHardProtectedCount)} verified exclusions in the latest snapshot`,
    enabled: true,
    command: { type: "PREVIEW_FODDER_REVIEW" },
    plan: "free",
  },
  {
    id: "plan-evolution",
    label: "Plan an Evolution",
    description: "Live Evolution data is not available in this build",
    enabled: false,
    disabledReason: "Live Evolution data is not available in this build",
    command: null,
    plan: "pro",
  },
  {
    id: "optimize-club",
    label: "Optimize my club",
    description: "Club-wide planning is coming later",
    enabled: false,
    disabledReason: "Club optimization is not implemented yet",
    command: null,
    plan: "pro",
  },
  ];
  if (!compatibility) return actions;
  const disabledReason = compatibility.gameVersion === GameVersion.FC27
    ? "FC 27 planning is not verified in this build"
    : "Confirm the game version before planning";
  const compatibilityGated = new Set([
    "complete-sbc",
    "grind-upgrades",
    "clear-duplicates",
    "protect-cards",
  ]);
  return actions.map((action) => compatibilityGated.has(action.id)
    ? { ...action, enabled: false, disabledReason, command: null }
    : action);
};

export const buildProductShellViewModel = (state = {}, { now = Date.now() } = {}) => {
  const storedProjects = new Map(
    (state.projects || []).map((project) => [String(project.id), project]),
  );
  const projects = (state.targetDashboard || []).map((project) =>
    projectViewModel(
      project,
      storedProjects.get(String(project.id)),
      now,
      state.sbcPlanPreviews?.[String(project.id)],
      state.sbcPlanNotices?.[String(project.id)],
    ));
  const activeProject = projects.find((project) => project.state === "active") || null;
  const run = buildRun(state);
  const unassignedCount = Number(state.inventory?.unassignedCount || 0);
  const runtimeContext = state.gameContext || {};
  const gameContext = createGameContext({
    gameVersion: runtimeContext.gameVersion ?? state.gameVersion ?? GameVersion.UNKNOWN,
    state: runtimeContext.state ?? state.gameContextState ?? (
      state.bridgeHealth === "healthy" && state.currentContext?.challengeId
        ? "verified"
        : "unverified"
    ),
    challengeKind: runtimeContext.challengeKind,
    gameVersionObservation: runtimeContext.gameVersionObservation,
    gameVersionSource: runtimeContext.gameVersionSource,
    route: runtimeContext.route ?? state.currentContext?.route,
    setId: runtimeContext.setId ?? state.currentContext?.setId,
    setName: runtimeContext.setName ?? state.currentContext?.setName,
    challengeId: runtimeContext.challengeId ?? state.currentContext?.challengeId,
    challengeName: runtimeContext.challengeName ?? state.currentContext?.challengeName,
    observedAt: Number(runtimeContext.observedAt ?? state.contextObservedAt ?? now),
    evidence: runtimeContext.evidence ?? null,
  });
  const compatibility = compatibilityFor(gameContext);
  let notice = null;
  if (run?.intervention) {
    notice = { tone: "warning", ...run.intervention };
  } else if (unassignedCount > 0) {
    notice = {
      tone: "warning",
      title: `${unassignedCount} items need attention`,
      message: "Unassigned items block the next pack until they are routed safely.",
    };
  } else if (state.error) {
    notice = { tone: "error", title: "FUT Magic is limited", message: String(state.error) };
  }
  return {
    protocolVersion: 1,
    revision: Math.max(0, Number(state.productRevision || 0)),
    observedAt: now,
    brand: { name: "FUT Magic", paidName: "FUT Magic Pro", plan: "free" },
    connection: {
      state: connectionFor(state),
      label: state.bridgeHealth === "healthy" ? "EA connected" : state.bridgeHealth === "unavailable" ? "Limited" : "Connecting",
    },
    context: gameContext,
    compatibility,
    notice,
    run,
    projects,
    activeProject,
    clubHealth: buildClubHealth(state, now),
    duplicateRoute: duplicateRoutePlanViewModel(
      state.duplicateRoutePlan,
      state.duplicateRouteNotice,
    ),
    routerRecommendation: routerRecommendationViewModel(
      state.routerRecommendation,
      state.routerRecommendationNotice,
    ),
    protection: protectionPlanViewModel(state.fodderReviewPlan, state),
    actions: goalActions(state, activeProject, compatibility),
    legacyAvailable: true,
    legal: {
      disclaimer: "Unofficial. Not affiliated with or endorsed by Electronic Arts.",
      license: "GPL-3.0-only",
      sourceUrl: "https://github.com/Matchekk/Matchek-s-FUT-Magic",
      licenseUrl: "../LICENSE",
      privacyUrl: "../PRIVACY.md",
      noticesUrl: "../THIRD_PARTY_NOTICES.md",
      warranty: "No warranty. Redistribution and modification are permitted under GPLv3.",
    },
  };
};

export { STEP_LABELS };
