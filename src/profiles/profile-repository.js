const DEFAULT_STORAGE_KEY = "grindpilot.profiles.v1";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class InMemoryProfileRepository {
  constructor(initialProfiles = []) {
    this.records = new Map(initialProfiles.map((profile) => [profile.id, clone(profile)]));
  }

  async list() {
    return [...this.records.values()].map(clone);
  }

  async get(id) {
    return clone(this.records.get(id) ?? null);
  }

  async put(profile) {
    this.records.set(profile.id, clone(profile));
    return clone(profile);
  }

  async delete(id) {
    return this.records.delete(id);
  }
}

/** Repository backed by chrome.storage.local (or a compatible injected area). */
export class ChromeStorageProfileRepository {
  constructor(storageArea = globalThis.chrome?.storage?.local, storageKey = DEFAULT_STORAGE_KEY) {
    const domainApi = storageArea?.listProfiles && storageArea?.putProfile;
    const legacyApi = storageArea?.get && storageArea?.set && storageArea?.remove;
    if (!domainApi && !legacyApi) {
      throw new TypeError("ChromeStorageProfileRepository requires a storage.local-compatible area");
    }
    this.storageArea = storageArea;
    this.storageKey = storageKey;
    this.domainApi = Boolean(domainApi);
  }

  async #readRecords() {
    const stored = await this.storageArea.get(this.storageKey);
    const value = stored?.[this.storageKey];
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  async list() {
    if (this.domainApi) return (await this.storageArea.listProfiles()).map(clone);
    return Object.values(await this.#readRecords()).map(clone);
  }

  async get(id) {
    if (this.domainApi) return clone(await this.storageArea.getProfile(id));
    const records = await this.#readRecords();
    return clone(records[id] ?? null);
  }

  async put(profile) {
    if (this.domainApi) return clone(await this.storageArea.putProfile(clone(profile)));
    const records = await this.#readRecords();
    records[profile.id] = clone(profile);
    await this.storageArea.set({ [this.storageKey]: records });
    return clone(profile);
  }

  async delete(id) {
    if (this.domainApi) return Boolean(await this.storageArea.deleteProfile(id));
    const records = await this.#readRecords();
    if (!Object.hasOwn(records, id)) return false;
    delete records[id];
    if (Object.keys(records).length === 0) await this.storageArea.remove(this.storageKey);
    else await this.storageArea.set({ [this.storageKey]: records });
    return true;
  }
}

export { DEFAULT_STORAGE_KEY as PROFILE_STORAGE_KEY };
