import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const output = join(root, "output", "visual-review");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = normalize(join(root, path === "/" ? "test/ea-native-workspace-harness.html" : path.slice(1)));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error("Not found");
    response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await mkdir(output, { recursive: true });
  await page.goto(`http://127.0.0.1:${port}/test/ea-native-workspace-harness.html`);
  await page.waitForFunction(() => window.__nativeHarnessReady === true);
  const tile = page.locator("[data-fut-magic-home-tile]");
  await tile.waitFor({ timeout: 5000 }).catch(async (error) => {
    throw new Error(
      `${error.message}\npageErrors=${JSON.stringify(pageErrors)}\nconsoleErrors=${JSON.stringify(consoleErrors)}\nworkspace=${await page.evaluate(() => ({ installed: globalThis.__futMagicEaWorkspaceInstalled, api: Boolean(globalThis.FutMagicEaWorkspace), body: document.body.innerText }))}`,
    );
  });
  assert.equal(await tile.count(), 1, "home hub should contain one FUT Magic entry");
  assert.match(await tile.innerText(), /FUT MAGIC[\s\S]*Protected grind plans/);
  await page.screenshot({ path: join(output, "fut-magic-ea-native-home-entry.png"), fullPage: true });

  await tile.focus();
  assert.equal(await tile.evaluate((node) => node.matches(":focus-visible")), true);
  await tile.click();
  const workspace = page.locator(".fut-magic-ea-workspace");
  const planner = workspace.locator(".ea-data-overlay-shell--sequence");
  await planner.waitFor();
  assert.equal(await page.locator("#native-title").innerText(), "FUT Magic");
  assert.equal(await planner.getAttribute("data-presentation"), "native");
  assert.equal(await planner.getAttribute("role"), "region");
  assert.equal(await planner.getAttribute("aria-modal"), null);
  assert.equal(await planner.evaluate((node) => getComputedStyle(node).position), "static");
  assert.equal(await page.locator("[data-fut-magic-home-tile]").count(), 0);
  assert.equal(await page.locator(".ea-data-sequence-modal").count(), 1);
  assert.equal(
    await page.locator("#ea-data-sequence-title").evaluate((node) => document.activeElement === node),
    true,
    "native workspace should focus its title after navigation",
  );
  assert.equal(await page.locator("#ea-data-sequence-start-btn").isDisabled(), true);
  assert.equal(await page.locator("#ea-data-sequence-start-btn").innerText(), "Planning only");
  await page.screenshot({ path: join(output, "fut-magic-ea-native-workspace.png"), fullPage: true });

  for (const viewport of [
    { name: "normal", width: 1024, height: 820 },
    { name: "narrow", width: 720, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      `${viewport.name} workspace must not overflow horizontally`,
    );
    await page.screenshot({
      path: join(output, `fut-magic-ea-native-workspace-${viewport.name}.png`),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await tile.waitFor();
  assert.equal(await page.locator("#native-title").innerText(), "Home");
  await page.waitForFunction(() => document.activeElement?.matches?.("[data-fut-magic-home-tile]"));
  assert.deepEqual(pageErrors, []);
  console.log("EA-native workspace browser test passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
