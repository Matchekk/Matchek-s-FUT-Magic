import { cloneAndFreeze } from "./immutable.js";

export const GameVersion = Object.freeze({ FC26: "fc26", FC27: "fc27", UNKNOWN: "unknown" });
export const GameContextState = Object.freeze({ VERIFIED: "verified", UNVERIFIED: "unverified" });
export const GameChallengeKind = Object.freeze({
  CLASSIC_SQUAD: "classic_squad",
  STREAMLINED_SCORE: "streamlined_score",
  UNKNOWN: "unknown",
});
export const GameVersionObservation = Object.freeze({
  OBSERVED: "observed",
  COMPATIBILITY_DEFAULT: "compatibility_default",
  UNVERIFIED: "unverified",
});

export const normalizeGameVersion = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replaceAll(" ", "");
  if (["fc26", "26", "eafc26"].includes(normalized)) return GameVersion.FC26;
  if (["fc27", "27", "eafc27"].includes(normalized)) return GameVersion.FC27;
  if (["unknown", "unverified"].includes(normalized)) return GameVersion.UNKNOWN;
  throw new TypeError(`Unsupported game version: ${String(value || "missing")}`);
};

export const createGameContext = ({
  gameVersion = GameVersion.UNKNOWN,
  state,
  challengeKind,
  gameVersionObservation,
  gameVersionSource = null,
  route = null,
  setId = null,
  setName = null,
  challengeId = null,
  challengeName = null,
  observedAt = Date.now(),
  evidence = null,
} = {}) => {
  const version = normalizeGameVersion(gameVersion);
  const requestedState = state || (version === GameVersion.FC26
    ? GameContextState.VERIFIED
    : GameContextState.UNVERIFIED);
  if (!Object.values(GameContextState).includes(requestedState)) {
    throw new TypeError(`Unsupported game-context state: ${requestedState}`);
  }
  // FC27 semantics are deliberately observe-only until a verified local
  // strategy ships. Recording an observed version must not imply planning
  // support, even when an outer caller supplies `verified`.
  const resolvedState = version === GameVersion.FC26
    ? requestedState
    : GameContextState.UNVERIFIED;
  const resolvedChallengeKind = challengeKind == null
    ? (version === GameVersion.FC26
      ? GameChallengeKind.CLASSIC_SQUAD
      : GameChallengeKind.UNKNOWN)
    : String(challengeKind);
  if (!Object.values(GameChallengeKind).includes(resolvedChallengeKind)) {
    throw new TypeError(`Unsupported challenge kind: ${resolvedChallengeKind}`);
  }
  const resolvedObservation = gameVersionObservation || (
    version === GameVersion.UNKNOWN
      ? GameVersionObservation.UNVERIFIED
      : GameVersionObservation.OBSERVED
  );
  if (!Object.values(GameVersionObservation).includes(resolvedObservation)) {
    throw new TypeError(`Unsupported game-version observation: ${resolvedObservation}`);
  }
  return cloneAndFreeze({
    gameVersion: version,
    state: resolvedState,
    challengeKind: resolvedChallengeKind,
    gameVersionObservation: resolvedObservation,
    gameVersionSource: gameVersionSource == null ? null : String(gameVersionSource),
    route: route == null ? null : String(route),
    setId: setId == null ? null : String(setId),
    setName: setName == null ? null : String(setName),
    challengeId: challengeId == null ? null : String(challengeId),
    challengeName: challengeName == null ? null : String(challengeName),
    observedAt: Math.max(0, Number(observedAt) || 0),
    evidence,
  });
};

export class GameContextPort {
  async read() {
    throw new Error("GameContextPort.read must be implemented by an adapter");
  }
}
