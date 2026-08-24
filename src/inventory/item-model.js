export const INVENTORY_LOCATIONS = Object.freeze({
  CLUB: "club",
  SBC_STORAGE: "sbc_storage",
  UNASSIGNED: "unassigned",
});

const LOCATION_ALIASES = new Map([
  ["club", INVENTORY_LOCATIONS.CLUB],
  ["storage", INVENTORY_LOCATIONS.SBC_STORAGE],
  ["sbc-storage", INVENTORY_LOCATIONS.SBC_STORAGE],
  ["sbc_storage", INVENTORY_LOCATIONS.SBC_STORAGE],
  ["sbcstorage", INVENTORY_LOCATIONS.SBC_STORAGE],
  ["unassigned", INVENTORY_LOCATIONS.UNASSIGNED],
]);

const readFirst = (source, keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) {
      return source[key];
    }
  }
  return null;
};

/**
 * FUT identifiers can arrive as numbers, strings, or bigints depending on the
 * EA controller that produced a payload. Normalize at the inventory boundary
 * so the same owned item cannot exist twice as `42` and `"42"`.
 */
export const normalizeIdentifier = (value, { required = false, name = "identifier" } = {}) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw new TypeError(`${name} is required`);
    return null;
  }
  if (!["string", "number", "bigint"].includes(typeof value)) {
    throw new TypeError(`${name} must be a string, number, or bigint`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw new TypeError(`${name} is required`);
    return null;
  }
  return normalized;
};

export const normalizeInventoryLocation = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = LOCATION_ALIASES.get(String(value).trim().toLowerCase());
  if (!normalized) throw new TypeError(`Unsupported inventory location: ${value}`);
  return normalized;
};

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readTradable = (raw) => {
  const direct = readFirst(raw, ["isTradable", "isTradeable", "tradable"]);
  if (typeof direct === "boolean") return direct;
  if (direct === 1 || direct === "1" || direct === "true") return true;
  if (direct === 0 || direct === "0" || direct === "false") return false;
  const untradeable = readFirst(raw, ["isUntradeable", "untradeable"]);
  if (typeof untradeable === "boolean") return !untradeable;
  return false;
};

const normalizeStringList = (value) =>
  Object.freeze(
    Array.from(
      new Set(
        (Array.isArray(value) ? value : value == null ? [] : [value])
          .map((entry) => String(entry).trim())
          .filter(Boolean),
      ),
    ),
  );

/**
 * @typedef {object} InventoryItem
 * @property {string} itemId Unique owned-card instance ID.
 * @property {string|null} resourceId Exact card-version resource ID.
 * @property {string|null} definitionId EA item definition ID, retained separately.
 * @property {string|null} assetId Footballer asset ID shared by base/promo versions.
 * @property {string|null} baseId Optional base-player ID supplied by EA.
 * @property {"club"|"sbc_storage"|"unassigned"} location
 */

/**
 * Normalize an EA item without collapsing instance, version, and footballer IDs.
 * Those IDs have different semantics and must never be used interchangeably.
 *
 * @param {object} raw
 * @param {{location?: string}} options
 * @returns {Readonly<InventoryItem>}
 */
export const normalizeInventoryItem = (raw, options = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Inventory item must be an object");
  }

  const itemId = normalizeIdentifier(readFirst(raw, ["itemId", "id"]), {
    required: true,
    name: "itemId",
  });
  const resourceId = normalizeIdentifier(
    readFirst(raw, ["resourceId", "resourceID"]),
    { name: "resourceId" },
  );
  const definitionId = normalizeIdentifier(
    readFirst(raw, ["definitionId", "defId"]),
    { name: "definitionId" },
  );
  const assetId = normalizeIdentifier(readFirst(raw, ["assetId", "assetID"]), {
    name: "assetId",
  });
  const baseId = normalizeIdentifier(readFirst(raw, ["baseId", "baseID"]), {
    name: "baseId",
  });
  const location = normalizeInventoryLocation(options.location ?? raw.location);
  if (!location) throw new TypeError("Inventory item location is required");

  const isTradable = readTradable(raw);
  return Object.freeze({
    itemId,
    resourceId,
    definitionId,
    assetId,
    baseId,
    location,
    rating: toFiniteNumber(raw.rating) ?? 0,
    name: raw.name == null ? null : String(raw.name),
    cardType: raw.cardType == null ? null : String(raw.cardType),
    rarityId: normalizeIdentifier(raw.rarityId, { name: "rarityId" }),
    rarityName: raw.rarityName == null ? null : String(raw.rarityName),
    specialGroups: normalizeStringList(raw.specialGroups),
    isSpecial: Boolean(raw.isSpecial),
    isTradable,
    // Keep the spelling used by existing AutoPilot payloads as a read-only alias.
    isTradeable: isTradable,
    isUntradeable: !isTradable,
    isDuplicate: Boolean(raw.isDuplicate),
    isLocked: Boolean(raw.isLocked ?? raw.locked),
    isProtected: Boolean(raw.isProtected),
  });
};

