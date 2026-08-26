import { GameVersion, normalizeGameVersion } from "./game-context.js";
import { cloneAndFreeze } from "./immutable.js";

export const GameStrategyReadiness = Object.freeze({
  VERIFIED: "verified",
  OBSERVE_ONLY: "observe_only",
  UNAVAILABLE: "unavailable",
});

// Expanding this allowlist is an explicit shipped-code activation gate. An
// observed or caller-asserted version can never make itself executable.
export const EXECUTABLE_GAME_STRATEGY_VERSIONS = Object.freeze([
  GameVersion.FC26,
]);

export const isGameStrategyExecutionEnabled = (gameVersion) =>
  EXECUTABLE_GAME_STRATEGY_VERSIONS.includes(normalizeGameVersion(gameVersion));

const ENTRY_KEYS = new Set([
  "id",
  "gameVersion",
  "goalKind",
  "challengeKind",
  "readiness",
  "canCompileSteps",
  "requiredCapabilities",
  "evidenceRevision",
  "strategy",
]);

const identifier = (value, name) => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new TypeError(`Invalid game-strategy ${name}`);
  }
  return normalized;
};

const optionalIdentifier = (value, name) =>
  value == null ? null : identifier(value, name);

const normalizeCapabilities = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("Game-strategy requiredCapabilities must be an array");
  const capabilities = value.map((entry) => identifier(entry, "capability id"));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new TypeError("Game-strategy requiredCapabilities must be unique");
  }
  return capabilities.sort();
};

const normalizeEntry = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Game-strategy entry must be an object");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !ENTRY_KEYS.has(key)) {
      throw new TypeError(`Unsupported game-strategy field: ${String(key)}`);
    }
  }
  const gameVersion = normalizeGameVersion(input.gameVersion);
  const goalKind = identifier(input.goalKind, "goal kind");
  const challengeKind = optionalIdentifier(input.challengeKind, "challenge kind");
  const readiness = input.readiness ?? GameStrategyReadiness.VERIFIED;
  if (!Object.values(GameStrategyReadiness).includes(readiness)) {
    throw new TypeError(`Invalid game-strategy readiness: ${String(readiness)}`);
  }
  const strategy = input.strategy ?? null;
  const canCompileSteps = input.canCompileSteps ?? readiness === GameStrategyReadiness.VERIFIED;
  if (typeof canCompileSteps !== "boolean") {
    throw new TypeError("Game-strategy canCompileSteps must be a boolean");
  }
  if (readiness === GameStrategyReadiness.VERIFIED && typeof strategy !== "function") {
    throw new TypeError("A verified game strategy requires a strategy function");
  }
  if (readiness === GameStrategyReadiness.VERIFIED &&
      !isGameStrategyExecutionEnabled(gameVersion)) {
    throw new TypeError(`Executable game strategies are not enabled for ${gameVersion}`);
  }
  if (readiness !== GameStrategyReadiness.VERIFIED && strategy !== null) {
    throw new TypeError("An unverified game strategy cannot contain a strategy function");
  }
  if (readiness !== GameStrategyReadiness.VERIFIED && canCompileSteps) {
    throw new TypeError("An unverified game strategy cannot compile steps");
  }
  return Object.freeze({
    id: identifier(input.id, "id"),
    gameVersion,
    goalKind,
    challengeKind,
    readiness,
    canCompileSteps,
    requiredCapabilities: Object.freeze(normalizeCapabilities(input.requiredCapabilities)),
    evidenceRevision: optionalIdentifier(input.evidenceRevision, "evidence revision"),
    strategy,
  });
};

const keyFor = (gameVersion, goalKind) => `${gameVersion}\u0000${goalKind}`;

const unavailableResolution = ({ gameVersion, goalKind, challengeKind, reason }) =>
  Object.freeze({
    id: null,
    gameVersion,
    goalKind,
    challengeKind,
    readiness: GameStrategyReadiness.UNAVAILABLE,
    canCompileSteps: false,
    requiredCapabilities: Object.freeze([]),
    evidenceRevision: null,
    strategy: null,
    reason,
  });

export const gameStrategyMetadata = (resolution) => cloneAndFreeze({
  id: resolution?.id ?? null,
  gameVersion: resolution?.gameVersion ?? GameVersion.UNKNOWN,
  goalKind: resolution?.goalKind ?? null,
  challengeKind: resolution?.challengeKind ?? null,
  readiness: resolution?.readiness ?? GameStrategyReadiness.UNAVAILABLE,
  canCompileSteps: resolution?.canCompileSteps === true,
  evidenceRevision: resolution?.evidenceRevision ?? null,
});

/**
 * Immutable, local-only mapping from a game version and goal to one planner.
 * Missing entries fail closed; there is deliberately no wildcard version.
 */
export class GameStrategyRegistry {
  #entries = new Map();

  constructor(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError("GameStrategyRegistry entries must be an array");
    for (const input of entries) {
      const entry = normalizeEntry(input);
      const key = keyFor(entry.gameVersion, entry.goalKind);
      if (this.#entries.has(key)) {
        throw new TypeError(`Duplicate game strategy for ${entry.gameVersion}/${entry.goalKind}`);
      }
      this.#entries.set(key, entry);
    }
    Object.freeze(this);
  }

  resolve({ gameVersion, goalKind, challengeKind = null } = {}) {
    const normalizedVersion = normalizeGameVersion(gameVersion);
    const normalizedGoalKind = identifier(goalKind, "goal kind");
    const normalizedChallengeKind = optionalIdentifier(challengeKind, "challenge kind");
    const entry = this.#entries.get(keyFor(normalizedVersion, normalizedGoalKind));
    if (!entry) {
      return unavailableResolution({
        gameVersion: normalizedVersion,
        goalKind: normalizedGoalKind,
        challengeKind: normalizedChallengeKind,
        reason: "No local strategy is registered for this game version and goal",
      });
    }
    if (entry.challengeKind !== null && entry.challengeKind !== normalizedChallengeKind) {
      return unavailableResolution({
        gameVersion: normalizedVersion,
        goalKind: normalizedGoalKind,
        challengeKind: normalizedChallengeKind,
        reason: "The observed challenge kind does not match the local strategy",
      });
    }
    return entry;
  }

  snapshot() {
    return cloneAndFreeze([...this.#entries.values()]
      .map(gameStrategyMetadata)
      .sort((left, right) => `${left.gameVersion}:${left.goalKind}`.localeCompare(
        `${right.gameVersion}:${right.goalKind}`,
      )));
  }
}

/** Preserve the original constructor surface while binding it to FC26 only. */
export const createLegacyFc26StrategyRegistry = (strategies = {}) => {
  if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) {
    throw new TypeError("PlanCompiler strategies must be an object");
  }
  const entries = Object.entries(strategies).flatMap(([goalKind, strategy]) => {
    const normalizedGoalKind = identifier(goalKind, "goal kind");
    return [
      {
        id: `legacy.fc26.${normalizedGoalKind}.v1`,
        gameVersion: GameVersion.FC26,
        goalKind,
        readiness: GameStrategyReadiness.VERIFIED,
        canCompileSteps: true,
        requiredCapabilities: strategy?.requiredCapabilities || [],
        evidenceRevision: "legacy-fc26-v1",
        strategy,
      },
      {
        id: `builtin.fc27.${normalizedGoalKind}.observe.v1`,
        gameVersion: GameVersion.FC27,
        goalKind,
        readiness: GameStrategyReadiness.OBSERVE_ONLY,
        canCompileSteps: false,
        requiredCapabilities: [],
        evidenceRevision: "fc27-unverified-observation-v1",
        strategy: null,
      },
    ];
  });
  return new GameStrategyRegistry(entries);
};
