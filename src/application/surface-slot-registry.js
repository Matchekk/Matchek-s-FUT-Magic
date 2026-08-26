import { cloneAndFreeze } from "./immutable.js";

export const SurfaceSlot = Object.freeze({
  PACK_ACTIONS: "ea.pack.actions",
  ITEMS_HEADER: "ea.items.header",
  SBC_HEADER: "ea.sbc.header",
  GLOBAL_HEADER: "ea.global.header",
});

export class SurfaceSlotRegistry {
  #entries = new Map();

  register(slot, contribution) {
    if (!Object.values(SurfaceSlot).includes(slot)) throw new TypeError(`Unknown surface slot: ${slot}`);
    const id = String(contribution?.id || "").trim();
    if (!id) throw new TypeError("Surface contribution requires an id");
    const entries = this.#entries.get(slot) || [];
    if (entries.some((entry) => entry.id === id)) throw new Error(`Duplicate surface contribution: ${slot}/${id}`);
    const next = cloneAndFreeze({
      id,
      slot,
      priority: Number(contribution.priority || 0),
      exclusive: Boolean(contribution.exclusive),
      label: String(contribution.label || id),
      command: contribution.command || null,
    });
    if (next.exclusive && entries.some((entry) => entry.exclusive)) {
      throw new Error(`Exclusive surface collision in ${slot}`);
    }
    this.#entries.set(slot, [...entries, next].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)));
    return next;
  }

  list(slot) {
    if (!Object.values(SurfaceSlot).includes(slot)) throw new TypeError(`Unknown surface slot: ${slot}`);
    return cloneAndFreeze(this.#entries.get(slot) || []);
  }
}
