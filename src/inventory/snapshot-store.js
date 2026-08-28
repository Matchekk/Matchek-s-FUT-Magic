import {
  INVENTORY_LOCATIONS,
  normalizeInventoryItem,
} from "./item-model.js";

export class InventoryGenerationConflictError extends Error {
  constructor(expected, actual) {
    super(`Inventory generation conflict: expected ${expected}, current ${actual}`);
    this.name = "InventoryGenerationConflictError";
    this.expectedGeneration = expected;
    this.actualGeneration = actual;
  }
}

export class InventoryIdentityConflictError extends Error {
  constructor(itemId) {
    super(`Owned item ${itemId} appears more than once in the same snapshot`);
    this.name = "InventoryIdentityConflictError";
    this.itemId = itemId;
  }
}

const freezeSource = (location, generation, items) =>
  Object.freeze({ location, generation, items: Object.freeze(items) });

const normalizeCapacity = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError("storageCapacity must be a non-negative integer or null");
  }
  return parsed;
};

const createEmptyState = () => {
  const generation = 0;
  const club = freezeSource(INVENTORY_LOCATIONS.CLUB, generation, []);
  const storage = freezeSource(INVENTORY_LOCATIONS.SBC_STORAGE, generation, []);
  const unassigned = freezeSource(INVENTORY_LOCATIONS.UNASSIGNED, generation, []);
  return Object.freeze({
    generation,
    updatedAt: null,
    storageCapacity: null,
    club,
    storage,
    unassigned,
    items: Object.freeze([]),
  });
};

/** Maintains one coherent inventory generation across every EA item location. */
export class InventorySnapshotStore {
  #state = createEmptyState();
  #clock;

  constructor({ clock = () => new Date().toISOString() } = {}) {
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#clock = clock;
  }

  getSnapshot() {
    return this.#state;
  }

  /**
   * Build and validate the full next state before publishing it. A malformed
   * source therefore cannot leave club/storage/unassigned on mixed generations.
   */
  replaceSnapshot(input = {}, { expectedGeneration = null } = {}) {
    const current = this.#state;
    if (
      expectedGeneration !== null &&
      Number(expectedGeneration) !== current.generation
    ) {
      throw new InventoryGenerationConflictError(
        Number(expectedGeneration),
        current.generation,
      );
    }

    const nextGeneration = current.generation + 1;
    for (const source of ["club", "storage", "unassigned"]) {
      if (!Array.isArray(input[source])) {
        throw new TypeError(`${source} inventory source must be an explicit array`);
      }
    }
    const normalizeSource = (items, location) =>
      items.map((item) =>
        normalizeInventoryItem(item, { location }),
      );

    const clubItems = normalizeSource(input.club, INVENTORY_LOCATIONS.CLUB);
    const storageItems = normalizeSource(
      input.storage,
      INVENTORY_LOCATIONS.SBC_STORAGE,
    );
    const unassignedItems = normalizeSource(
      input.unassigned,
      INVENTORY_LOCATIONS.UNASSIGNED,
    );
    const allItems = [...clubItems, ...storageItems, ...unassignedItems];
    const itemIds = new Set();
    for (const item of allItems) {
      if (itemIds.has(item.itemId)) {
        throw new InventoryIdentityConflictError(item.itemId);
      }
      itemIds.add(item.itemId);
    }

    const club = freezeSource(
      INVENTORY_LOCATIONS.CLUB,
      nextGeneration,
      clubItems,
    );
    const storage = freezeSource(
      INVENTORY_LOCATIONS.SBC_STORAGE,
      nextGeneration,
      storageItems,
    );
    const unassigned = freezeSource(
      INVENTORY_LOCATIONS.UNASSIGNED,
      nextGeneration,
      unassignedItems,
    );
    const next = Object.freeze({
      generation: nextGeneration,
      updatedAt: String(this.#clock()),
      storageCapacity: normalizeCapacity(input.storageCapacity),
      club,
      storage,
      unassigned,
      items: Object.freeze([...club.items, ...storage.items, ...unassigned.items]),
    });
    this.#state = next;
    return next;
  }
}

