import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "src/generated/grindpilot-content-bundle.js");
const sidePanelOutput = resolve(root, "sidepanel/app.js");

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/grindpilot-main.js")],
  outfile: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  charset: "utf8",
  legalComments: "none",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
});

console.log("Built src/generated/grindpilot-content-bundle.js");

await mkdir(dirname(sidePanelOutput), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/sidepanel/main.tsx")],
  outfile: sidePanelOutput,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  charset: "utf8",
  legalComments: "eof",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
});

console.log("Built sidepanel/app.js and sidepanel/app.css");
