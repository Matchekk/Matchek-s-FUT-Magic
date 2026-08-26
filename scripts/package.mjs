import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const archiveRoot = `grindpilot-fc26-${packageJson.version}`;
const output = join(root, "dist", `${archiveRoot}.zip`);
const folders = ["data", "docs", "icons", "page", "solver", "src"];
const topFiles = [
  "background.js", "content-script.js", "manifest.json", "package.json",
  "README.md", "CHANGELOG.md", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
];
const excluded = /(^|\/)(?:test|sources|node_modules|dist|\.bug-hunter|\.git|\.github|output)(?:\/|$)|(?:^|\/)glpk\.(?:js|wasm)$/i;

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

const paths = [
  ...topFiles.map((file) => join(root, file)),
  ...folders.flatMap((folder) => walk(join(root, folder))),
]
  .filter((path) => statSync(path).isFile())
  .filter((path) => !excluded.test(relative(root, path).replaceAll("\\", "/")))
  .sort((left, right) => relative(root, left).localeCompare(relative(root, right), "en"));

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

const localParts = [];
const centralParts = [];
let offset = 0;
for (const path of paths) {
  const name = Buffer.from(`${archiveRoot}/${relative(root, path).replaceAll("\\", "/")}`, "utf8");
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
