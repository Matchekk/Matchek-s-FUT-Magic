import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const changelog = JSON.parse(
  readFileSync(join(root, "data", "changelog.json"), "utf8"),
);
const errors = [];
const projectUrl = "https://github.com/Matchekk/Matchek-s-FUT-Magic";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

for (const file of walk(root).filter(
  (path) =>
    path.endsWith(".js") &&
    !path.includes(`${join(root, "sources")}`) &&
    !path.endsWith("glpk.js"),
)) {
  const check = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (check.status !== 0) {
    errors.push(`${relative(root, file)}: ${check.stderr || check.stdout}`);
  }
}

const referenced = new Set([
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => [
    ...(entry.js || []),
    ...(entry.css || []),
  ]),
  ...(manifest.web_accessible_resources || []).flatMap(
    (entry) => entry.resources || [],
  ),
]);
const releaseFiles = walk(root).map((path) => relative(root, path).replaceAll("\\", "/"));
const wildcardRegex = (pattern) => new RegExp(
  `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
);
for (const path of referenced) {
  if (!path) continue;
  const exists = path.includes("*")
    ? releaseFiles.some((file) => wildcardRegex(path).test(file))
    : existsSync(join(root, path));
  if (!exists) errors.push(`Missing manifest asset: ${path}`);
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const [declaredSize, path] of Object.entries(manifest.icons || {})) {
  if (!path || !existsSync(join(root, path))) continue;
  const png = readFileSync(join(root, path));
  if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
    errors.push(`Manifest icon is not a valid PNG: ${path}`);
    continue;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const expected = Number(declaredSize);
  if (width !== expected || height !== expected) {
    errors.push(
      `Manifest icon ${path} must be ${expected}x${expected}, got ${width}x${height}`,
    );
  }
}

for (const entry of manifest.content_scripts || []) {
  if (entry.all_frames) errors.push("content_scripts must remain top-frame only");
  if (entry.match_about_blank) errors.push("match_about_blank must remain disabled");
}
for (const entry of manifest.web_accessible_resources || []) {
  if ((entry.matches || []).includes("<all_urls>")) {
    errors.push("web_accessible_resources must not use <all_urls>");
  }
  if ((entry.resources || []).some((path) => /glpk|solver\/worker/.test(path))) {
    errors.push("unused solver binaries/workers must not be web-accessible");
  }
  if (
    JSON.stringify(entry.matches || []) !==
    JSON.stringify(["https://www.ea.com/*"])
  ) {
    errors.push("web-accessible resources must remain limited to the EA origin");
  }
  if (entry.use_dynamic_url !== true) {
    errors.push("web-accessible resources must use per-session dynamic URLs");
  }
}

if (JSON.stringify(manifest.permissions || []) !== JSON.stringify(["storage", "scripting"])) {
  errors.push("permissions must remain limited to storage and scripting");
}
if (
  JSON.stringify(manifest.host_permissions || []) !==
  JSON.stringify(["https://www.fut.gg/*"])
) {
  errors.push("host_permissions must remain limited to FUT.GG");
}
if (changelog.releases?.[0]?.version !== manifest.version) {
  errors.push("manifest version must match the newest changelog release");
}

const pageSource = readFileSync(join(root, "page", "ea-data-bridge.js"), "utf8");
if (!pageSource.includes(`href="${projectUrl}"`)) {
  errors.push("settings source-code link must point to this derivative repository");
}

for (const requiredFile of ["LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"]) {
  if (!existsSync(join(root, requiredFile))) errors.push(`Missing required notice: ${requiredFile}`);
}

const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
if (tracked.status === 0) {
  const forbidden = tracked.stdout
    .split(/\r?\n/)
    .filter((path) => /(^|\/)(sources\/|glpk\.(?:js|wasm)$)/i.test(path));
  if (forbidden.length) {
    errors.push(`Forbidden tracked release artifacts: ${forbidden.join(", ")}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Verified ${manifest.name} ${manifest.version}`);
