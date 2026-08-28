import { INVENTORY_RESOLUTION_ACTIONS } from "../inventory/resolution-policy.js";
import { cloneAndFreeze, stableFingerprint } from "./immutable.js";
import { buildPlanningFingerprints, comparePlanningFingerprints } from "./sbc-preview.js";

export const DUPLICATE_ROUTE_READ_CAPABILITIES = Object.freeze([
  "ea.inventory.read",
  "ea.unassigned.read",
]);

export const DUPLICATE_ROUTE_MOVE_CAPABILITIES = Object.freeze([
  "ea.items.move",
]);

export const DUPLICATE_ROUTE_POLICY = Object.freeze({
  schemaVersion: 1,
  preferSbcStorage: true,
  tradableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.SAFE_HOLD,
  untradeableWhenStorageUnavailable: INVENTORY_RESOLUTION_ACTIONS.PAUSE,
});

const SAFE_TYPES = new Set([
  INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB,
  INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE,
]);
const MAX_APPROVABLE_ROUTE_ITEMS = 100;

const canonicalAction = (action = {}) => ({
  itemId: String(action.itemId || ""),
  type: String(action.type || ""),
  from: String(action.from || ""),
  to: String(action.to || ""),
  reason: String(action.reason || ""),
});

export const canonicalDuplicateRouteActions = (actions = []) =>
  cloneAndFreeze((actions || []).map(canonicalAction).sort((left, right) =>
    `${left.itemId}:${left.type}:${left.to}`.localeCompare(
      `${right.itemId}:${right.type}:${right.to}`,
    )));

export const fingerprintDuplicateRouteActions = (actions = []) =>
  stableFingerprint(canonicalDuplicateRouteActions(actions));

const publicReason = (action) => {
  const reasons = {
    not_duplicate: "Unique card can move to Club",
    duplicate_storage_available: "Exact duplicate can move to SBC Storage",
    tradable_duplicate_storage_unavailable: "Tradable duplicate stays for your decision",
    untradeable_duplicate_storage_unavailable: "No verified safe destination is available",
    duplicate_identity_ambiguous: "Exact card version could not be verified",
    unassigned_item_not_movable: "EA reports this card cannot move",
  };
  return reasons[action.reason] || "Kept unassigned for your decision";
};

export const summarizeDuplicateRoute = ({ plan, inventorySnapshot }) => {
  const byId = new Map(
    (inventorySnapshot?.unassigned?.items || []).map((item) => [String(item.itemId), item]),
  );
  const actions = canonicalDuplicateRouteActions(plan?.actions || []);
  const blockers = [];

  for (const action of actions) {
    const item = byId.get(action.itemId);
    if (!item) {
      blockers.push({
        code: "ROUTE_ITEM_UNOBSERVED",
        message: "The route references an item outside the current Unassigned snapshot.",
      });
      continue;
    }
    if (action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB &&
      (!item.hasMovableEvidence || item.isMovable !== true)) {
      blockers.push({
        code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
        message: "EA did not provide verified Club-move evidence for every proposed card.",
      });
    }
    if (action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE &&
      (!item.hasMovableEvidence || item.isMovable !== false ||
        !item.hasStorableEvidence || item.isStorable !== true)) {
      blockers.push({
        code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
        message: "EA did not provide verified SBC Storage evidence for every proposed card.",
      });
    }
    if (
      action.type === INVENTORY_RESOLUTION_ACTIONS.PAUSE &&
      String(action.reason || "").endsWith("_evidence_unverified")
    ) {
      blockers.push({
        code: "ROUTING_CAPABILITY_EVIDENCE_MISSING",
        message: "EA did not provide verified movement evidence for every proposed card.",
      });
    }
  }

  const safeActions = actions.filter((action) => SAFE_TYPES.has(action.type));
  const heldActions = actions.filter((action) => !SAFE_TYPES.has(action.type));
  const expectedUnassignedItemIdsBefore = [...byId.keys()].sort();
  const expectedRemainingItemIdsAfter = heldActions.map((action) => action.itemId).sort();
  if (actions.length !== expectedUnassignedItemIdsBefore.length ||
      new Set(actions.map((action) => action.itemId)).size !== actions.length) {
    blockers.push({
      code: "ROUTE_COVERAGE_MISMATCH",
      message: "The route does not account for every current Unassigned item exactly once.",
    });
  }
  if (actions.length > MAX_APPROVABLE_ROUTE_ITEMS) {
    blockers.push({
      code: "ROUTE_TOO_LARGE",
      message: `This route exceeds the ${MAX_APPROVABLE_ROUTE_ITEMS}-item safety boundary.`,
    });
  }

  const uniqueBlockers = [...new Map(
    blockers.map((blocker) => [`${blocker.code}:${blocker.message}`, blocker]),
  ).values()];
  const cards = actions.map((action) => {
    const item = byId.get(action.itemId) || {};
    return {
      itemId: action.itemId,
      name: item.name || null,
      rating: Number(item.rating || 0),
      isSpecial: Boolean(item.isSpecial),
      isTradable: Boolean(item.isTradable),
      action: action.type,
      destination: action.to,
      reason: publicReason(action),
    };
  });

  return cloneAndFreeze({
    status: uniqueBlockers.length ? "blocked" : safeActions.length ? "ready" : "clear",
    totalCount: actions.length,
    safeCount: safeActions.length,
    toClubCount: safeActions.filter((action) =>
      action.type === INVENTORY_RESOLUTION_ACTIONS.SEND_TO_CLUB).length,
    toStorageCount: safeActions.filter((action) =>
      action.type === INVENTORY_RESOLUTION_ACTIONS.MOVE_TO_SBC_STORAGE).length,
    attentionCount: heldActions.length,
    cards,
    blockers: uniqueBlockers,
    routeActions: actions,
    approvedActions: safeActions,
    expectedUnassignedItemIdsBefore,
    expectedRemainingItemIdsAfter,
    actionSetFingerprint: fingerprintDuplicateRouteActions(actions),
  });
};

export const buildDuplicateRouteFingerprints = ({
  gameContext,
  inventorySnapshot,
  capabilitySnapshot,
  policy,
  routeActions,
}) => buildPlanningFingerprints({
  gameContext,
  inventorySnapshot,
  capabilitySnapshot,
  requiredCapabilities: [
    ...DUPLICATE_ROUTE_READ_CAPABILITIES,
    ...DUPLICATE_ROUTE_MOVE_CAPABILITIES,
  ],
  bindings: {
    policy,
    actionSetFingerprint: fingerprintDuplicateRouteActions(routeActions),
  },
});

export const compareDuplicateRouteFingerprints = comparePlanningFingerprints;
