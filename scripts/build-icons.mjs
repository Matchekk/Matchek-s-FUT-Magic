import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = {
  compact: await readFile(resolve(root, "icons", "fut-magic-small.svg"), "utf8"),
  standard: await readFile(resolve(root, "icons", "fut-magic-master.svg"), "utf8"),
};
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const source = size <= 32 ? sources.compact : sources.standard;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`);
    await page.screenshot({
      path: resolve(root, "icons", `icon${size}.png`),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}

console.log("Built FUT Magic icons at 16, 32, 48 and 128 pixels");
