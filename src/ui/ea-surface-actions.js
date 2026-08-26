const normalizeText = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();

const isIdleStatus = (status) =>
  ["idle", "completed", "stopped", "failed"].includes(String(status || "idle"));

const surfaceCss = `
.grindpilot-pack-action-row{display:flex!important;align-items:stretch!important;gap:8px!important;width:100%!important;max-width:640px!important;margin-inline:auto!important}
.grindpilot-pack-action-row>.grindpilot-native-open-peer,
.grindpilot-pack-action-row>.grindpilot-quick-open-native{flex:1 1 0!important;width:auto!important;min-width:0!important;margin-left:0!important;margin-right:0!important}
.fut-magic-contextual{
  --fm-bg-primary:#0B1020;
  --fm-bg-secondary:#121A2E;
  --fm-bg-elevated:#1E2B4D;
  --fm-text-primary:#E6EDF5;
  --fm-text-secondary:#A7B2C9;
  --fm-text-on-accent:#07121B;
  --fm-accent-primary:#00E6FF;
  --fm-accent-secondary:#26FFC2;
  --fm-destructive:#FF7185;
  --fm-border-subtle:rgb(167 178 201 / 16%);
  --fm-border-strong:rgb(0 230 255 / 42%);
  --fm-focus-ring:#6AEEFF;
  --fm-radius-sm:0.5rem;
  --fm-control-min-size:2.75rem;
  position:relative!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  gap:7px!important;
  min-height:var(--fm-control-min-size)!important;
  overflow:hidden!important;
  border:1px solid var(--fm-border-subtle)!important;
  border-radius:var(--fm-radius-sm)!important;
  background:var(--fm-bg-secondary)!important;
  color:var(--fm-text-primary)!important;
  box-shadow:none!important;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
  font-size:13px!important;
  font-weight:600!important;
  line-height:1.2!important;
  letter-spacing:0!important;
  text-transform:none!important;
  cursor:pointer!important;
  touch-action:manipulation!important;
  transition:transform 80ms ease-out,background-color 120ms ease-out,border-color 120ms ease-out,color 120ms ease-out!important;
}
.fm-context-icon{display:block;width:15px;height:15px;flex:0 0 15px;color:var(--fm-accent-primary)}
.fm-context-icon .secondary{color:var(--fm-accent-secondary)}
.fut-magic-contextual:hover{background:var(--fm-bg-elevated)!important;border-color:var(--fm-border-strong)!important}
.fut-magic-contextual:active{transform:scale(.975)!important;transition-duration:60ms!important}
.fut-magic-contextual:focus-visible{outline:2px solid var(--fm-focus-ring)!important;outline-offset:2px!important}
.fut-magic-contextual[aria-busy="true"],.fut-magic-contextual:disabled{cursor:not-allowed!important;opacity:.68!important;transform:none!important}
.grindpilot-quick-open-native{border-color:rgba(0,230,255,.38)!important}
.grindpilot-organize-native{width:auto!important;min-width:104px!important;padding-left:12px!important;padding-right:12px!important;margin-left:auto!important;margin-right:8px!important;white-space:nowrap!important}
.grindpilot-organize-native::before{background:var(--fm-accent-secondary)}
.fut-magic-open-panel-native{width:auto!important;min-width:108px!important;padding-left:12px!important;padding-right:12px!important;white-space:nowrap!important;background:transparent!important}
@media(prefers-reduced-motion:reduce){.fut-magic-contextual{transition:color 100ms ease-out,background-color 100ms ease-out!important;transform:none!important}}
@media(prefers-reduced-transparency:reduce){.fut-magic-contextual{background:var(--fm-bg-secondary)!important}}
@media(prefers-contrast:more){.fut-magic-contextual{border-color:var(--fm-text-primary)!important}.fut-magic-contextual:focus-visible{outline-width:3px!important}}
@media(forced-colors:active){.fut-magic-contextual{border:1px solid ButtonText!important;background:ButtonFace!important;color:ButtonText!important}.fm-context-icon{color:Highlight!important}.fut-magic-contextual:focus-visible{outline-color:Highlight!important}}
`;

const contextualIcons = Object.freeze({
  spark: '<svg class="fm-context-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.5c0 3-1.5 4.5-4.5 4.5C6.5 6 8 7.5 8 10.5 8 7.5 9.5 6 12.5 6 9.5 6 8 4.5 8 1.5Z" fill="currentColor"/></svg>',
  route: '<svg class="fm-context-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 4h5a3 3 0 0 1 3 3v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path class="secondary" d="m7.8 9.4 2.7 2.7 2.7-2.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  brand: '<svg class="fm-context-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m8.5 23-2-14 13.5-3-1 4-8 1.8 1 8.6c4 .3 7.9-1 10.7-3.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><path class="secondary" d="M6.5 24.5c6.8 1.7 14.4.1 19.4-5.8m-2.8-.7 3.1.1-.6 3" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
});

const setVisibleLabel = (button, label) => {
  const node = button.querySelector(".fm-context-label");
  if (node && node.textContent !== label) node.textContent = label;
};

const createNativePeer = (peer, { className, label, title, icon }) => {
  const button = (peer?.ownerDocument || document).createElement("button");
  button.type = "button";
  button.className = `${peer?.className || ""} fut-magic-contextual ${className}`.trim();
  if (contextualIcons[icon]) button.insertAdjacentHTML("beforeend", contextualIcons[icon]);
  const labelNode = button.ownerDocument.createElement("span");
  labelNode.className = "fm-context-label";
  labelNode.textContent = label;
  button.appendChild(labelNode);
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
    this.observer = MutationObserver ? new MutationObserver((records) => {
      const relevant = records.some((record) => [...record.addedNodes, ...record.removedNodes]
        .some((node) => node.nodeType === 1));
      if (relevant) this.scheduleSync();
    }) : null;
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
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
    schedule(() => {
      this.syncQueued = false;
      this.sync();
    });
  }

  sync() {
    this.mountQuickOpenButtons();
    this.mountOrganizeButton();
    this.mountOpenPanelButton();
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
        label: "Open safely",
        title: `Open owned ${packName} safely with FUT Magic`,
        icon: "spark",
      });
      quickOpen.dataset.packName = packName;
      quickOpen.disabled = true;
      quickOpen.setAttribute("aria-label", "Open safely with FUT Magic unavailable: checking owned pack");
      quickOpen.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const packId = quickOpen.dataset.packId;
        if (!packId || quickOpen.disabled) return;
        quickOpen.disabled = true;
        try {
          quickOpen.setAttribute("aria-busy", "true");
          await this.runtime.quickOpenPack({ packId });
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          quickOpen.removeAttribute("aria-busy");
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
    for (const button of buttons) {
      button.disabled = true;
      const reason = Number(this.state.unassignedCount || 0) > 0
        ? "resolve Unassigned items first"
        : !isIdleStatus(this.state.runStatus)
          ? "finish or stop the active run first"
          : "checking owned pack";
      button.setAttribute("aria-label", `Open safely with FUT Magic unavailable: ${reason}`);
    }
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
        button.setAttribute("aria-label", "Open safely with FUT Magic unavailable: owned pack could not be identified uniquely");
        continue;
      }
      button.dataset.packId = ids[0];
      button.disabled = false;
      button.title = `Open owned ${button.dataset.packName} safely with FUT Magic`;
      button.setAttribute("aria-label", "Open safely with FUT Magic");
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
      title: "Organize with FUT Magic: move safe cards, then use remaining cards only in a verified SBC",
      icon: "route",
    });
    organize.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (organize.disabled) return;
      organize.disabled = true;
      try {
        organize.setAttribute("aria-busy", "true");
        await this.runtime.recycleCards();
      } catch (error) {
        this.runtime.reportUiError(error);
      } finally {
        organize.removeAttribute("aria-busy");
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
    const runIdle = isIdleStatus(this.state.runStatus);
    const label = count < 1
      ? "Organize · No items"
      : !runIdle
        ? "Organize · Run active"
        : `Organize (${count})`;
    setVisibleLabel(organize, label);
    organize.disabled = count < 1 || !runIdle;
    organize.setAttribute("aria-label", count < 1
      ? "Organize with FUT Magic unavailable: no Unassigned items"
      : !runIdle
        ? "Organize with FUT Magic unavailable: finish or stop the active run first"
        : `Organize ${count} item${count === 1 ? "" : "s"} with FUT Magic`);
    organize.title = count > 0 && runIdle
      ? `Organize ${count} item${count === 1 ? "" : "s"} with FUT Magic: Club/Storage first, then only a verified SBC`
      : count < 1 ? "No Unassigned items" : "Finish or stop the active run first";
  }

  mountOpenPanelButton() {
    if (this.root.querySelector(".fut-magic-open-panel-native")) return;
    const menu = findItemsMenu(this.root);
    if (!menu?.parentElement) return;
    const open = createNativePeer(menu, {
      className: "fut-magic-open-panel-native",
      label: "Open FUT Magic",
      title: "Review this context in FUT Magic",
      icon: "brand",
    });
    open.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      open.disabled = true;
      open.setAttribute("aria-busy", "true");
      try { await this.runtime.openSidePanel(); }
      catch (error) { this.runtime.reportUiError(error); }
      finally {
        if (open.isConnected) {
          open.disabled = false;
          open.removeAttribute("aria-busy");
        }
      }
    });
    menu.parentElement.insertBefore(open, menu);
  }

  dispose() {
    this.packRefreshToken += 1;
    this.observer?.disconnect();
    this.unsubscribe?.();
    this.root.querySelectorAll(".grindpilot-quick-open-native,.grindpilot-organize-native,.fut-magic-open-panel-native")
      .forEach((node) => node.remove());
    this.root.getElementById("grindpilot-ea-surface-styles")?.remove();
  }
}
