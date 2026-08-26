import { Feature } from "../entitlement-service.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "./errors.js";
import {
  PRO_CONTRACT_SCHEMA_VERSION,
  assertExactKeys,
  assertPlainJson,
  assertSchemaVersion,
  cloneAndFreezeContract,
  normalizeBoolean,
  normalizeEnum,
  normalizeFiniteInteger,
  normalizeSafeId,
  normalizeStringArray,
} from "./schema.js";

export const RECIPE_CATALOG_STATUS = Object.freeze({
  READY: "ready",
  CACHED: "cached",
});

export const RECIPE_CATALOG_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
export const RECIPE_CATALOG_MAX_RECIPES = 128;

const GAME_VERSIONS = Object.freeze(["fc26", "fc27"]);

const fail = (message, path, code = PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID) => {
  throw new ProContractError(code, message, { path });
};

const normalizeKnownDefinitions = (values) => {
  const entries = values instanceof Set ? [...values] : values;
  if (!Array.isArray(entries)) {
    throw new TypeError("knownLocalDefinitionIds must be an array or Set");
  }
  return new Set(entries.map((value, index) => normalizeSafeId(value, {
    path: `$knownLocalDefinitionIds[${index}]`,
  })));
};

const normalizeRecipe = (input, index, knownDefinitions) => {
  const path = `$recipeCatalog.recipes[${index}]`;
  assertExactKeys(input, {
    required: [
      "id",
      "localDefinitionId",
      "localDefinitionVersion",
      "enabled",
      "gameVersions",
      "requiredFeatureId",
      "requiredCapabilityIds",
    ],
    path,
  });
  const localDefinitionId = normalizeSafeId(input.localDefinitionId, {
    path: `${path}.localDefinitionId`,
  });
  if (!knownDefinitions.has(localDefinitionId)) {
    fail(
      "Recipe catalog references a local definition outside the injected allowlist",
      `${path}.localDefinitionId`,
    );
  }
  const requiredCapabilityIds = normalizeStringArray(input.requiredCapabilityIds, {
    path: `${path}.requiredCapabilityIds`,
    maxItems: 32,
    maxItemLength: 128,
    sort: true,
  }).map((value, capabilityIndex) => normalizeSafeId(value, {
    path: `${path}.requiredCapabilityIds[${capabilityIndex}]`,
  }));

  return {
    id: normalizeSafeId(input.id, { path: `${path}.id` }),
    localDefinitionId,
    localDefinitionVersion: normalizeFiniteInteger(input.localDefinitionVersion, {
      path: `${path}.localDefinitionVersion`, min: 1, max: 1_000_000,
    }),
    enabled: normalizeBoolean(input.enabled, { path: `${path}.enabled` }),
    gameVersions: normalizeStringArray(input.gameVersions, {
      path: `${path}.gameVersions`,
      allowed: GAME_VERSIONS,
      maxItems: GAME_VERSIONS.length,
      sort: true,
    }),
    requiredFeatureId: normalizeEnum(input.requiredFeatureId, Object.values(Feature), {
      path: `${path}.requiredFeatureId`,
    }),
    requiredCapabilityIds,
  };
};

/**
 * Validate remote availability metadata for recipe implementations already
 * shipped in the extension. This contract intentionally cannot carry recipe
 * behavior, user-facing content, parameters, links, selectors, or code.
 */
export const normalizeRecipeCatalogSnapshot = ({
  input,
  knownLocalDefinitionIds,
  now = Date.now(),
}) => {
  assertPlainJson(input, {
    path: "$recipeCatalog",
    maxArrayLength: RECIPE_CATALOG_MAX_RECIPES,
  });
  assertExactKeys(input, {
    required: [
      "schemaVersion",
      "status",
      "catalogVersion",
      "issuedAt",
      "expiresAt",
      "recipes",
    ],
    path: "$recipeCatalog",
  });
  assertSchemaVersion(input.schemaVersion, { path: "$recipeCatalog.schemaVersion" });
  const currentTime = normalizeFiniteInteger(now, { path: "$now", min: 0 });
  const issuedAt = normalizeFiniteInteger(input.issuedAt, {
    path: "$recipeCatalog.issuedAt", min: 0,
  });
  const expiresAt = normalizeFiniteInteger(input.expiresAt, {
    path: "$recipeCatalog.expiresAt", min: 0,
  });
  if (issuedAt > currentTime) {
    fail("Recipe catalog issue time is in the future", "$recipeCatalog.issuedAt");
  }
  if (expiresAt <= issuedAt || expiresAt <= currentTime) {
    fail(
      "Recipe catalog expiry has elapsed or does not follow its issue time",
      "$recipeCatalog.expiresAt",
      PRO_CONTRACT_ERROR_CODES.RESPONSE_EXPIRED,
    );
  }
  if (expiresAt - issuedAt > RECIPE_CATALOG_MAX_VALIDITY_MS) {
    fail("Recipe catalog validity exceeds its bounded expiry", "$recipeCatalog.expiresAt");
  }
  if (!Array.isArray(input.recipes) || input.recipes.length > RECIPE_CATALOG_MAX_RECIPES) {
    fail("Recipe catalog exceeds its recipe limit", "$recipeCatalog.recipes");
  }
  const knownDefinitions = normalizeKnownDefinitions(knownLocalDefinitionIds);
  const recipes = input.recipes.map((recipe, index) =>
    normalizeRecipe(recipe, index, knownDefinitions));
  const recipeIds = recipes.map((recipe) => recipe.id);
  if (new Set(recipeIds).size !== recipeIds.length) {
    fail("Recipe catalog IDs must be unique", "$recipeCatalog.recipes");
  }
  const definitionIds = recipes.map((recipe) => recipe.localDefinitionId);
  if (new Set(definitionIds).size !== definitionIds.length) {
    fail("Each local recipe definition may appear only once", "$recipeCatalog.recipes");
  }
  recipes.sort((left, right) => left.id.localeCompare(right.id));

  return cloneAndFreezeContract({
    schemaVersion: PRO_CONTRACT_SCHEMA_VERSION,
    status: normalizeEnum(input.status, Object.values(RECIPE_CATALOG_STATUS), {
      path: "$recipeCatalog.status",
    }),
    catalogVersion: normalizeSafeId(input.catalogVersion, {
      path: "$recipeCatalog.catalogVersion",
    }),
    issuedAt,
    expiresAt,
    recipes,
  });
};
