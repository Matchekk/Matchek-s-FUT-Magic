import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
]);

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": mime.get(extname(file)) || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/test/browser-harness.html`);
  await page.waitForFunction(() => Boolean(window.__grindPilotRuntime));
  const panel = page.locator("grindpilot-panel");
  await page.locator(".grindpilot-quick-open-native", { hasText: "Quick Open" }).waitFor();
  await page.locator(".grindpilot-organize-native", { hasText: "Organize" }).waitFor();
  if (await panel.locator(".recycle-launcher,.quick-open-launcher").count()) {
    throw new Error("Quick actions must not remain as floating launchers");
  }
  const packActions = page.locator(".grindpilot-pack-action-row");
  if (await packActions.locator(":scope > button").count() !== 2) {
    throw new Error("Open and Quick Open must share one two-button row");
  }
  const equalPackButtons = await packActions.locator(":scope > button").evaluateAll((buttons) =>
    buttons.length === 2 && buttons.every((button) => getComputedStyle(button).flexGrow === "1")
  );
  if (!equalPackButtons) throw new Error("Open and Quick Open are not split 50/50");
  const organizeIsBesideMenu = await page.locator(".ea-more-menu:not(.grindpilot-organize-native)").evaluate((menu) =>
    menu.previousElementSibling?.classList.contains("grindpilot-organize-native") === true
  );
  if (!organizeIsBesideMenu) throw new Error("Organize is not beside the Items three-dot menu");
  await panel.locator(".launcher").click();
  await panel.locator('[data-section="Workflows"]').click();
  await panel.locator("[data-template-select]").selectOption("TARGET_SBC_GRIND");
  await panel.locator('[data-action="apply-template"]').click();
  await panel.locator('[data-section="Target Projects"]').click();
  await panel.locator('[data-action="import-current-sbc"]').waitFor();
  await panel.locator('[data-section="Developer"]').click();
  await panel.locator('[data-action="refresh"]').click();
  await panel.locator(".health").first().waitFor();
  if (errors.length) throw new Error(`Browser harness page errors: ${errors.join(" | ")}`);

  const contentPage = await browser.newPage();
  const contentErrors = [];
  contentPage.on("pageerror", (error) => contentErrors.push(error.message));
  await contentPage.goto(`http://127.0.0.1:${port}/test/content-script-harness.html`);
  await contentPage.waitForFunction(() => Boolean(window.__grindPilotRuntime));
  const contentPanel = contentPage.locator("grindpilot-panel");
  await contentPanel.waitFor({ state: "attached" });
  await contentPage.locator(".grindpilot-organize-native", { hasText: "Organize" }).waitFor();
  await contentPage.locator(".grindpilot-quick-open-native", { hasText: "Quick Open" }).waitFor();
  if (contentErrors.length) throw new Error(`Content harness page errors: ${contentErrors.join(" | ")}`);
  console.log("Browser integration harness passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
