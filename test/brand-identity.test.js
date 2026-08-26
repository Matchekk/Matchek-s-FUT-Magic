import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path, encoding = "utf8") => readFileSync(new URL(`../${path}`, import.meta.url), encoding);

test("canonical FUT Magic tokens cover every production design role", () => {
  const tokens = read("src/brand/tokens.css");
  for (const token of [
    "--fm-bg-primary", "--fm-bg-secondary", "--fm-bg-elevated",
    "--fm-text-primary", "--fm-text-secondary", "--fm-text-muted", "--fm-text-pro",
    "--fm-accent-primary", "--fm-accent-secondary", "--fm-accent-violet",
    "--fm-positive", "--fm-warning", "--fm-destructive",
    "--fm-border-subtle", "--fm-border-strong", "--fm-focus-ring",
    "--fm-shadow-low", "--fm-shadow-high", "--fm-control-min-size",
    "--fm-motion-fast", "--fm-layer-hud",
  ]) {
    assert.match(tokens, new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`));
  }
  assert.match(tokens, /prefers-reduced-motion:\s*reduce/);
  assert.match(tokens, /prefers-reduced-transparency:\s*reduce/);
  assert.match(tokens, /prefers-contrast:\s*more/);
});

test("production marks are original scalable geometry with a compact small-size source", () => {
  const paths = [
    "icons/fut-magic-master.svg",
    "icons/fut-magic-small.svg",
    "icons/brand/fut-magic-symbol.svg",
    "icons/brand/fut-magic-wordmark.svg",
    "icons/brand/fut-magic-lockup.svg",
    "icons/brand/fut-magic-monochrome.svg",
  ];
  for (const path of paths) {
    const svg = read(path);
    assert.match(svg, /^<svg[\s>]/);
    assert.doesNotMatch(svg, /<(?:image|foreignObject)\b|data:image|(?:href|src)=["']https?:\/\//i);
    assert.doesNotMatch(svg, /\b(?:Electronic Arts|EA SPORTS|Ultimate Team|FUTBIN|FUT\.GG|Apple)\b/i);
  }
  assert.notEqual(read("icons/fut-magic-master.svg"), read("icons/fut-magic-small.svg"));
});

test("manifest and project introduction use the approved customer-facing brand", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "FUT Magic");
  assert.equal(manifest.action.default_title, "FUT Magic");
  assert.match(manifest.description, /^Smarter plans\. Better results\./);
  assert.match(read("README.md"), /^# FUT Magic\r?\n\r?\n> \*\*Smarter plans\. Better results\.\*\*/);
});

test("Advanced legacy tools expose a branded keyboard-safe dialog boundary", () => {
  const source = read("src/ui/grind-panel.js");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="legacy-panel-brand legacy-panel-section"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /Move step up/);
  assert.match(source, /associateLegacyLabels\(content\)/);
  assert.match(source, /previousFocusIndex/);
  assert.match(source, /data-import-profile-trigger/);
  assert.match(source, /Latest redacted diagnostic snapshot/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /prefers-reduced-transparency:reduce/);
  assert.match(source, /prefers-contrast:more/);
  assert.match(source, /forced-colors:active/);
});

test("Side Panel keeps keyboard wayfinding and avoids duplicate error announcements", () => {
  const view = read("src/sidepanel/main.tsx");
  const styles = read("src/sidepanel/styles.css");
  assert.match(view, /role="alert"/);
  assert.match(view, /aria-live="polite" aria-atomic="true">\{busy \? "Updating FUT Magic" : ""\}/);
  assert.match(view, /role="status" aria-atomic="true"/);
  assert.match(styles, /h1:focus-visible/);
  assert.match(styles, /forced-colors:\s*active/);
});

test("all declared app icons are exact PNG dimensions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = read(path, null);
    assert.equal(png.subarray(0, 8).equals(signature), true);
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});
