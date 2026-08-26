import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hud = read("../src/ui/run-hud.js");
const contextual = read("../src/ui/ea-surface-actions.js");
const canonicalTokens = read("../src/brand/tokens.css");

const tokenMap = (source) => new Map([...source.matchAll(/(--fm-[\w-]+):\s*([^;]+);/g)]
  .map(([, name, value]) => [name, value.replaceAll(/\s+/g, " ").trim().toLowerCase()]));

test("run HUD uses the restrained FUT Magic brand system and accessible state language", () => {
  for (const token of [
    "--fm-bg-primary",
    "--fm-bg-secondary",
    "--fm-bg-elevated",
    "--fm-text-primary",
    "--fm-text-secondary",
    "--fm-accent-primary",
    "--fm-accent-secondary",
    "--fm-accent-violet",
    "--fm-positive",
    "--fm-warning",
    "--fm-destructive",
    "--fm-border-subtle",
    "--fm-border-strong",
    "--fm-shadow-high",
  ]) assert.match(hud, new RegExp(token));

  assert.match(hud, /width:min\(312px,calc\(100vw - 24px\)\)/);
  assert.match(hud, /<svg class="brand-symbol"/);
  assert.match(hud, /Activity Guard/);
  for (const label of ["Normal", "Elevated", "Caution", "Paused", "Recovery"]) {
    assert.match(hud, new RegExp(`label: "${label}"`));
  }
  assert.match(hud, /role="progressbar"/);
  assert.match(hud, /aria-valuetext=/);
  assert.match(hud, /aria-live="polite"/);
  assert.match(hud, /aria-atomic="true"/);
  assert.match(hud, /aria-busy/);
  assert.match(hud, /:focus-visible/);
  assert.match(hud, /:active/);
  assert.match(hud, /prefers-reduced-motion:reduce/);
  assert.match(hud, /prefers-reduced-transparency:reduce/);
  assert.match(hud, /prefers-contrast:more/);
  assert.match(hud, /forced-colors:active/);
  assert.match(hud, /focusedCommand === "collapse" && compact/);
  assert.match(hud, /focusedCommand === "expand" && !compact/);
  assert.match(hud, /cycles completed · Total not set/);
  assert.doesNotMatch(hud, /\.hud::before/);
  assert.doesNotMatch(hud, />GrindPilot</);
  assert.doesNotMatch(hud, /text-shadow/);
  assert.doesNotMatch(hud, /font(?:-weight)?:\s*(?:550|580|650|680|720|750)\b/);
});

test("EA actions keep technical migration hooks while presenting FUT Magic controls", () => {
  assert.match(contextual, /fut-magic-contextual/);
  assert.match(contextual, /label: "Open safely"/);
  assert.match(contextual, /label: "Organize"/);
  assert.match(contextual, /label: "Open FUT Magic"/);
  assert.match(contextual, /safely with FUT Magic/);
  assert.match(contextual, /Organize with FUT Magic/);
  assert.match(contextual, /contextualIcons = Object\.freeze/);
  assert.match(contextual, /icon: "spark"/);
  assert.match(contextual, /icon: "route"/);
  assert.match(contextual, /icon: "brand"/);
  assert.match(contextual, /Organize · No items/);
  assert.match(contextual, /max-width:640px/);
  assert.match(contextual, /:focus-visible/);
  assert.match(contextual, /:active/);
  assert.match(contextual, /prefers-reduced-motion:reduce/);
  assert.match(contextual, /prefers-reduced-transparency:reduce/);
  assert.match(contextual, /prefers-contrast:more/);
  assert.match(contextual, /forced-colors:active/);
  assert.match(contextual, /aria-busy/);
  assert.doesNotMatch(contextual, /label: "GrindPilot/);
  assert.doesNotMatch(contextual, /text-shadow/);
  assert.doesNotMatch(contextual, /font(?:-weight)?:\s*(?:550|580|650|680|720|750)\b/);
});

test("isolated HUD and EA-page controls mirror canonical token fallbacks", () => {
  const canonical = tokenMap(canonicalTokens.split("@media")[0]);
  for (const [surface, source] of [["HUD", hud], ["EA actions", contextual]]) {
    for (const [name, value] of tokenMap(source)) {
      assert.equal(canonical.get(name), value, `${surface} fallback ${name} must match the canonical token`);
    }
  }
});
