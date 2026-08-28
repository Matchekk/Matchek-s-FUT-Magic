(() => {
  "use strict";

  if (globalThis.__futMagicEaWorkspaceInstalled) return;
  globalThis.__futMagicEaWorkspaceInstalled = true;

  const INSTALL_RETRY_MS = 120;
  const INSTALL_TIMEOUT_MS = 15000;
  const INSTALL_IDLE_RETRY_MS = 2000;
  const startedAt = Date.now();
  let installTimer = null;
  let WorkspaceView = null;
  let WorkspaceViewController = null;
  let homeViewHooked = false;
  let homeControllerHooked = false;
  let restoreHomeTileFocus = false;

  const getCurrentController = () => {
    try {
      if (typeof globalThis.getAppMain !== "function") return null;
      const root = globalThis.getAppMain()?.getRootViewController?.() ?? null;
      const presented = root?.getPresentedViewController?.() ?? root;
      const current = presented?.getCurrentViewController?.() ?? presented;
      return current?.getCurrentController?.() ?? current ?? null;
    } catch {
      return null;
    }
  };

  const getNavigationController = (controller = getCurrentController()) => {
    try {
      return controller?.getNavigationController?.() ?? null;
    } catch {
      return null;
    }
  };

  const createBrandGraphic = () => {
    const graphic = document.createElement("div");
    graphic.className = "fut-magic-home-tile__graphic";
    graphic.setAttribute("aria-hidden", "true");

    const mark = document.createElement("span");
    mark.className = "fut-magic-home-tile__mark";
    mark.innerHTML =
      '<svg viewBox="0 0 48 48" focusable="false" aria-hidden="true"><path d="M14 8h22l-3 7H20l-4 21h15l5-6"/><path d="M9 39c11 2 22-1 30-10"/><path d="M34 5v8M30 9h8"/></svg>';

    const copy = document.createElement("span");
    copy.className = "fut-magic-home-tile__copy";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "FUT MAGIC";
    const detail = document.createElement("small");
    detail.textContent = "Protected grind plans and verified execution";
    copy.append(eyebrow, detail);
    graphic.append(mark, copy);
    return graphic;
  };

  const ensureWorkspaceTypes = () => {
    if (WorkspaceView && WorkspaceViewController) return true;
    const EAView = globalThis.EAView;
    const EAViewController = globalThis.EAViewController;
    const inherits = globalThis.JSUtils?.inherits;
    if (
      typeof EAView !== "function" ||
      typeof EAViewController !== "function" ||
      typeof inherits !== "function"
    ) {
      return false;
    }

    WorkspaceView = function FutMagicWorkspaceView() {
      EAView.call(this);
      this._generated = false;
      this.__root = null;
      this.__mount = null;
    };
    inherits(WorkspaceView, EAView);
    WorkspaceView.prototype._generate = function () {
      if (this._generated) return;
      const root = document.createElement("section");
      root.className = "fut-magic-ea-workspace";
      root.setAttribute("aria-label", "FUT Magic grind workspace");
      const mount = document.createElement("div");
      mount.className = "fut-magic-ea-workspace__mount";
      root.appendChild(mount);
      this.__root = root;
      this.__mount = mount;
      this._generated = true;
    };
    WorkspaceView.prototype.getRootElement = function () {
      if (!this._generated) this._generate();
      return this.__root;
    };
    WorkspaceView.prototype.getMountElement = function () {
      if (!this._generated) this._generate();
      return this.__mount;
    };

    WorkspaceViewController = function FutMagicWorkspaceViewController() {
      EAViewController.call(this);
      this.__futMagicOpened = false;
      this.__futMagicClosing = false;
      this.__futMagicMountAttempt = 0;
      this.__futMagicFallbackStarted = false;
    };
    inherits(WorkspaceViewController, EAViewController);
    WorkspaceViewController.prototype._getViewInstanceFromData = function () {
      return new WorkspaceView();
    };
    WorkspaceViewController.prototype.init = function () {
      if (this.initialized) return;
      EAViewController.prototype.init.call(this);
    };
    WorkspaceViewController.prototype.getNavigationTitle = function () {
      return "FUT Magic";
    };
    WorkspaceViewController.prototype.viewDidAppear = function () {
      EAViewController.prototype.viewDidAppear.call(this);
      try {
        this.getNavigationController?.()?.setNavigationVisibility?.(true, true);
      } catch {}
      const mount = this.getView?.()?.getMountElement?.() ?? null;
      if (!(mount instanceof HTMLElement)) return;
      this.__futMagicOpened = true;
      const mountAttempt = ++this.__futMagicMountAttempt;
      Promise.resolve(
        globalThis.eaData?.openSequenceSolver?.({
          presentation: "native",
          mount,
          onRequestClose: () => {
            if (this.__futMagicClosing) return true;
            this.__futMagicClosing = true;
            try {
              this.getNavigationController?.()?.popViewController?.();
            } finally {
              queueMicrotask(() => {
                this.__futMagicClosing = false;
              });
            }
            return true;
          },
        }),
      ).then(
        (opened) => {
          if (opened === true) {
            queueMicrotask(() => {
              mount.querySelector?.("#ea-data-sequence-title")?.focus?.();
            });
            return;
          }
          this.__futMagicRollbackMount(mountAttempt);
        },
        () => {
          this.__futMagicRollbackMount(mountAttempt);
        },
      );
    };
    WorkspaceViewController.prototype.__futMagicRollbackMount = function (
      mountAttempt,
    ) {
      if (
        this.__futMagicFallbackStarted ||
        !this.__futMagicOpened ||
        mountAttempt !== this.__futMagicMountAttempt
      ) {
        return;
      }
      this.__futMagicFallbackStarted = true;
      this.__futMagicOpened = false;
      try {
        globalThis.eaData?.closeSequenceSolver?.({ fromNavigation: true });
      } catch {}
      try {
        this.getNavigationController?.()?.popViewController?.();
      } catch {}
      void Promise.resolve(globalThis.eaData?.openSequenceSolver?.()).catch(
        () => false,
      );
    };
    WorkspaceViewController.prototype.viewWillDisappear = function () {
      if (this.__futMagicOpened) {
        try {
          globalThis.eaData?.closeSequenceSolver?.({ fromNavigation: true });
        } catch {}
        this.__futMagicOpened = false;
      }
      EAViewController.prototype.viewWillDisappear.call(this);
    };
    return true;
  };

  const openWorkspace = async () => {
    restoreHomeTileFocus = true;
    if (!ensureWorkspaceTypes()) {
      return Boolean(await globalThis.eaData?.openSequenceSolver?.());
    }
    const navigation = getNavigationController();
    if (!navigation || typeof navigation.pushViewController !== "function") {
      return Boolean(await globalThis.eaData?.openSequenceSolver?.());
    }
    try {
      const controller = new WorkspaceViewController();
      controller.init();
      navigation.pushViewController(controller);
      return true;
    } catch {
      return Boolean(await globalThis.eaData?.openSequenceSolver?.());
    }
  };

  const ensureHomeTile = (view) => {
    if (!view || view.__futMagicHomeTile) return view?.__futMagicHomeTile ?? null;
    if (view.__futMagicHomeTileInstalling) return null;
    const TileView = globalThis.UTTileView;
    if (typeof TileView !== "function") return null;
    view.__futMagicHomeTileInstalling = true;
    try {
      const root = view.getRootElement?.() ?? view.__root ?? null;
      const grid = root?.querySelector?.(".layout-hub.grid") ?? null;
      if (!(grid instanceof HTMLElement)) return null;
      const tile = new TileView();
      tile.init();
      if (typeof tile.setTitle === "function") tile.setTitle("FUT Magic");
      else tile.title = "FUT Magic";
      const tileRoot = tile.getRootElement?.() ?? null;
      if (!(tileRoot instanceof HTMLElement)) return null;
      tileRoot.classList.add(
        "col-1-2",
        "ut-tile-view--with-gfx",
        "fut-magic-home-tile",
      );
      tileRoot.setAttribute("data-fut-magic-home-tile", "true");
      tileRoot.appendChild(createBrandGraphic());
      grid.appendChild(tileRoot);
      view.__futMagicHomeTile = tile;
      return tile;
    } catch {
      return null;
    } finally {
      view.__futMagicHomeTileInstalling = false;
    }
  };

  const bindHomeTile = (controller) => {
    const view = controller?.getView?.() ?? null;
    const tile = ensureHomeTile(view);
    if (!tile) return;
    const focusTileIfRequested = () => {
      if (!restoreHomeTileFocus) return;
      restoreHomeTileFocus = false;
      queueMicrotask(() => tile.getRootElement?.()?.focus?.());
    };
    if (controller.__futMagicHomeTileBound) {
      focusTileIfRequested();
      return;
    }
    const eventType = globalThis.EventType?.TAP;
    if (typeof tile.addTarget === "function" && eventType != null) {
      const handler = () => {
        void openWorkspace();
      };
      tile.addTarget(controller, handler, eventType);
      controller.__futMagicHomeTileBound = { tile, handler, eventType };
      focusTileIfRequested();
      return;
    }
    const tileRoot = tile.getRootElement?.() ?? null;
    if (!(tileRoot instanceof HTMLElement)) return;
    const handler = () => {
      void openWorkspace();
    };
    tileRoot.addEventListener("click", handler);
    controller.__futMagicHomeTileBound = { tileRoot, handler };
    focusTileIfRequested();
  };

  const unbindHomeTile = (controller) => {
    const binding = controller?.__futMagicHomeTileBound ?? null;
    if (!binding) return;
    try {
      binding.tile?.removeTarget?.(controller, binding.handler, binding.eventType);
    } catch {}
    try {
      binding.tileRoot?.removeEventListener?.("click", binding.handler);
    } catch {}
    controller.__futMagicHomeTileBound = null;
  };

  const installHomeHooks = () => {
    const HomeView = globalThis.UTHomeHubView;
    const HomeController = globalThis.UTHomeHubViewController;
    if (!homeViewHooked && HomeView?.prototype) {
      const proto = HomeView.prototype;
      const originalGenerate = proto._generate;
      if (typeof originalGenerate === "function") {
        proto._generate = function (...args) {
          const result = originalGenerate.apply(this, args);
          ensureHomeTile(this);
          return result;
        };
        proto.__futMagicHomeTileViewHooked = true;
        homeViewHooked = true;
      }
    }
    if (!homeControllerHooked && HomeController?.prototype) {
      const proto = HomeController.prototype;
      const originalDidAppear = proto.viewDidAppear;
      const originalWillDisappear = proto.viewWillDisappear;
      if (typeof originalDidAppear === "function") {
        proto.viewDidAppear = function (...args) {
          const result = originalDidAppear.apply(this, args);
          bindHomeTile(this);
          return result;
        };
        if (typeof originalWillDisappear === "function") {
          proto.viewWillDisappear = function (...args) {
            unbindHomeTile(this);
            return originalWillDisappear.apply(this, args);
          };
        }
        proto.__futMagicHomeTileControllerHooked = true;
        homeControllerHooked = true;
      }
    }
    const current = getCurrentController();
    if (HomeController && current instanceof HomeController) bindHomeTile(current);
    return homeViewHooked && homeControllerHooked;
  };

  globalThis.FutMagicEaWorkspace = Object.freeze({
    open: openWorkspace,
    refresh: installHomeHooks,
  });

  const install = () => {
    installTimer = null;
    const ready = ensureWorkspaceTypes() && installHomeHooks();
    if (ready || installTimer != null) return;
    const retryDelay =
      Date.now() - startedAt < INSTALL_TIMEOUT_MS
        ? INSTALL_RETRY_MS
        : INSTALL_IDLE_RETRY_MS;
    installTimer = setTimeout(install, retryDelay);
  };
  install();
})();
