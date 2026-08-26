import { createReadStream, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"],
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
const visualOutput = resolve(root, "output", "visual-review");
mkdirSync(visualOutput, { recursive: true });
const productShellFixture = JSON.parse(
  readFileSync(resolve(root, "test", "fixtures", "product-shell-view-model.json"), "utf8"),
);
const visualMatrix = JSON.parse(
  readFileSync(resolve(root, "test", "fixtures", "visual-regression-matrix.json"), "utf8"),
);
const fixtureProActions = productShellFixture.actions.filter((action) => action.plan === "pro");
if (!fixtureProActions.length || fixtureProActions.some((action) => action.enabled || action.command !== null)) {
  throw new Error("Visual fixture Pro affordances must remain disabled and command-free");
}

const settleMotion = (page) => page.locator("main .screen").evaluate((screen) =>
  Promise.all(screen.getAnimations().map((animation) => animation.finished)));

const assertNoHorizontalOverflow = async (page, label) => {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  if (metrics.content > metrics.viewport) {
    throw new Error(`${label} has horizontal overflow (${metrics.content}px > ${metrics.viewport}px)`);
  }
};

const assertMinimumTargets = async (locator, label, minimum = 40) => {
  const tooSmall = await locator.evaluateAll((elements, minimumSize) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < minimumSize || rect.height < minimumSize);
    })
    .map((element) => ({
      label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    })), minimum);
  if (tooSmall.length) throw new Error(`${label} has undersized controls: ${JSON.stringify(tooSmall)}`);
};

const assertLoadedBrandImages = async (page, label) => {
  const failures = await page.locator("img.brand-mark,img.brand-lockup-art").evaluateAll((images) => images
    .filter((image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)
    .map((image) => image.getAttribute("src")));
  if (failures.length) throw new Error(`${label} contains broken brand images: ${failures.join(", ")}`);
};

const assertBottomNavClearance = async (page, label) => {
  const metrics = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const screen = document.querySelector("main .screen");
    const nav = document.querySelector(".bottom-nav");
    const lastContent = screen?.lastElementChild;
    const shell = document.querySelector(".app-shell");
    const navRect = nav?.getBoundingClientRect();
    const contentRect = lastContent?.getBoundingClientRect();
    return {
      contentBottom: contentRect?.bottom ?? null,
      navTop: navRect?.top ?? null,
      navHeight: navRect?.height ?? null,
      shellPaddingBottom: shell ? Number.parseFloat(getComputedStyle(shell).paddingBottom) : null,
    };
  });
  if (metrics.contentBottom == null || metrics.navTop == null || metrics.navHeight == null ||
      metrics.contentBottom > metrics.navTop || metrics.shellPaddingBottom < metrics.navHeight + 12) {
    throw new Error(`${label} content can be obscured by bottom navigation: ${JSON.stringify(metrics)}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
};

const captureSidePanelDocument = async (page, path) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  const captureStyle = await page.addStyleTag({ content: `
    .app-header { position: static !important; }
    .bottom-nav { position: static !important; }
    .app-shell { padding: 0 !important; }
  ` });
  try {
    await page.screenshot({ path, fullPage: true });
  } finally {
    await captureStyle.evaluate((style) => style.remove());
  }
};

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/test/browser-harness.html`);
  await page.waitForFunction(() => Boolean(window.__grindPilotRuntime));
  const panel = page.locator("grindpilot-panel");
  await page.locator(".grindpilot-quick-open-native", { hasText: "Open safely" }).waitFor();
  await page.locator(".grindpilot-organize-native", { hasText: "Organize" }).waitFor();
  await page.locator(".fut-magic-open-panel-native", { hasText: "FUT Magic" }).waitFor();
  if (await panel.locator(".recycle-launcher,.quick-open-launcher").count()) {
    throw new Error("Quick actions must not remain as floating launchers");
  }
  const packActions = page.locator(".grindpilot-pack-action-row");
  if (await packActions.locator(":scope > button").count() !== 2) {
    throw new Error("Open and Open safely must share one two-button row");
  }
  const equalPackButtons = await packActions.locator(":scope > button").evaluateAll((buttons) =>
    buttons.length === 2 && buttons.every((button) => getComputedStyle(button).flexGrow === "1")
  );
  if (!equalPackButtons) throw new Error("Open and Open safely are not split 50/50");
  const organizeIsBesideMenu = await page.locator('.ea-more-menu[aria-label="More options"]').evaluate((menu) => {
    const contextualOpen = menu.previousElementSibling;
    return contextualOpen?.classList.contains("fut-magic-open-panel-native") === true
      && contextualOpen.previousElementSibling?.classList.contains("grindpilot-organize-native") === true;
  });
  if (!organizeIsBesideMenu) throw new Error("FUT Magic Organize is not beside the Items three-dot menu");
  const contextualBranding = await page.locator(".fut-magic-contextual").evaluateAll((buttons) => buttons.every((button) => {
    const style = getComputedStyle(button);
    const focusTarget = Number.parseFloat(style.minHeight);
    return style.textTransform === "none" && focusTarget >= 44 && style.boxShadow === "none";
  }));
  if (!contextualBranding) throw new Error("EA contextual actions do not use the compact 44px FUT Magic control treatment");
  for (const [selector, label] of [
    [".grindpilot-quick-open-native", "Open safely"],
    [".grindpilot-organize-native", "Organize"],
    [".fut-magic-open-panel-native", "Open FUT Magic"],
  ]) {
    const action = page.locator(selector);
    const accessibleName = await action.getAttribute("aria-label");
    if (await action.count() !== 1 || !accessibleName?.startsWith(label)) {
      throw new Error(`EA integration does not expose one labelled ${label} action`);
    }
  }
  await page.locator(".ut-store-pack-details-view").screenshot({
    path: resolve(visualOutput, "fut-magic-ea-pack-actions.png"),
  });
  await page.locator(".ut-unassigned-header").screenshot({
    path: resolve(visualOutput, "fut-magic-ea-duplicate-actions.png"),
  });
  const openFutMagic = page.locator(".fut-magic-open-panel-native");
  await openFutMagic.focus();
  const contextualFocus = await openFutMagic.evaluate((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      active: document.activeElement === button,
      height: rect.height,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  });
  if (!contextualFocus.active || contextualFocus.height < 44 ||
      contextualFocus.outlineWidth < 2 || contextualFocus.outlineStyle === "none") {
    throw new Error(`EA contextual focus treatment is insufficient: ${JSON.stringify(contextualFocus)}`);
  }
  if (await panel.locator(".launcher:visible").count()) {
    throw new Error("Legacy panel launcher must be hidden by default");
  }
  const hud = page.locator("fut-magic-run-hud");
  await hud.locator(".hud.hidden").waitFor({ state: "attached" });
  if (await hud.locator('section[aria-label="Active FUT Magic run"]:visible').count()) {
    throw new Error("Idle HUD must not claim an active run");
  }
  await page.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-idle-context.png"), fullPage: true });
  await page.evaluate(() => window.__grindPilotRuntime.panel.openSection("Workflows"));
  const legacyDialog = panel.getByRole("dialog", { name: /FUT Magic.*Workflows/i });
  await legacyDialog.waitFor();
  const legacyLabelsAssociated = await panel.locator(".content .field > label").evaluateAll((labels) => labels.every((label) => {
    if (label.querySelector("input,select,textarea")) return true;
    return Boolean(label.htmlFor && label.getRootNode().getElementById(label.htmlFor));
  }));
  if (!legacyLabelsAssociated) throw new Error("Legacy Tools contains a visible form label without an associated control");
  const legacyMode = panel.locator('[data-field="mode"]');
  await legacyMode.focus();
  await page.evaluate(() => window.__grindPilotRuntime.emit());
  const legacyFocusPersisted = await panel.evaluate((host) =>
    host.shadowRoot?.activeElement?.dataset.field === "mode");
  if (!legacyFocusPersisted) throw new Error("Legacy Tools lost keyboard focus during a runtime refresh");
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
  await contentPage.locator(".grindpilot-quick-open-native", { hasText: "Open safely" }).waitFor();
  if (contentErrors.length) throw new Error(`Content harness page errors: ${contentErrors.join(" | ")}`);

  await page.evaluate((state) => {
    const runtime = window.__grindPilotRuntime;
    Object.assign(runtime.state, structuredClone(state));
    runtime.emit();
  }, visualMatrix.hudStates.running);
  await page.evaluate(() => window.__grindPilotRuntime.panel.toggle(false));
  const visibleHud = hud.locator('section[aria-label="Active FUT Magic run"]');
  await visibleHud.waitFor();
  await visibleHud.getByText("Activity Guard", { exact: true }).waitFor();
  await visibleHud.getByText("Normal", { exact: true }).waitFor();
  const hudOpenPanel = visibleHud.getByRole("button", { name: "Open panel" });
  await hudOpenPanel.waitFor();
  const hudProgress = visibleHud.getByRole("progressbar", { name: "Run progress" });
  const hudProgressSemantics = await hudProgress.evaluate((progress) => ({
    now: progress.getAttribute("aria-valuenow"),
    max: progress.getAttribute("aria-valuemax"),
    text: progress.getAttribute("aria-valuetext"),
  }));
  if (hudProgressSemantics.now !== "4" || hudProgressSemantics.max !== "10" ||
      hudProgressSemantics.text !== "4 of 10 cycles") {
    throw new Error(`HUD progress semantics are incorrect: ${JSON.stringify(hudProgressSemantics)}`);
  }
  await assertMinimumTargets(visibleHud.locator("button"), "Expanded HUD", 44);
  await hudOpenPanel.focus();
  await page.evaluate(() => {
    const runtime = window.__grindPilotRuntime;
    runtime.state.iterations = 5;
    runtime.emit();
  });
  await visibleHud.getByText("5 / 10", { exact: true }).waitFor();
  const hudFocusPersisted = await hud.evaluate((host) => host.shadowRoot?.activeElement?.dataset.command === "open");
  if (!hudFocusPersisted) throw new Error("HUD focus did not persist across a live status update");
  await visibleHud.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-running.png") });
  await page.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-running-context.png"), fullPage: true });
  const hudMediaSession = await page.context().newCDPSession(page);
  await hudMediaSession.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
    ],
  });
  await visibleHud.locator(".bar").evaluate((bar) =>
    Promise.all(bar.getAnimations().map((animation) => animation.finished)));
  const reducedHud = await hud.evaluate((host) => {
    const surface = host.shadowRoot?.querySelector(".hud");
    const progress = host.shadowRoot?.querySelector('[role="progressbar"]');
    const bar = host.shadowRoot?.querySelector(".bar");
    const surfaceStyle = getComputedStyle(surface);
    const backgroundValues = surfaceStyle.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    return {
      motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
      backdropFilter: surfaceStyle.backdropFilter,
      backgroundAlpha: backgroundValues.length >= 4 ? backgroundValues[3] : 1,
      now: progress?.getAttribute("aria-valuenow"),
      text: progress?.getAttribute("aria-valuetext"),
      scaleX: bar ? new DOMMatrixReadOnly(getComputedStyle(bar).transform).a : null,
    };
  });
  if (!reducedHud.motion || !reducedHud.transparency || reducedHud.backdropFilter !== "none" ||
      reducedHud.backgroundAlpha < 1 || reducedHud.now !== "5" || reducedHud.text !== "5 of 10 cycles" ||
      Math.abs(reducedHud.scaleX - 0.5) > 0.001) {
    throw new Error(`Reduced-preference HUD is not opaque or progress-correct: ${JSON.stringify(reducedHud)}`);
  }
  await visibleHud.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-reduced-preferences.png") });
  await hudMediaSession.send("Emulation.setEmulatedMedia", { media: "screen", features: [] });
  await hud.getByRole("button", { name: "Collapse run HUD" }).click();
  await hud.getByRole("button", { name: "Expand run HUD" }).waitFor();
  const collapseFocusMoved = await hud.evaluate((host) => host.shadowRoot?.activeElement?.dataset.command === "expand");
  if (!collapseFocusMoved) throw new Error("HUD collapse did not move focus to the inverse expand control");
  await hud.locator(".hud.compact").screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-compact.png") });
  await hud.getByRole("button", { name: "Expand run HUD" }).click();
  await hud.getByRole("button", { name: "Collapse run HUD" }).waitFor();
  const expandFocusMoved = await hud.evaluate((host) => host.shadowRoot?.activeElement?.dataset.command === "collapse");
  if (!expandFocusMoved) throw new Error("HUD expand did not move focus to the inverse collapse control");
  await page.evaluate((state) => {
    const runtime = window.__grindPilotRuntime;
    Object.assign(runtime.state, structuredClone(state));
    runtime.emit();
  }, visualMatrix.hudStates.paused);
  await visibleHud.getByText("Paused", { exact: true }).waitFor();
  await visibleHud.getByRole("button", { name: "Resume" }).waitFor();
  await visibleHud.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-paused.png") });
  await page.evaluate((state) => {
    const runtime = window.__grindPilotRuntime;
    Object.assign(runtime.state, structuredClone(state));
    runtime.emit();
  }, visualMatrix.hudStates.intervention);
  await visibleHud.getByText("Recovery", { exact: true }).waitFor();
  await visibleHud.getByText(/could not verify the last action/i).waitFor();
  await visibleHud.screenshot({ path: resolve(visualOutput, "fut-magic-run-hud-intervention.png") });

  const sidePanelPage = await browser.newPage({ viewport: { width: 380, height: 820 } });
  const sidePanelErrors = [];
  sidePanelPage.on("pageerror", (error) => sidePanelErrors.push(error.message));
  await sidePanelPage.addInitScript(({ fixture, matrix }) => {
    let current = structuredClone(fixture);
    const compatibilityMode = new URLSearchParams(location.search).get("compatibility");
    const visualScenario = new URLSearchParams(location.search).get("scenario");
    if (visualScenario?.startsWith("run-")) {
      const runState = matrix.sidePanelRuns[visualScenario.slice(4)];
      if (runState) current.run = structuredClone(runState);
    }
    if (visualScenario === "unknown-progress") {
      current.projects[0].progress = null;
      current.activeProject.progress = null;
    }
    if (visualScenario === "empty-projects") {
      current.projects = [];
      current.activeProject = null;
    }
    if (compatibilityMode === "fc27" || compatibilityMode === "unknown") {
      const isFc27 = compatibilityMode === "fc27";
      current.context = {
        ...current.context,
        gameVersion: isFc27 ? "fc27" : "unknown",
        state: "unverified",
        challengeKind: "unknown",
        gameVersionObservation: isFc27 ? "observed" : "unverified",
        gameVersionSource: isFc27 ? "test_fixture" : "none",
        route: "/",
        evidence: null,
      };
      current.compatibility = isFc27 ? {
        gameVersion: "fc27",
        versionState: "observed",
        contextState: "unverified",
        planningState: "observe_only",
        gameLabel: "FC 27",
        title: "FC 27 detected",
        message: "The game version is observed. FC 27 planning rules are not verified in this build, so FUT Magic won’t run a plan.",
      } : {
        gameVersion: "unknown",
        versionState: "unknown",
        contextState: "unverified",
        planningState: "unavailable",
        gameLabel: "Unknown",
        title: "Game version not confirmed",
        message: "FUT Magic can’t verify which game version is open, so planning stays off.",
      };
      const disabledReason = isFc27
        ? "FC 27 planning is not verified in this build"
        : "Confirm the game version before planning";
      current.actions = current.actions.map((action) =>
        ["complete-sbc", "grind-upgrades", "clear-duplicates", "protect-cards"].includes(action.id)
          ? { ...action, enabled: false, disabledReason, command: null }
          : action);
    }
    const previewCards = [82, 82, 83, 83, 83, 84, 84, 84, 85, 85, 86].map((rating, index) => ({
      name: `Preview card ${index + 1}`,
      rating,
      location: index < 2 ? "sbc_storage" : "club",
      isSpecial: index === 10,
      isDuplicate: index < 3,
      isTradable: false,
    }));
    window.chrome = { runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.action === "COMMAND" && message.command?.type === "PREVIEW_SBC_PROJECT") {
          const preview = {
            id: "plan-preview-1",
            state: "ready",
            status: "ready",
            challengeName: "Marcelo · 88-Rated Squad",
            targetRating: 88,
            selectedCount: 11,
            cards: previewCards,
            ratingRange: { min: 82, max: 86 },
            specialCount: 1,
            duplicateCount: 3,
            storageCount: 2,
            protectedCount: 14,
            selectedProtectedCount: 0,
            explanations: [
              "Used duplicates before unique Club cards",
              "Preserved 90+ cards because hard protection is active",
            ],
            blockers: [],
            canApprove: true,
            approvalLabel: "Build & submit squad",
            notice: null,
          };
          current.projects[0].preview = preview;
          current.projects[0].planNotice = null;
          current.activeProject = structuredClone(current.projects[0]);
          current.revision += 1;
        }
        if (message.action === "COMMAND" && message.command?.type === "PREVIEW_CLEAR_DUPLICATES") {
          current.duplicateRoute = {
            id: "duplicate-route-preview-1",
            state: "ready",
            status: "ready",
            totalCount: 3,
            safeCount: 2,
            toClubCount: 1,
            toStorageCount: 1,
            attentionCount: 1,
            cards: [
              { name: "Alex Morgan", rating: 89, isSpecial: true, isTradable: false, action: "MOVE_TO_SBC_STORAGE", destination: "sbc_storage", reason: "Exact duplicate can move to SBC Storage" },
              { name: "Pedri", rating: 86, isSpecial: false, isTradable: false, action: "SEND_TO_CLUB", destination: "club", reason: "Unique card can move to Club" },
              { name: "Lauren James", rating: 87, isSpecial: false, isTradable: true, action: "SAFE_HOLD", destination: "unassigned", reason: "Tradable duplicate stays for your decision" },
            ],
            explanations: ["Only the listed moves to Club or SBC Storage can run."],
            blockers: [],
            canApprove: true,
            approvalLabel: "Move 2 safe items",
            notice: null,
          };
          current.routerRecommendation = {
            status: "ready",
            kind: "move_to_sbc_storage",
            title: "Move Alex Morgan to SBC Storage",
            reason: "This exact duplicate has a verified SBC Storage destination.",
            evidence: "Checked the complete bounded Unassigned snapshot, exact card-version identity, destination evidence, EA capabilities, and Activity Guard.",
            observedAt: 1787745600000,
            card: { name: "Alex Morgan", rating: 89, isSpecial: true, isTradable: false },
            destination: "sbc_storage",
            readOnly: true,
          };
          current.revision += 1;
        }
        if (message.action === "COMMAND" && message.command?.type === "PREVIEW_FODDER_REVIEW") {
          current.protection = {
            status: "unverified",
            observedAt: 1787745600000,
            verificationMessage: "Verified exclusions are shown, but EA did not expose every flag needed to prove the full count.",
            uniqueHardProtectedCount: 14,
            analyzedItemCount: 1275,
            reasonGroups: [
              { code: "reason-1", label: "Rating threshold", count: 9, examples: [{ name: "Alex Morgan", rating: 94, location: "club" }, { name: "Aitana Bonmatí", rating: 93, location: "sbc_storage" }] },
              { code: "reason-2", label: "Favourites", count: 4, examples: [{ name: "Pedri", rating: 89, location: "club" }] },
              { code: "reason-3", label: "Active squad", count: 3, examples: [{ name: "Lauren James", rating: 90, location: "club" }] }
            ],
            ratingReserves: [{ rating: 89, minimum: 2, observedCount: 6 }],
            specialReserves: [{ cardType: "totw", minimum: 2, observedCount: null }],
            projectSignals: [{ name: "Marcelo", hardExclusions: ["90+ cards"], conservationPreferences: ["Try to keep 2 × 89", "Try to keep 2 × TOTW"], unknownRequirementCount: 0 }],
            preferences: [{ id: "duplicates", label: "Duplicates", enabled: true }, { id: "sbc-storage", label: "Cards from SBC Storage", enabled: true }, { id: "untradeables", label: "Untradeable cards", enabled: true }],
            evidenceWarnings: ["Favourite-card evidence is unavailable for some current cards. Unknown cards are not described as safe fodder."],
            advancedActive: true
          };
          current.clubHealth.protectedCount = 14;
          current.revision += 1;
        }
        queueMicrotask(() => callback({ ok: true, data: structuredClone(current), requestId: message.requestId }));
      },
    } };
  }, { fixture: productShellFixture, matrix: visualMatrix });
  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html`);
  const waitForScreen = () => settleMotion(sidePanelPage);
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  await sidePanelPage.getByText("What do you want to do?").waitFor();
  if (await sidePanelPage.locator("header.app-header").count() !== 1 ||
      await sidePanelPage.locator('nav[aria-label="FUT Magic"]').count() !== 1 ||
      await sidePanelPage.locator("main").count() !== 1) {
    throw new Error("Side Panel does not expose one coherent header/main/navigation landmark set");
  }
  if (await sidePanelPage.locator(".compatibility-status").count()) {
    throw new Error("FC26 Side Panel unexpectedly renders a compatibility status row");
  }
  for (const name of ["Plan an Evolution", "Optimize my club"]) {
    const proAction = sidePanelPage.getByRole("button", { name: new RegExp(name, "i") });
    if (await proAction.count() !== 1 || !(await proAction.isDisabled())) {
      throw new Error(`${name} must remain visibly unavailable without a configured Pro capability`);
    }
  }
  if (await sidePanelPage.getByRole("button", { name: /^(?:upgrade|subscribe|purchase|sign in|billing|checkout)$|unlock pro/i }).count()) {
    throw new Error("Unconfigured account or commerce controls must not be fabricated in the public fixture");
  }
  await waitForScreen();
  await assertLoadedBrandImages(sidePanelPage, "Home");
  await assertBottomNavClearance(sidePanelPage, "Home");
  await assertNoHorizontalOverflow(sidePanelPage, "Normal-width Home");
  await assertMinimumTargets(sidePanelPage.locator(".action-row,.bottom-nav button,.focus-surface button"), "Home", 44);
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-home.png"));
  await sidePanelPage.locator(".action-list").screenshot({ path: resolve(visualOutput, "fut-magic-pro-unavailable.png") });
  await sidePanelPage.setViewportSize({ width: 520, height: 900 });
  await sidePanelPage.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await assertNoHorizontalOverflow(sidePanelPage, "Wide Home");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-home-wide.png"));
  await sidePanelPage.setViewportSize({ width: 380, height: 820 });
  await sidePanelPage.getByRole("button", { name: /Projects/ }).last().click();
  await sidePanelPage.getByRole("heading", { name: "Projects" }).waitFor();
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-projects.png"));
  const marceloProject = sidePanelPage.getByRole("button", { name: /Marcelo/ });
  await marceloProject.focus();
  await marceloProject.click();
  const marceloHeading = sidePanelPage.getByRole("heading", { name: "Marcelo" });
  await marceloHeading.waitFor();
  if (!(await marceloHeading.evaluate((heading) => document.activeElement === heading))) {
    throw new Error("Project detail heading did not receive focus after navigation");
  }
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-project-detail.png"));
  await sidePanelPage.locator(".back-button").click();
  await sidePanelPage.getByRole("heading", { name: "Projects" }).waitFor();
  const restoredProject = sidePanelPage.getByRole("button", { name: /Marcelo/ });
  await sidePanelPage.waitForFunction(() => document.activeElement?.classList.contains("project-row"));
  if (!(await restoredProject.evaluate((button) => document.activeElement === button))) {
    throw new Error("Project list focus was not restored to Marcelo after Back");
  }
  await restoredProject.click();
  await sidePanelPage.getByRole("heading", { name: "Marcelo" }).waitFor();
  await sidePanelPage.getByRole("button", { name: "Preview current squad" }).click();
  await sidePanelPage.getByRole("heading", { name: "Ready to build" }).waitFor();
  await sidePanelPage.getByText("No cards changed").waitFor();
  if (await sidePanelPage.getByRole("button", { name: "Build & submit squad" }).count() !== 1) {
    throw new Error("SBC preview does not expose one explicit approval action");
  }
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-sbc-preview.png"));
  await sidePanelPage.getByRole("button", { name: /^Club$/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Club" }).waitFor();
  await waitForScreen();
  await assertNoHorizontalOverflow(sidePanelPage, "Club");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-club.png"));
  await sidePanelPage.getByRole("button", { name: /^Home$/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  await sidePanelPage.getByRole("button", { name: /Clear duplicates/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Club" }).waitFor();
  await sidePanelPage.getByRole("heading", { name: "Ready to move" }).waitFor();
  await sidePanelPage.getByRole("button", { name: "Move 2 safe items" }).waitFor();
  await sidePanelPage.getByText("Stays Unassigned").waitFor();
  await sidePanelPage.getByRole("heading", { name: "Move Alex Morgan to SBC Storage" }).waitFor();
  await sidePanelPage.getByText("Priority within this batch").waitFor();
  await sidePanelPage.getByText(/Already included in the 2-item approval above/).waitFor();
  await sidePanelPage.getByText("Verified suggestion").waitFor();
  if (await sidePanelPage.getByRole("button", { name: /Move Alex Morgan/i }).count()) {
    throw new Error("Read-only Router recommendation exposes an execution control");
  }
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-duplicate-route-preview.png"));
  await sidePanelPage.setViewportSize({ width: 600, height: 900 });
  await sidePanelPage.evaluate(() => { document.body.style.zoom = "2"; });
  const routerZoomFits = await sidePanelPage.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!routerZoomFits) throw new Error("Router recommendation has horizontal overflow at 200% zoom");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-router-200-percent.png"));
  await sidePanelPage.evaluate(() => { document.body.style.zoom = ""; });
  await sidePanelPage.setViewportSize({ width: 380, height: 820 });
  await sidePanelPage.getByRole("button", { name: /^Home$/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  await sidePanelPage.getByRole("button", { name: /Protect my cards/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Card protection" }).waitFor();
  await sidePanelPage.getByRole("heading", { name: "Never use" }).waitFor();
  await sidePanelPage.getByRole("heading", { name: "Try to keep" }).waitFor();
  await sidePanelPage.getByText(/At least 14 exclusions verified/).waitFor();
  if (await sidePanelPage.getByRole("button", { name: /Save protection|Approve|Optimize/i }).count()) {
    throw new Error("Read-only Card protection review exposes an execution control");
  }
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-card-protection-review.png"));
  await sidePanelPage.setViewportSize({ width: 600, height: 900 });
  await sidePanelPage.evaluate(() => { document.body.style.zoom = "2"; });
  const protectionZoomFits = await sidePanelPage.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!protectionZoomFits) throw new Error("Card protection has horizontal overflow at 200% zoom");
  await sidePanelPage.evaluate(() => { document.body.style.zoom = ""; });
  await sidePanelPage.setViewportSize({ width: 380, height: 820 });
  await sidePanelPage.getByRole("button", { name: /More/ }).last().click();
  await sidePanelPage.getByRole("heading", { name: "More" }).waitFor();
  await sidePanelPage.getByRole("button", { name: /Legacy tools/i }).waitFor();
  for (const name of ["Source", "License", "Privacy", "Third-party notices"]) {
    if (await sidePanelPage.getByRole("link", { name, exact: true }).count() !== 1) {
      throw new Error(`About does not expose the ${name} legal link`);
    }
  }
  if (await sidePanelPage.getByRole("button", { name: /sign in|continue with|manage subscription/i }).count()) {
    throw new Error("More fabricates account controls while the account provider is not configured");
  }
  await sidePanelPage.getByText(/No warranty/).waitFor();
  await waitForScreen();
  await assertLoadedBrandImages(sidePanelPage, "More");
  await assertBottomNavClearance(sidePanelPage, "More");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-more.png"));
  await sidePanelPage.locator(".about").screenshot({ path: resolve(visualOutput, "fut-magic-about.png") });
  await sidePanelPage.setViewportSize({ width: 600, height: 900 });
  await sidePanelPage.evaluate(() => { document.body.style.zoom = "2"; });
  const zoomFits = await sidePanelPage.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!zoomFits) throw new Error("Side Panel has horizontal overflow at 200% zoom and 600px width");
  const lastAboutLink = sidePanelPage.getByRole("link", { name: "Third-party notices", exact: true });
  await lastAboutLink.focus();
  const lastFocusableClear = await lastAboutLink.evaluate((link) => {
    const nav = document.querySelector(".bottom-nav");
    const linkRect = link.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      active: document.activeElement === link,
      linkBottom: Math.round(linkRect.bottom),
      navTop: Math.round(navRect.top),
      clear: linkRect.bottom <= navRect.top,
    };
  });
  if (!lastFocusableClear.active || !lastFocusableClear.clear) {
    throw new Error(`Last focusable About link is obscured by bottom navigation at 200%: ${JSON.stringify(lastFocusableClear)}`);
  }
  await sidePanelPage.evaluate(() => { document.body.style.zoom = ""; });
  await sidePanelPage.setViewportSize({ width: 300, height: 700 });
  const homeNav = sidePanelPage.getByRole("button", { name: /^Home$/ });
  await homeNav.focus();
  await sidePanelPage.keyboard.press("Enter");
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  await waitForScreen();
  const widthFits = await sidePanelPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!widthFits) throw new Error("Side Panel has horizontal overflow at its declared 300px minimum");
  await sidePanelPage.keyboard.press("Tab");
  const keyboardFocusVisible = await sidePanelPage.evaluate(() => document.activeElement !== document.body);
  if (!keyboardFocusVisible) throw new Error("Keyboard focus left the Side Panel controls");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-home-300px-keyboard.png"));

  await sidePanelPage.setViewportSize({ width: 380, height: 820 });
  for (const [scenario, expectedGuard] of [["normal", "Normal"], ["elevated", "Elevated"], ["paused", "Paused"]]) {
    await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?scenario=run-${scenario}`);
    await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
    await sidePanelPage.getByText("Active run", { exact: true }).waitFor();
    await sidePanelPage.getByText("Activity Guard", { exact: true }).waitFor();
    await sidePanelPage.getByText(expectedGuard, { exact: true }).waitFor();
    if (scenario === "paused") {
      await sidePanelPage.getByRole("button", { name: "Resume" }).waitFor();
      await sidePanelPage.getByText(/Nothing else was submitted/).waitFor();
    } else {
      await sidePanelPage.getByRole("button", { name: "Pause" }).waitFor();
    }
    await waitForScreen();
    await assertNoHorizontalOverflow(sidePanelPage, `Activity Guard ${expectedGuard}`);
    await assertMinimumTargets(sidePanelPage.locator(".focus-surface button,.bottom-nav button"), `Activity Guard ${expectedGuard}`, 44);
    await sidePanelPage.screenshot({
      path: resolve(visualOutput, `fut-magic-activity-guard-${scenario}.png`),
    });
  }

  const mediaSession = await sidePanelPage.context().newCDPSession(sidePanelPage);
  await mediaSession.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
      { name: "prefers-contrast", value: "more" },
    ],
  });
  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?scenario=run-normal`);
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  const reducedRunProgress = sidePanelPage.getByRole("progressbar", { name: "Run progress" });
  await reducedRunProgress.locator("span").evaluate((bar) =>
    Promise.all(bar.getAnimations().map((animation) => animation.finished)));
  const reducedPreferences = await sidePanelPage.evaluate(() => {
    const screen = document.querySelector("main .screen");
    const header = document.querySelector("header.app-header");
    const progress = document.querySelector('[role="progressbar"][aria-label="Run progress"]');
    const progressBar = progress?.querySelector("span");
    const style = getComputedStyle(screen);
    const headerStyle = getComputedStyle(header);
    const matrix = progressBar ? new DOMMatrixReadOnly(getComputedStyle(progressBar).transform) : null;
    const backgroundAlpha = (() => {
      const values = headerStyle.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
      return values.length >= 4 ? values[3] : 1;
    })();
    return {
      motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
      contrast: matchMedia("(prefers-contrast: more)").matches,
      animationDurationMs: Math.max(...style.animationDuration.split(",").map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1000))),
      backdropFilter: headerStyle.backdropFilter,
      backgroundAlpha,
      progressNow: progress?.getAttribute("aria-valuenow"),
      progressText: progress?.getAttribute("aria-valuetext"),
      progressScaleX: matrix?.a ?? null,
    };
  });
  if (!reducedPreferences.motion || !reducedPreferences.transparency || !reducedPreferences.contrast) {
    throw new Error(`Reduced preference emulation failed: ${JSON.stringify(reducedPreferences)}`);
  }
  if (reducedPreferences.animationDurationMs > 120.1) {
    throw new Error(`Reduced-motion screen animation is too long: ${reducedPreferences.animationDurationMs}ms`);
  }
  if (reducedPreferences.backdropFilter !== "none" || reducedPreferences.backgroundAlpha < 1) {
    throw new Error(`Reduced-transparency header is not opaque and blur-free: ${JSON.stringify(reducedPreferences)}`);
  }
  if (reducedPreferences.progressNow !== "40" || reducedPreferences.progressText !== "40%" ||
      Math.abs(reducedPreferences.progressScaleX - 0.4) > 0.001) {
    throw new Error(`Reduced-motion progress lost numerical or visual meaning: ${JSON.stringify(reducedPreferences)}`);
  }
  await assertNoHorizontalOverflow(sidePanelPage, "Reduced-preference Home");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-home-reduced-preferences.png"));
  await mediaSession.send("Emulation.setEmulatedMedia", { media: "screen", features: [] });

  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?scenario=unknown-progress`);
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  const unknownProgress = sidePanelPage.getByRole("progressbar", { name: "Marcelo progress" });
  const unknownProgressSemantics = await unknownProgress.evaluate((progress) => ({
    now: progress.getAttribute("aria-valuenow"),
    text: progress.getAttribute("aria-valuetext"),
  }));
  if (unknownProgressSemantics.now !== null || unknownProgressSemantics.text !== "Progress unavailable") {
    throw new Error(`Unknown project progress is presented as a measured value: ${JSON.stringify(unknownProgressSemantics)}`);
  }
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-project-progress-unknown.png"));

  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?scenario=empty-projects`);
  await sidePanelPage.getByRole("heading", { name: "Home" }).waitFor();
  await sidePanelPage.getByRole("button", { name: /^Projects$/ }).click();
  await sidePanelPage.getByRole("heading", { name: "No active projects" }).waitFor();
  await sidePanelPage.getByText(/Open an SBC set in EA/).waitFor();
  await waitForScreen();
  await assertLoadedBrandImages(sidePanelPage, "Projects empty state");
  await assertBottomNavClearance(sidePanelPage, "Projects empty state");
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-projects-empty.png"));

  await sidePanelPage.setViewportSize({ width: 380, height: 820 });
  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?compatibility=fc27`);
  await sidePanelPage.getByRole("heading", { name: "FC 27 detected" }).waitFor();
  await sidePanelPage.getByText("FC 27 · Observe only", { exact: true }).waitFor();
  await sidePanelPage.getByText(/FC 27 planning rules are not verified/).waitFor();
  await sidePanelPage.getByText(/EA connected/i).waitFor();
  if (await sidePanelPage.locator(".compatibility-status button").count()) {
    throw new Error("Compatibility status exposes an action");
  }
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-compatibility-fc27.png"));
  await sidePanelPage.getByRole("button", { name: "View project" }).click();
  await sidePanelPage.getByRole("heading", { name: "Projects" }).waitFor();
  await sidePanelPage.getByRole("button", { name: /Marcelo/ }).click();
  await sidePanelPage.getByRole("heading", { name: "Planning unavailable" }).waitFor();
  if (await sidePanelPage.getByRole("button", { name: /Preview current squad|Preview again|Build & submit squad/ }).count()) {
    throw new Error("FC27 project detail exposes a planning action");
  }
  if (!(await sidePanelPage.getByRole("button", { name: "Open project tools" }).isDisabled())) {
    throw new Error("FC27 project detail exposes classic project tools");
  }
  await sidePanelPage.evaluate(() => window.scrollTo(0, 0));
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-compatibility-fc27-project.png"));
  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?compatibility=fc27`);
  await sidePanelPage.getByRole("heading", { name: "FC 27 detected" }).waitFor();
  await sidePanelPage.setViewportSize({ width: 600, height: 900 });
  await sidePanelPage.evaluate(() => { document.body.style.zoom = "2"; });
  const compatibilityZoomFits = await sidePanelPage.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!compatibilityZoomFits) throw new Error("Compatibility status has horizontal overflow at 200% zoom");
  await sidePanelPage.evaluate(() => { document.body.style.zoom = ""; });

  await sidePanelPage.setViewportSize({ width: 300, height: 700 });
  await sidePanelPage.goto(`http://127.0.0.1:${port}/sidepanel/index.html?compatibility=unknown`);
  await sidePanelPage.getByRole("heading", { name: "Game version not confirmed" }).waitFor();
  await sidePanelPage.getByText("Unknown · Planning off", { exact: true }).waitFor();
  const unknownWidthFits = await sidePanelPage.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  if (!unknownWidthFits) throw new Error("Unknown-version compatibility status overflows at 300px");
  await waitForScreen();
  await captureSidePanelDocument(sidePanelPage, resolve(visualOutput, "fut-magic-compatibility-unknown.png"));
  if (sidePanelErrors.length) throw new Error(`Side Panel page errors: ${sidePanelErrors.join(" | ")}`);
  console.log("Browser integration harness passed");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
