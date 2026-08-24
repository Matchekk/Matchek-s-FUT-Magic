import { DuplicateService } from "./duplicate-service.js";
import { normalizeIdentifier } from "./item-model.js";
import { planUnassignedResolution } from "./resolution-policy.js";
import { InventorySnapshotStore } from "./snapshot-store.js";

/** Central read/model service for Club, SBC Storage, and Unassigned items. */
export class InventoryService {
  #store;
  #duplicates;

  constructor({ snapshotStore = new InventorySnapshotStore(), duplicateService = new DuplicateService() } = {}) {
    this.#store = snapshotStore;
    this.#duplicates = duplicateService;
  }

  synchronize(input, options) {
    return this.#store.replaceSnapshot(input, options);
  }

  getSnapshot() {
    return this.#store.getSnapshot();
  }

  getItems(location = null) {
    const snapshot = this.getSnapshot();
    if (location === null) return snapshot.items;
    if (location === "club") return snapshot.club.items;
    if (location === "storage" || location === "sbc_storage") {
      return snapshot.storage.items;
    }
    if (location === "unassigned") return snapshot.unassigned.items;
    throw new TypeError(`Unsupported inventory location: ${location}`);
  }

  findByItemId(itemId) {
    const normalized = normalizeIdentifier(itemId, {
      required: true,
      name: "itemId",
    });
    return this.getSnapshot().items.find((item) => item.itemId === normalized) ?? null;
  }

  findByResourceId(resourceId) {
    const normalized = normalizeIdentifier(resourceId, {
      required: true,
      name: "resourceId",
    });
    return Object.freeze(
      this.getSnapshot().items.filter((item) => item.resourceId === normalized),
    );
  }

  getDuplicateGroups() {
    return this.#duplicates.group(this.getSnapshot().items);
  }

  planUnassignedResolution(policy) {
    return planUnassignedResolution(this.getSnapshot(), policy);
  }

  getStatus() {
    const snapshot = this.getSnapshot();
    const capacity = snapshot.storageCapacity;
    return Object.freeze({
      generation: snapshot.generation,
      clubCount: snapshot.club.items.length,
      storageCount: snapshot.storage.items.length,
      storageCapacity: capacity,
      storageFreeSlots:
        capacity == null
          ? null
          : Math.max(0, capacity - snapshot.storage.items.length),
      unassignedCount: snapshot.unassigned.items.length,
      duplicateGroupCount: this.getDuplicateGroups().length,
    });
  }
}

