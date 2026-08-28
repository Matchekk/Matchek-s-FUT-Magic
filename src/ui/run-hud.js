import { buildProductShellViewModel } from "../presentation/product-shell-view-model.js";

const css = `
:host{
  all:initial;
  color-scheme:dark;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --fm-bg-primary:#0B1020;
  --fm-bg-secondary:#121A2E;
  --fm-bg-elevated:#1E2B4D;
  --fm-bg-overlay:rgb(11 16 32 / 92%);
  --fm-text-primary:#E6EDF5;
  --fm-text-secondary:#A7B2C9;
  --fm-text-muted:#8793aa;
  --fm-text-on-accent:#07121B;
  --fm-accent-primary:#00E6FF;
  --fm-accent-secondary:#26FFC2;
  --fm-accent-violet:#7B61FF;
  --fm-positive:#26FFC2;
  --fm-warning:#FFCA67;
  --fm-destructive:#FF7185;
  --fm-border-subtle:rgb(167 178 201 / 16%);
  --fm-border-strong:rgb(0 230 255 / 42%);
  --fm-focus-ring:#6AEEFF;
  --fm-shadow-high:0 1rem 2.5rem rgb(2 6 18 / 42%);
  --fm-radius-sm:0.5rem;
  --fm-radius-md:0.75rem;
  --fm-radius-lg:1rem;
  --fm-radius-pill:999px;
  --fm-control-min-size:2.75rem;
  --fm-material-blur:18px;
}
*{box-sizing:border-box}
.hud{
  position:fixed;
  z-index:2147483598;
  right:12px;
  top:12px;
  width:min(312px,calc(100vw - 24px));
  padding:15px;
  overflow:hidden;
  color:var(--fm-text-primary);
  background:var(--fm-bg-overlay);
  -webkit-backdrop-filter:blur(var(--fm-material-blur)) saturate(125%);
  backdrop-filter:blur(var(--fm-material-blur)) saturate(125%);
  border:1px solid var(--fm-border-subtle);
  border-radius:var(--fm-radius-lg);
  box-shadow:var(--fm-shadow-high);
  opacity:1;
  transform:translateY(0);
  transition:opacity 160ms ease-out,transform 260ms cubic-bezier(.2,.8,.2,1);
}
.hidden{display:none}
.top,.row,.actions,.brand-lockup,.status,.guard-status,.top-actions{display:flex;align-items:center}
.top,.row{justify-content:space-between;gap:10px}
.top-actions{flex:0 0 auto;gap:7px}
.brand-lockup{min-width:0;gap:8px}
.brand-symbol{display:block;flex:0 0 auto;width:22px;height:22px;color:var(--fm-accent-primary)}
.brand-symbol .trajectory{color:var(--fm-accent-secondary)}
.brand-symbol .spark{color:var(--fm-text-primary)}
.brand{font-size:14px;font-weight:700;letter-spacing:-.015em;white-space:nowrap}
.status{flex:0 0 auto;gap:6px;color:var(--fm-text-secondary);font-size:11px;font-weight:600;line-height:16px}
.dot{width:7px;height:7px;border:1px solid currentColor;border-radius:50%;background:currentColor;box-shadow:0 0 0 2px rgba(38,255,194,.08)}
.status.normal{color:var(--fm-positive)}
.status.elevated,.status.caution{color:var(--fm-warning)}
.status.paused{color:var(--fm-text-primary)}
.status.recovery{color:var(--fm-destructive)}
.title{min-width:0;margin-top:14px;font-size:15px;font-weight:700;line-height:20px;letter-spacing:-.012em}
.title>span:first-child{min-width:0;overflow-wrap:anywhere}
.meta,.eyebrow{color:var(--fm-text-secondary);font-size:12px;line-height:17px}
.title .meta{flex:0 0 auto;font-variant-numeric:tabular-nums}
.progress{height:4px;margin:10px 0 13px;overflow:hidden;background:var(--fm-bg-elevated);border-radius:var(--fm-radius-pill)}
.bar{height:100%;background:linear-gradient(90deg,var(--fm-accent-primary),var(--fm-accent-secondary));border-radius:inherit;transform-origin:left;transition:transform 280ms cubic-bezier(.2,.8,.2,1)}
.progress-copy{margin:9px 0 13px;font-variant-numeric:tabular-nums}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.025em}
.next{margin-top:2px;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.next+.meta{margin-top:2px;overflow-wrap:anywhere}
.guard{margin-top:12px;padding-top:11px;border-top:1px solid var(--fm-border-subtle)}
.guard-status{gap:6px;color:var(--fm-text-primary);font-size:12px;font-weight:600;line-height:17px}
.guard-mark{width:6px;height:6px;border-radius:2px;background:currentColor;transform:rotate(45deg)}
.guard-status.normal{color:var(--fm-text-secondary)}
.guard-status.elevated,.guard-status.caution{color:var(--fm-warning)}
.guard-status.paused{color:var(--fm-text-primary)}
.guard-status.recovery{color:var(--fm-destructive)}
.intervention{margin-top:10px;padding:9px 10px;border-left:2px solid currentColor;border-radius:0 8px 8px 0;background:rgba(242,196,109,.07);color:var(--fm-warning);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.intervention.recovery{background:rgba(255,126,135,.07);color:var(--fm-destructive)}
.intervention-title{display:block;margin-bottom:2px;color:var(--fm-text-primary);font-weight:600}
.actions{justify-content:flex-start;gap:7px;margin-top:13px;flex-wrap:wrap}
.button{
  flex:0 0 auto;
  min-width:var(--fm-control-min-size);
  min-height:var(--fm-control-min-size);
  padding:0 12px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  border:1px solid var(--fm-border-subtle);
  border-radius:var(--fm-radius-md);
  background:var(--fm-bg-secondary);
  color:var(--fm-text-primary);
  font:600 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  cursor:pointer;
  touch-action:manipulation;
  transition:transform 90ms ease-out,background-color 130ms ease-out,border-color 130ms ease-out,color 130ms ease-out;
}
.button:hover{background:var(--fm-bg-elevated);border-color:var(--fm-border-strong)}
.button:active{transform:scale(.975);transition-duration:60ms}
.button:focus-visible{outline:2px solid var(--fm-focus-ring);outline-offset:2px}
.button[aria-busy="true"],.button:disabled{cursor:wait;opacity:.68}
.button.primary{margin-left:auto;border-color:transparent;background:var(--fm-accent-primary);color:var(--fm-text-on-accent)}
.button.primary:hover{background:var(--fm-accent-secondary)}
.button.stop{border-color:rgba(255,126,135,.32);background:transparent;color:var(--fm-destructive)}
.button.stop:hover{background:rgba(255,126,135,.09);border-color:rgba(255,126,135,.55)}
.button-icon{width:15px;height:15px;flex:0 0 auto}
.compact{width:min(300px,calc(100vw - 24px));padding:10px 11px}
.compact .compact-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700;line-height:18px}
.compact .brand-lockup{flex:1 1 auto}
.compact .brand-symbol{width:20px;height:20px}
.compact .status{margin-left:auto}
.compact .button{flex:0 0 44px;width:44px;padding:0}
.compact .top{gap:8px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

@media(max-width:290px){.hud{right:8px;top:8px;width:calc(100vw - 16px)}.button{padding:0 11px}}
@media(prefers-reduced-motion:reduce){.hud,.button{transition:opacity 120ms ease-out!important;transform:none!important}.bar{transition:none!important}}
@media(prefers-reduced-transparency:reduce){.hud{background:var(--fm-bg-primary);-webkit-backdrop-filter:none;backdrop-filter:none}}
@media(prefers-contrast:more){.hud{background:var(--fm-bg-primary);border-color:var(--fm-text-secondary)}.button{border-color:var(--fm-text-secondary)}.meta,.eyebrow,.status{color:var(--fm-text-primary)}}
@media(forced-colors:active){.hud,.button,.progress{border:1px solid CanvasText}.bar,.dot,.guard-mark{background:Highlight}.button:focus-visible{outline-color:Highlight}.intervention{border-color:Highlight}}
`;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const brandSymbol = () => `
  <svg class="brand-symbol" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="m8.5 23-2-14 13.5-3-1 4-8 1.8 1 8.6c4 .3 7.9-1 10.7-3.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="trajectory" d="M6.5 24.5c6.8 1.7 14.4.1 19.4-5.8" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/>
    <path class="trajectory" d="m23.1 18 3.1.1-.6 3" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="spark" d="M25 5.3c0 2-1 3-3 3 2 0 3 1 3 3 0-2 1-3 3-3-2 0-3-1-3-3Z" fill="currentColor"/>
  </svg>`;

const openPanelIcon = () => `
  <svg class="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M4 3.5h12v13H4zM11.5 3.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;

const chevronIcon = (expanded) => `
  <svg class="button-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="m6 ${expanded ? 12 : 8} 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const activityGuardPresentation = (run) => {
  if (run.guard.state === "recovery") return { state: "recovery", label: "Recovery" };
  if (run.status === "paused") return { state: "paused", label: "Paused" };
  if (["waiting", "stopping"].includes(run.status)) return { state: "elevated", label: "Elevated" };
  if (run.guard.state === "caution") return { state: "caution", label: "Caution" };
  return { state: "normal", label: "Normal" };
};

const runStatusLabel = (status) => {
  const labels = {
    recovery_required: "Needs review",
    stopping: "Stopping safely",
    waiting: "Waiting",
    paused: "Run paused",
    running: "Running",
  };
  return labels[String(status)] || String(status || "Active").replaceAll("_", " ");
};

export class RunHud {
  constructor(runtime) {
    this.runtime = runtime;
    this.host = document.createElement("fut-magic-run-hud");
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${css}</style><span class="sr-only" aria-live="polite" aria-atomic="true"></span><div data-hud-mount></div>`;
    this.liveRegion = this.shadow.querySelector('[aria-live="polite"]');
    this.mount = this.shadow.querySelector("[data-hud-mount]");
    this.lastAnnouncement = "";
    this.collapsed = false;
    document.documentElement.appendChild(this.host);
    this.unsubscribe = runtime.subscribe((state) => this.render(state));
  }

  render(state) {
    const focusedCommand = this.shadow.activeElement?.dataset?.command || null;
    const run = buildProductShellViewModel(state).run;
    if (!run || state.legacyPanelOpen) {
      this.mount.innerHTML = '<section class="hud hidden"></section>';
      this.liveRegion.textContent = "";
      this.lastAnnouncement = "";
      return;
    }
    const total = run.progress.total || 0;
    const current = run.progress.current || 0;
    const ratio = total ? Math.min(1, current / total) : 0;
    const statusLabel = runStatusLabel(run.status);
    const runTitle = String(run.title ?? "").trim() || "Active run";
    const guard = activityGuardPresentation(run);
    const compact = this.collapsed && guard.state === "normal";
    const announcement = `FUT Magic run status ${statusLabel}. Safety status ${guard.label}. ${run.currentStep?.label || run.nextStep?.label || "Preparing next step"}.`;
    if (announcement !== this.lastAnnouncement) {
      this.liveRegion.textContent = announcement;
      this.lastAnnouncement = announcement;
    }
    const progressMarkup = total
      ? `<div class="progress" role="progressbar" aria-label="Run progress" aria-valuemin="0" aria-valuenow="${current}" aria-valuemax="${total}" aria-valuetext="${current} of ${total} cycles"><div class="bar" style="transform:scaleX(${ratio})"></div></div>`
      : `<div class="meta progress-copy" role="status">${current} cycles completed · Total not set</div>`;
    const interventionTitle = guard.state === "recovery"
      ? "Action not verified"
      : /player|choice/i.test(`${run.currentStep?.label || ""} ${run.intervention?.message || ""}`)
        ? "Player choice needed"
        : "Your input is needed";
    const panelLabel = guard.state === "recovery" ? "Review in panel" : "Open panel";
    this.mount.innerHTML = compact
      ? `<section class="hud compact" aria-label="Active FUT Magic run"><div class="top"><div class="brand-lockup">${brandSymbol()}<span class="compact-title">${escapeHtml(runTitle)}</span></div><span class="status normal" aria-label="Run status: ${escapeHtml(statusLabel)}"><span class="dot" aria-hidden="true"></span>${escapeHtml(statusLabel)}</span><button class="button" data-command="expand" aria-label="Expand run HUD">${chevronIcon(false)}</button></div></section>`
      : `<section class="hud" aria-label="Active FUT Magic run"><div class="top"><div class="brand-lockup">${brandSymbol()}<div class="brand">FUT Magic</div></div><div class="top-actions"><div class="status ${escapeHtml(guard.state)}" aria-label="Run status: ${escapeHtml(statusLabel)}"><span class="dot" aria-hidden="true"></span>${escapeHtml(statusLabel)}</div>${guard.state === "normal" ? `<button class="button" data-command="collapse" aria-label="Collapse run HUD">${chevronIcon(true)}</button>` : ""}</div></div><div class="row title"><span>${escapeHtml(runTitle)}</span><span class="meta">${escapeHtml(total ? `${current} / ${total}` : current)}</span></div>${progressMarkup}<div class="eyebrow">${run.currentStep ? "Now" : "Next"}</div><div class="next">${escapeHtml(run.currentStep?.label || run.nextStep?.label || "Preparing the next safe step")}</div>${run.nextStep && run.currentStep ? `<div class="meta">Next: ${escapeHtml(run.nextStep.label)}</div>` : ""}<div class="row guard"><span class="meta">Activity Guard</span><span class="guard-status ${escapeHtml(guard.state)}"><span class="guard-mark" aria-hidden="true"></span>${escapeHtml(guard.label)}</span></div>${run.intervention ? `<div class="intervention ${escapeHtml(guard.state)}" role="status" aria-live="polite"><span class="intervention-title">${escapeHtml(interventionTitle)}</span>${escapeHtml(run.intervention.message)}</div>` : ""}<div class="actions">${run.canPause ? '<button class="button" data-command="pause">Pause</button>' : ""}${run.canResume ? '<button class="button" data-command="resume">Resume</button>' : ""}${run.canStop ? '<button class="button stop" data-command="stop">Stop</button>' : ""}<button class="button primary" data-command="open" aria-label="${escapeHtml(panelLabel)}" title="${escapeHtml(panelLabel)}">${openPanelIcon()}<span>${escapeHtml(panelLabel)}</span></button></div></section>`;
    this.shadow.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", async () => {
        const command = button.dataset.command;
        if (command === "collapse") {
          this.collapsed = true;
          this.render(this.runtime.getState());
          return;
        }
        if (command === "expand") {
          this.collapsed = false;
          this.render(this.runtime.getState());
          return;
        }
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
          if (command === "pause") await this.runtime.pause();
          else if (command === "resume") await this.runtime.resume();
          else if (command === "stop") await this.runtime.stop();
          else await this.runtime.openSidePanel();
        } catch (error) {
          this.runtime.reportUiError(error);
        } finally {
          if (button.isConnected) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
        }
      });
    });
    if (focusedCommand) {
      const equivalentCommand = focusedCommand === "collapse" && compact
        ? "expand"
        : focusedCommand === "expand" && !compact
          ? "collapse"
          : focusedCommand === "pause" && run.canResume
            ? "resume"
            : focusedCommand === "resume" && run.canPause
              ? "pause"
              : focusedCommand;
      const focusTarget = this.shadow.querySelector(`[data-command="${equivalentCommand}"]`)
        || this.shadow.querySelector('[data-command="open"]');
      focusTarget?.focus({ preventScroll: true });
    }
  }

  dispose() {
    this.unsubscribe?.();
    this.host.remove();
  }
}
