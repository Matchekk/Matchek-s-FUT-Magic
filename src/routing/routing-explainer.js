export const RoutingReason = Object.freeze({
  RULE_MATCHED: "RULE_MATCHED",
  PROTECTED_FROM_CONSUMPTION: "PROTECTED_FROM_CONSUMPTION",
  DUPLICATE_IDENTITY_AMBIGUOUS: "DUPLICATE_IDENTITY_AMBIGUOUS",
  MOVE_EVIDENCE_MISSING: "MOVE_EVIDENCE_MISSING",
  STORAGE_EVIDENCE_MISSING: "STORAGE_EVIDENCE_MISSING",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  TRADEABILITY_UNVERIFIED: "TRADEABILITY_UNVERIFIED",
  TRANSFER_SOURCE_UNAVAILABLE: "TRANSFER_SOURCE_UNAVAILABLE",
  RECIPE_UNVERIFIED: "RECIPE_UNVERIFIED",
  NON_DUPLICATE_TO_CLUB: "NON_DUPLICATE_TO_CLUB",
  DUPLICATE_TO_STORAGE: "DUPLICATE_TO_STORAGE",
  TRADEABLE_DUPLICATE_PRESERVED: "TRADEABLE_DUPLICATE_PRESERVED",
  USER_DECISION_REQUIRED: "USER_DECISION_REQUIRED",
  ACTIVITY_GUARD_BLOCKED: "ACTIVITY_GUARD_BLOCKED",
});

const COPY = Object.freeze({
  [RoutingReason.RULE_MATCHED]: "Matched the first eligible routing rule.",
  [RoutingReason.PROTECTED_FROM_CONSUMPTION]: "This item is protected from consuming routes.",
  [RoutingReason.DUPLICATE_IDENTITY_AMBIGUOUS]: "Duplicate identity could not be verified.",
  [RoutingReason.MOVE_EVIDENCE_MISSING]: "FUT Magic could not verify that this item can move.",
  [RoutingReason.STORAGE_EVIDENCE_MISSING]: "SBC Storage eligibility is unverified.",
  [RoutingReason.STORAGE_UNAVAILABLE]: "SBC Storage has no verified free slot.",
  [RoutingReason.TRADEABILITY_UNVERIFIED]: "Tradeability evidence is missing.",
  [RoutingReason.TRANSFER_SOURCE_UNAVAILABLE]: "Transfer List state is not part of the verified inventory snapshot.",
  [RoutingReason.RECIPE_UNVERIFIED]: "No verified active recipe accepts this item.",
  [RoutingReason.NON_DUPLICATE_TO_CLUB]: "This verified non-duplicate can move to Club.",
  [RoutingReason.DUPLICATE_TO_STORAGE]: "This duplicate has a verified SBC Storage destination.",
  [RoutingReason.TRADEABLE_DUPLICATE_PRESERVED]: "This tradeable duplicate is preserved for a user decision.",
  [RoutingReason.USER_DECISION_REQUIRED]: "FUT Magic needs a user decision before continuing.",
  [RoutingReason.ACTIVITY_GUARD_BLOCKED]: "Activity Guard is not ready for another planned action.",
});

export function explainRoutingDecision(reasonCodes = []) {
  const unique = [...new Set(reasonCodes)];
  return Object.freeze(unique.map((code) => Object.freeze({
    code,
    message: COPY[code] ?? COPY[RoutingReason.USER_DECISION_REQUIRED],
  })));
}
