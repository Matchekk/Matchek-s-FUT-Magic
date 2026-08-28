import test from "node:test";
import assert from "node:assert/strict";

import {
  getTranslationCatalog,
  normalizeLocale,
  translate,
} from "../src/i18n/index.js";

test("English and German catalogs have exact key parity", () => {
  assert.deepEqual(
    Object.keys(getTranslationCatalog("en")).sort(),
    Object.keys(getTranslationCatalog("de")).sort(),
  );
});

test("locale normalization and fallback are deterministic", () => {
  assert.equal(normalizeLocale("de-DE"), "de");
  assert.equal(normalizeLocale("fr-FR"), "en");
  assert.equal(translate("routing.moveClub", {}, { locale: "de-DE" }), "In den Verein verschieben");
  assert.equal(translate("missing.key", {}, { locale: "de" }), "missing.key");
});

test("interpolation is bounded and leaves absent placeholders visible", () => {
  assert.equal(translate("common.itemCount", { count: 4 }), "4 items");
  assert.equal(translate("common.itemCount"), "{count} items");
  assert.throws(
    () => translate("common.itemCount", { count: "x".repeat(201) }),
    /too long/,
  );
});
