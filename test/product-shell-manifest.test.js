import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest exposes the native FUT Magic Side Panel with scoped MV3 permissions", () => {
  assert.equal(manifest.name.startsWith("FUT Magic"), true);
  assert.equal(manifest.side_panel.default_path, "sidepanel/index.html");
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "sidePanel"]);
  assert.equal(manifest.minimum_chrome_version, "120");
  assert.equal(existsSync(new URL("../sidepanel/index.html", import.meta.url)), true);
  assert.equal(existsSync(new URL("../sidepanel/app.js", import.meta.url)), true);
  assert.doesNotMatch(readFileSync(new URL("../sidepanel/index.html", import.meta.url), "utf8"), /https?:\/\/[^\s"']+\.js/i);
  const resources = manifest.web_accessible_resources.flatMap(
    (entry) => entry.resources ?? [],
  );
  assert.ok(resources.includes("page/fut-magic-ea-workspace.js"));
});

test("legacy GrindPilot storage keys remain present for backward compatibility", () => {
  const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  for (const key of ["grindpilot.activeRun.v1", "grindpilot.activity.v1", "grindpilot.profiles.v1", "grindpilot.projects.v1", "grindpilot.settings.v1"]) {
    assert.match(background, new RegExp(key.replaceAll(".", "\\.")));
  }
});
