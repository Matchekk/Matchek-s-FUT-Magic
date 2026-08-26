import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const archiveRoot = `fut-magic-${packageJson.version}`;
const storeOutput = join(root, "dist", `${archiveRoot}-cws.zip`);
const sourceOutput = join(root, "dist", `${archiveRoot}-source.zip`);
const releaseManifestOutput = join(root, "dist", `${archiveRoot}-release.json`);
const legacyOutput = join(root, "dist", `${archiveRoot}.zip`);
const sourceFolders = ["data", "docs", "icons", "LICENSES", "page", "scripts", "sidepanel", "solver", "src", "test"];
const sourceTopFiles = [
  "AGENTS.md", "background.js", "content-script.js", "manifest.json", "package.json",
  "package-lock.json", "tsconfig.json",
  "README.md", "CHANGELOG.md", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
];
const storeFolders = ["data", "LICENSES", "page", "sidepanel", "solver", "src/generated"];
const storeTopFiles = [
  "background.js", "content-script.js", "manifest.json", "LICENSE", "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md", "icons/icon16.png", "icons/icon32.png",
  "icons/icon48.png", "icons/icon128.png",
];
const excluded = /(^|\/)(?:sources|node_modules|dist|\.bug-hunter|\.git|\.github|output)(?:\/|$)|(?:^|\/)glpk\.(?:js|wasm)$/i;

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

const collectPaths = (topFiles, folders) => [
  ...topFiles.map((file) => join(root, file)),
  ...folders.flatMap((folder) => walk(join(root, folder))),
]
  .filter((path) => statSync(path).isFile())
  .filter((path) => !excluded.test(relative(root, path).replaceAll("\\", "/")))
  .sort((left, right) => relative(root, left).localeCompare(relative(root, right), "en"));

const sourcePaths = collectPaths(sourceTopFiles, sourceFolders);
const storePaths = collectPaths(storeTopFiles, storeFolders);

const requiredStoreEntries = [
  "manifest.json", "background.js", "content-script.js", "sidepanel/index.html",
  "sidepanel/app.js", "sidepanel/app.css", "src/generated/grindpilot-content-bundle.js",
  "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
  "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
];
const storeEntries = new Set(storePaths.map((path) => relative(root, path).replaceAll("\\", "/")));
for (const required of requiredStoreEntries) {
  if (!storeEntries.has(required)) throw new Error(`CWS package is missing ${required}`);
}
if ([...storeEntries].some((entry) => /(^|\/)(?:test|docs|scripts|node_modules|dist|output)(\/|$)/i.test(entry))) {
  throw new Error("CWS package contains a non-runtime directory");
}
if ([...storeEntries].some((entry) => /^icons\/(?!icon(?:16|32|48|128)\.png$)/i.test(entry))) {
  throw new Error("CWS package contains design-source or obsolete icon assets");
}
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
];
for (const path of sourcePaths) {
  if (!/\.(?:c?js|mjs|ts|tsx|json|md|html|css|svg|txt)$/i.test(path)) continue;
  const text = readFileSync(path, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`Possible credential in packaged source: ${relative(root, path)}`);
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
};
const u16 = (value) => { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; };
const u32 = (value) => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; };

const writeArchive = ({ paths, output, prefix = "" }) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const path of paths) {
    const entryPath = `${prefix}${relative(root, path).replaceAll("\\", "/")}`;
    const name = Buffer.from(entryPath, "utf8");
    const data = readFileSync(path);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(local, data);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(paths.length), u16(paths.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, Buffer.concat([...localParts, central, end]));
  console.log(`Packaged ${paths.length} files: ${relative(root, output)}`);
};

writeArchive({ paths: storePaths, output: storeOutput });
writeArchive({ paths: sourcePaths, output: sourceOutput, prefix: `${archiveRoot}/` });

rmSync(legacyOutput, { force: true });
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const releaseManifest = {
  schemaVersion: 1,
  product: "FUT Magic",
  version: packageJson.version,
  status: status.status === 0 && status.stdout.trim() === "" ? "release" : "candidate",
  sourceRevision: revision.status === 0 ? revision.stdout.trim() : null,
  workingTreeClean: status.status === 0 && status.stdout.trim() === "",
  dependencies: {
    runtime: packageJson.dependencies || {},
    development: packageJson.devDependencies || {},
    lockfileVersion: JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).lockfileVersion,
  },
  artifacts: [storeOutput, sourceOutput].map((path) => ({
    file: relative(join(root, "dist"), path).replaceAll("\\", "/"),
    sha256: sha256(path),
  })),
};
writeFileSync(releaseManifestOutput, `${JSON.stringify(releaseManifest, null, 2)}\n`);
console.log(`Wrote candidate provenance: ${relative(root, releaseManifestOutput)}`);
