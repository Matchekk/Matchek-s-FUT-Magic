import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("EA-native workspace is packaged and injected through the scoped MAIN-world boundary", () => {
  const manifest = JSON.parse(read("../manifest.json"));
  const resources = manifest.web_accessible_resources.flatMap(
    (entry) => entry.resources ?? [],
  );
  const contentScript = read("../content-script.js");
  const background = read("../background.js");

  assert.ok(resources.includes("page/fut-magic-ea-workspace.js"));
  assert.match(contentScript, /workspacePath\s*=\s*"page\/fut-magic-ea-workspace\.js"/);
  assert.match(contentScript, /injectPageScript\(workspacePath,\s*\{\s*type:\s*null\s*\}\)/);
  assert.match(background, /"page\/fut-magic-ea-workspace\.js"/);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, ["https://www.ea.com/*"]);
});

test("native adapter adds one EA route and home entry without gaining execution or network authority", () => {
  const source = read("../page/fut-magic-ea-workspace.js");

  for (const contract of [
    /JSUtils\?\.inherits/,
    /EAViewController/,
    /UTHomeHubViewController/,
    /UTTileView/,
    /presentation:\s*"native"/,
    /openSequenceSolver/,
    /closeSequenceSolver/,
    /data-fut-magic-home-tile/,
  ]) {
    assert.match(source, contract);
  }

  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//i);
  assert.doesNotMatch(source, /submitSbc|openPack|sendToClub|quickSell|moveItem/i);
  assert.doesNotMatch(source, /AutoSBC|FUTGenie/i);
  assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/);
});

test("existing planner supports native mounting, accessible states, and an overlay fallback", () => {
  const bridge = read("../page/ea-data-bridge.js");
  const styles = read("../page/ea-data-bridge.css");

  assert.match(bridge, /presentation\s*=\s*"overlay"/);
  assert.match(bridge, /sequenceSolveOverlayState\.presentation\s*=\s*useNative\s*\?\s*"native"\s*:\s*"overlay"/);
  assert.match(bridge, /sequenceSolveOverlayState\?\.presentation === "native"/);
  assert.match(bridge, /Planning only/);
  assert.match(bridge, /setAttribute\?\.\("role",\s*"region"\)/);
  assert.match(bridge, /removeAttribute\?\.\("aria-modal"\)/);
  assert.match(bridge, /FutMagicEaWorkspace\?\.open/);
  assert.match(bridge, /Open FUT Magic Grind/);

  for (const contract of [
    /--fm-bg-primary/,
    /data-presentation="native"/,
    /:focus-visible/,
    /prefers-reduced-motion/,
    /prefers-reduced-transparency/,
    /prefers-contrast:\s*more/,
  ]) {
    assert.match(styles, contract);
  }
});

test("clean-room decision record documents adopted and rejected competitor patterns", () => {
  const record = read("../docs/exec-plans/fut-magic-ea-native-workspace.md");

  assert.match(record, /clean-room/i);
  assert.match(record, /native EA navigation-controller route/i);
  assert.match(record, /broad unrelated prototype patching/i);
  assert.match(record, /remote telemetry/i);
  assert.match(record, /Native execution remains disabled/i);
  assert.match(record, /typed command delegates through the isolated WorkflowEngine and scheduler/i);
});
