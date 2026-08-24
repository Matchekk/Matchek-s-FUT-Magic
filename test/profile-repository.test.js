import test from "node:test";
import assert from "node:assert/strict";

import { ChromeStorageProfileRepository, PROFILE_STORAGE_KEY } from "../src/profiles/profile-repository.js";

test("Chrome profile repository persists through the injected storage area", async () => {
  const state = {};
  const storage = {
    async get(key) { return { [key]: state[key] }; },
    async set(patch) { Object.assign(state, structuredClone(patch)); },
    async remove(key) { delete state[key]; },
  };
  const repository = new ChromeStorageProfileRepository(storage);
  await repository.put({ id: "profile-one", name: "One" });
  assert.equal((await repository.get("profile-one")).name, "One");
  assert.equal(Object.keys(state[PROFILE_STORAGE_KEY]).length, 1);
  assert.equal(await repository.delete("profile-one"), true);
  assert.equal(Object.hasOwn(state, PROFILE_STORAGE_KEY), false);
});
