import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("commercial client has no identity, commerce, remote-service, or broad page permission", () => {
  const manifest = JSON.parse(read("../manifest.json"));
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*",
    "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*",
  ]);
  for (const key of ["oauth2", "externally_connectable", "optional_host_permissions", "update_url", "key"]) {
    assert.equal(Object.hasOwn(manifest, key), false, `${key} must not be configured`);
  }
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:\/\/|unsafe-eval|unsafe-inline/i);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, manifest.content_scripts[0].matches);
});

test("unlicensed external provider and legacy donation are disabled in shipped code", () => {
  const background = read("../background.js");
  const bridge = read("../page/ea-data-bridge.js");
  assert.match(background, /const FUTGG_PROVIDER_ENABLED = false;/);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../manifest.json"))), /fut\.gg/i);
  assert.doesNotMatch(bridge, /ko-fi|Support AutopilotSBC|Support My Work/i);
});

test("legacy EA-origin metadata caches are purged instead of persisted", () => {
  const bridge = read("../page/ea-data-bridge.js");
  for (const key of ["EXCLUDED_PLAYER_META_STORAGE_KEY", "LEAGUE_META_STORAGE_KEY", "NATION_META_STORAGE_KEY"]) {
    assert.match(bridge, new RegExp(`removeItem\\?\\.\\(${key}\\)`));
    assert.doesNotMatch(bridge, new RegExp(`setItem\\?\\.\\([\\s\\S]{0,80}${key}`));
  }
});

test("packaging produces a root-manifest CWS archive and separate corresponding source", () => {
  const source = read("../scripts/package.mjs");
  assert.match(source, /-cws\.zip/);
  assert.match(source, /-source\.zip/);
  assert.match(source, /sourceFolders[^\n]+"test"/);
  assert.match(source, /writeArchive\(\{ paths: storePaths, output: storeOutput \}\)/);
  assert.match(source, /prefix: `\$\{archiveRoot\}\/`/);
  assert.match(source, /workingTreeClean/);
});

test("commercial readiness matrix remains explicit and blocks external launch gates", () => {
  const readiness = read("../docs/COMMERCIAL_READINESS.md");
  for (const heading of ["Owner", "Evidence", "Status", "Required closure"]) {
    assert.match(readiness, new RegExp(`\\b${heading}\\b`));
  }
  for (const gate of ["EA authorization", "FUT.GG", "Account lifecycle", "Subscription", "Support", "Chrome Web Store", "Exact corresponding source"]) {
    assert.match(readiness, new RegExp(gate, "i"));
  }
  assert.match(readiness, /BLOCKED/);
  assert.match(readiness, /No publication or purchase/i);
});
