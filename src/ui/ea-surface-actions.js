const normalizeText = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();

const isIdleStatus = (status) =>
  ["idle", "completed", "stopped", "failed"].includes(String(status || "idle"));

const surfaceCss = `
.grindpilot-pack-action-row{display:flex!important;align-items:stretch!important;gap:8px!important}
.grindpilot-pack-action-row>.grindpilot-native-open-peer,
.grindpilot-pack-action-row>.grindpilot-quick-open-native{flex:1 1 0!important;width:auto!important;min-width:0!important;margin-left:0!important;margin-right:0!important}
.grindpilot-quick-open-native,.grindpilot-organize-native{cursor:pointer}
.grindpilot-quick-open-native:disabled,.grindpilot-organize-native:disabled{cursor:not-allowed!important;opacity:.45!important}
.grindpilot-organize-native{width:auto!important;min-width:92px!important;padding-left:14px!important;padding-right:14px!important;margin-left:auto!important;margin-right:8px!important;white-space:nowrap!important}
`;

const createNativePeer = (peer, { className, label, title }) => {
  const button = (peer?.ownerDocument || document).createElement("button");
  button.type = "button";
  button.className = `${peer?.className || ""} ${className}`.trim();
  button.textContent = label;
  button.setAttribute("aria-label", label);
  button.title = title;
  return button;
};

const findPackCard = (openButton) => {
  const preferred = openButton.closest?.([
    ".ut-store-pack-details-view",
    ".ut-store-pack-item-view",
    ".ut-pack-item-view",
    "[data-pack-id]",
    "li",
  ].join(","));
  if (preferred && !preferred.closest("grindpilot-panel")) return preferred;

  let current = openButton.parentElement;
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    if (current.closest?.("grindpilot-panel")) return null;
    const hasTitle = current.querySelector?.("h1,h2,h3,h4,[class*='pack'][class*='name']");
    const hasPackVisual = current.querySelector?.("img,[class*='pack'][class*='image']");
    if (hasTitle && hasPackVisual) return current;
  }
  return null;
};

const readPackName = (card) => {
  const title = card?.querySelector?.([
    "[data-pack-name]",
    "[class*='pack'][class*='name']",
    "h1",
    "h2",
    "h3",
    "h4",
  ].join(","));
  return String(title?.getAttribute?.("data-pack-name") || title?.textContent || "").trim();
};

const findItemsMenu = (root) => {
  const headings = [...root.querySelectorAll("h1,h2,h3,h4,[role='heading']")]
    .filter((node) => {
      if (node.closest("grindpilot-panel")) return false;
      return ["items", "duplicates", "unassigned"].includes(normalizeText(node.textContent));
    });

  for (const heading of headings) {
    let container = heading.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const buttons = [...container.querySelectorAll(":scope > button, :scope > * > button")]
        .filter((button) => !button.classList.contains("grindpilot-organize-native"));
      const menu = buttons.find((button) => {
        const label = normalizeText(
          button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent,
        );
        return /more|menu|option/.test(label) || label.length <= 2;
      });
      if (menu) return menu;
      if (container.matches?.("main,[role='main']")) break;
    }
  }
  return null;
};

export class EaSurfaceActions {
  constructor(runtime, {
    root = globalThis.document,
    MutationObserver = globalThis.MutationObserver,
  } = {}) {
    this.runtime = runtime;
    this.root = root;
    this.state = runtime.getState();
    this.syncQueued = false;
    this.packRefreshToken = 0;
    this.unsubscribe = runtime.subscribe((state) => {
      this.state = state;
      this.scheduleSync();
    });
    this.installStyles();
    this.observer = MutationObserver ? new MutationObserver(() => this.scheduleSync()) : null;
    this.observer?.observe(root.documentElement || root, { childList: true, subtree: true });
    this.scheduleSync();
  }

  installStyles() {
    if (this.root.getElementById("grindpilot-ea-surface-styles")) return;
    const style = this.root.createElement("style");
    style.id = "grindpilot-ea-surface-styles";
    style.textContent = surfaceCss;
    (this.root.head || this.root.documentElement)?.appendChild(style);
  }

  scheduleSync() {
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.sync();
    });
  }

  sync() {
    this.mountQuickOpenButtons();
    this.mountOrganizeButton();
    void this.refreshPackBindings();
  }

  mountQuickOpenButtons() {
    const openButtons = [...this.root.querySelectorAll("button")].filter((button) =>
      !button.closest("grindpilot-panel") &&
      !button.classList.contains("grindpilot-quick-open-native") &&
      normalizeText(button.textContent) === "open",
    );

    for (const openButton of openButtons) {
      const card = findPackCard(openButton);
      const row = openButton.parentElement;
      if (!card || !row || row.querySelector(":scope > .grindpilot-quick-open-native")) continue;
      const packName = readPackName(card);
      if (!packName) continue;

      row.classList.add("grindpilot-pack-action-row");
      openButton.classList.add("grindpilot-native-open-peer");
      const quickOpen = createNativePeer(openButton, {
        className: "grindpilot-quick-open-native",
        label: "Quick Open",
        title: `Quick Open ${packName}`,
      });
      quickOpen.dataset.packName = packName;
      quickOpen.disabled = true;
      quickOpen.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const packId = quickOpen.dataset.packId;
        if (!packId || quickOpen.disabled) return;
        quickOpen.disabled = true;
        try {
          await this.runtime.quickOpenPack({ packId });
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          this.scheduleSync();
        }
      });
      row.appendChild(quickOpen);
    }
  }

  async refreshPackBindings() {
    const token = ++this.packRefreshToken;
    const buttons = [...this.root.querySelectorAll(".grindpilot-quick-open-native")];
    if (!buttons.length) return;
    const ready = Number(this.state.unassignedCount || 0) === 0 && isIdleStatus(this.state.runStatus);
    for (const button of buttons) button.disabled = true;
    if (!ready) return;

    let packs;
    try {
      packs = await this.runtime.listQuickOpenPacks();
    } catch {
      return;
    }
    if (token !== this.packRefreshToken) return;

    for (const button of buttons) {
      const visibleName = normalizeText(button.dataset.packName);
      const exact = packs.filter((pack) => normalizeText(pack.name || pack.packName || pack.type) === visibleName);
      const fuzzy = exact.length ? exact : packs.filter((pack) => {
        const ownedName = normalizeText(pack.name || pack.packName || pack.type);
        return ownedName && (visibleName.includes(ownedName) || ownedName.includes(visibleName));
      });
      const ids = [...new Set(fuzzy.map((pack) => String(pack.packId || pack.id || "")).filter(Boolean))];
      if (ids.length !== 1) {
        delete button.dataset.packId;
        button.title = `${button.dataset.packName}: owned pack could not be identified uniquely`;
        continue;
      }
      button.dataset.packId = ids[0];
      button.disabled = false;
      button.title = `Quick Open ${button.dataset.packName}`;
    }
  }

  mountOrganizeButton() {
    if (this.root.querySelector(".grindpilot-organize-native")) {
      this.updateOrganizeButton();
      return;
    }
    const menu = findItemsMenu(this.root);
    if (!menu?.parentElement) return;
      const organize = createNativePeer(menu, {
      className: "grindpilot-organize-native",
      label: "Organize",
      title: "Move safe cards, then recycle every remaining card in 10x85",
    });
    organize.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (organize.disabled) return;
      organize.disabled = true;
      try {
        await this.runtime.recycleCards();
      } catch (error) {
        this.runtime.reportUiError(error);
      } finally {
        this.scheduleSync();
      }
    });
    menu.parentElement.insertBefore(organize, menu);
    this.updateOrganizeButton();
  }

  updateOrganizeButton() {
    const organize = this.root.querySelector(".grindpilot-organize-native");
    if (!organize) return;
    const count = Number(this.state.unassignedCount || 0);
    const label = count > 0 ? `Organize (${count})` : "Organize";
    if (organize.textContent !== label) organize.textContent = label;
    if (organize.getAttribute("aria-label") !== label) organize.setAttribute("aria-label", label);
    organize.disabled = count < 1 || !isIdleStatus(this.state.runStatus);
    organize.title = count > 0
      ? `Organize ${count} item${count === 1 ? "" : "s"}: Club/Storage first, then 10x85`
      : "No unassigned items";
  }

  dispose() {
    this.packRefreshToken += 1;
    this.observer?.disconnect();
    this.unsubscribe?.();
    this.root.querySelectorAll(".grindpilot-quick-open-native,.grindpilot-organize-native")
      .forEach((node) => node.remove());
    this.root.getElementById("grindpilot-ea-surface-styles")?.remove();
  }
}
