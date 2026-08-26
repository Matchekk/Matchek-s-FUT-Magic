const css = `
:host{all:initial;--fm-bg-primary:#0b1020;--fm-bg-secondary:#121a2e;--fm-bg-elevated:#1e2b4d;--fm-text-primary:#e6edf5;--fm-text-secondary:#a7b2c9;--fm-text-muted:#7f8ba3;--fm-accent-primary:#00e6ff;--fm-accent-secondary:#26ffc2;--fm-focus:#7af4ff;--fm-destructive:#ff7f8f;--fm-border-subtle:#2a3858;color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}.launcher{position:fixed;right:18px;top:45%;z-index:2147483600;width:46px;height:46px;border:0;border-radius:15px;background:linear-gradient(145deg,#75bfff,#1e70d2);color:#fff;font-weight:900;box-shadow:0 10px 32px #0008;cursor:pointer}
.panel{position:fixed;z-index:2147483599;right:18px;top:72px;width:min(960px,calc(100vw - 36px));height:min(760px,calc(100vh - 100px));display:grid;grid-template-columns:170px 1fr;background:#10140ff2;backdrop-filter:blur(18px) saturate(140%);border:1px solid #4f6043;border-radius:18px;box-shadow:0 24px 80px #000c;overflow:hidden;color:#edf5e7}.hidden{display:none!important}
aside{padding:16px 10px;background:#151b13;border-right:1px solid #36432f;overflow:auto}.brand{padding:4px 8px 15px;font-size:17px;font-weight:800;color:#75bfff}.brand small{display:block;color:#85917e;font-size:10px;font-weight:600;margin-top:3px}.nav{display:block;width:100%;border:0;background:transparent;color:#b7c2b1;text-align:left;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:12px}.nav:hover,.nav.active{background:#263747;color:#fff}.main{padding:18px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.top h2{font-size:18px;margin:0}.close{border:0;background:#2d3529;color:#dce6d6;width:31px;height:31px;border-radius:9px;cursor:pointer}.view{display:none}.view.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.card{background:#1a2118;border:1px solid #36432f;border-radius:12px;padding:12px;margin-bottom:10px}.metric{font-size:24px;font-weight:800;color:#75bfff}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8f9b89}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}button.action{border:1px solid #53684a;background:#263420;color:#edf5e7;padding:8px 12px;border-radius:9px;cursor:pointer}button.primary{background:#2f8ee5;color:#fff;border-color:#63b0f5;font-weight:800}button.danger{background:#3a211f;border-color:#79413b}button:disabled{opacity:.42;cursor:not-allowed}.form{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:11px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-size:11px;color:#9da996}input,select,textarea{width:100%;border:1px solid #46543f;background:#11160f;color:#f4f8f0;border-radius:8px;padding:8px;font:inherit;font-size:12px}textarea{min-height:90px;resize:vertical}.hint{font-size:11px;color:#87927f;line-height:1.45}.banner{border-radius:10px;padding:9px 11px;margin-bottom:12px;background:#263747;color:#d7e7f4;font-size:12px}.banner.warn{background:#3d321d;color:#ffe3a3}.banner.error{background:#45201e;color:#ffc0b8}.log{display:grid;grid-template-columns:72px 92px 1fr;gap:8px;border-bottom:1px solid #293226;padding:7px 2px;font-size:11px}.muted{color:#86907f}.section-title{margin:18px 0 8px;font-size:13px;color:#c9d7c1}.empty{padding:25px;text-align:center;color:#778270;border:1px dashed #3e4939;border-radius:10px}.workflow-step{border-left:3px solid #2f8ee5;background:#151d20;padding:10px;margin:9px 0;border-radius:8px}.nested{margin:8px 0 12px 20px;padding-left:10px;border-left:1px dashed #526474}.requirement-row input{max-width:150px}.timeline{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.timeline span{padding:6px 9px;border-radius:20px;background:#252d25;color:#899487;font-size:11px}.timeline .done{color:#bfffc4}.timeline .active{background:#244a6d;color:#fff}.bucket-table{width:100%;border-collapse:collapse;font-size:11px}.bucket-table th,.bucket-table td{padding:7px;border-bottom:1px solid #303a2c;text-align:right}.bucket-table th:first-child,.bucket-table td:first-child{text-align:left}.health{display:grid;grid-template-columns:minmax(130px,1fr) 110px 2fr;gap:8px;padding:7px;border-bottom:1px solid #303a2c;font-size:11px}@media(max-width:680px){.panel{grid-template-columns:1fr;top:12px;height:calc(100vh - 24px)}aside{display:flex;gap:3px;overflow:auto;border-right:0;border-bottom:1px solid #36432f;padding:8px}.brand{display:none}.nav{white-space:nowrap;width:auto}.form{grid-template-columns:1fr}.health{grid-template-columns:1fr}}
.easy-hero{background:linear-gradient(145deg,#20394f,#182719);border:1px solid #4b7798;border-radius:16px;padding:18px;margin-bottom:14px}.easy-hero h3{font-size:22px;line-height:1.1;letter-spacing:-.02em;margin:0 0 7px}.easy-hero p{color:#b8c8b4;font-size:13px;line-height:1.5;margin:0}.easy-actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:16px}.easy-actions .action{min-height:48px;font-size:14px}.easy-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.easy-step{background:#171e16;border:1px solid #344230;border-radius:11px;padding:11px}.easy-step b{display:block;color:#75bfff;margin-bottom:3px}.easy-step span{font-size:11px;color:#9ba897;line-height:1.35}.easy-status{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.easy-status span{padding:6px 9px;border-radius:999px;background:#253025;color:#b9c7b4;font-size:11px}button.action,.launcher,.close{transition:transform 100ms ease-out,filter 120ms ease-out}button.action:active,.launcher:active,.close:active{transform:scale(.97)}details{margin:12px 0}summary{cursor:pointer;color:#b8c8b4;font-size:12px}@media(max-width:680px){.easy-steps{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){button.action,.launcher,.close{transition:none!important;transform:none!important}}@media(prefers-reduced-transparency:reduce){.panel{background:#10140f;backdrop-filter:none}}
/* FUT Magic outer-shell migration. Inner legacy forms remain intentionally dense. */
.launcher{width:48px;height:48px;border:1px solid #00e6ff55;border-radius:13px;background:var(--fm-bg-secondary);color:var(--fm-accent-primary);box-shadow:0 12px 32px #02050dcc}
.panel{grid-template-columns:180px 1fr;background:#0b1020f5;border-color:#00e6ff38;border-radius:16px;box-shadow:0 28px 80px #02050de0;color:var(--fm-text-primary)}
aside{background:var(--fm-bg-secondary);border-color:var(--fm-border-subtle)}.brand{color:var(--fm-accent-primary);font-weight:700;letter-spacing:-.015em}.brand small{color:var(--fm-text-muted);letter-spacing:.08em}.nav{min-height:44px;border-left:2px solid transparent;color:var(--fm-text-secondary);border-radius:8px}.nav:hover{background:#1e2b4d99;color:var(--fm-text-primary)}.nav.active{background:var(--fm-bg-elevated);border-left-color:var(--fm-accent-primary);color:var(--fm-text-primary)}
.main{scroll-padding-block:16px}.top h2{font-size:20px;line-height:1.2;letter-spacing:-.02em}.close{width:44px;height:44px;border:1px solid var(--fm-border-subtle);background:var(--fm-bg-elevated);color:var(--fm-text-primary);font-size:20px}.card,.easy-step{background:var(--fm-bg-secondary);border-color:var(--fm-border-subtle)}.metric,.easy-step b{color:var(--fm-accent-primary);font-variant-numeric:tabular-nums}.label,.hint,.muted,.easy-step span{color:var(--fm-text-muted)}
button.action{min-height:44px;border-color:var(--fm-border-subtle);background:var(--fm-bg-elevated);color:var(--fm-text-primary)}button.primary{background:var(--fm-accent-primary);border-color:var(--fm-accent-primary);color:#07111c}button.danger{background:#321a2a;border-color:#7c354b;color:#ffd8df}input,select,textarea{min-height:44px;border-color:var(--fm-border-subtle);background:var(--fm-bg-primary);color:var(--fm-text-primary)}label,summary{color:var(--fm-text-secondary)}.banner{background:var(--fm-bg-elevated);color:var(--fm-text-primary)}.workflow-step{border-left-color:var(--fm-accent-primary);background:var(--fm-bg-secondary)}.timeline span,.easy-status span{background:var(--fm-bg-secondary);color:var(--fm-text-secondary)}.timeline .done{color:var(--fm-accent-secondary)}.timeline .active{background:var(--fm-bg-elevated)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--fm-focus);outline-offset:2px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
@media(prefers-reduced-transparency:reduce){.panel{background:var(--fm-bg-primary);backdrop-filter:none}}
@media(prefers-contrast:more){.panel,.card,input,select,textarea,button{border-color:#7183a8}.nav.active{outline:1px solid var(--fm-accent-primary)}}
@media(forced-colors:active){.nav.active{border-left-color:Highlight}}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important}
`;

const sections = [
  "Easy Loop", "SBC Solver", "Workflows", "Profiles", "Inventory",
  "Protected Cards", "Target Projects", "Activity", "Settings", "Developer",
];

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const downloadJson = (name, value) => {
  const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const encodePath = (path) => encodeURIComponent(JSON.stringify(path));
const decodePath = (value) => JSON.parse(decodeURIComponent(value || "%5B%5D"));
const selected = (actual, value) => actual === value ? " selected" : "";
const checked = (value) => value ? " checked" : "";
const splitList = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
const legacyFocusableSelector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]';

const associateLegacyLabels = (root) => {
  let index = 0;
  root.querySelectorAll(".field > label:not([for])").forEach((label) => {
    if (label.querySelector("input,select,textarea")) return;
    const control = [...label.parentElement.children]
      .find((node) => node !== label && node.matches?.("input,select,textarea"));
    if (!control) return;
    if (!control.id) control.id = `fut-magic-legacy-field-${index += 1}`;
    label.setAttribute("for", control.id);
  });
};

const workflowStepControls = (step, path, index) => {
  const attrs = `data-wf-path="${encodePath(path)}" data-wf-index="${index}"`;
  const target = step.config?.target || {};
  const condition = step.config?.condition || {};
  const conditionPath = condition?.left?.path || "unresolvedUnassigned";
  const conditionValue = condition?.right?.value ?? 0;
  let config = "";
  if (step.type === "SOLVE_SBC") {
    config = `<div class="form"><div class="field"><label>Target</label><select data-wf-field="targetKind" ${attrs}><option${selected(target.kind,"CURRENT_OPEN_SBC")}>CURRENT_OPEN_SBC</option><option${selected(target.kind,"SPECIFIC_CHALLENGE")}>SPECIFIC_CHALLENGE</option><option${selected(target.kind,"SPECIFIC_SET")}>SPECIFIC_SET</option></select></div><div class="field"><label>Stable set ID</label><input data-wf-field="setId" ${attrs} value="${escapeHtml(target.setId || "")}"></div><div class="field"><label>Stable challenge ID</label><input data-wf-field="challengeId" ${attrs} value="${escapeHtml(target.challengeId || "")}"></div></div>`;
  } else if (step.type === "LOOP") {
    config = `<div class="field"><label>Loop iterations</label><input type="number" min="1" max="1000" data-wf-field="loopIterations" ${attrs} value="${escapeHtml(step.config?.maxIterations || 1)}"></div>`;
  } else if (step.type === "CONDITIONAL") {
    config = `<div class="form"><div class="field"><label>Metric path</label><input data-wf-field="conditionPath" ${attrs} value="${escapeHtml(conditionPath)}"></div><div class="field"><label>Operator</label><select data-wf-field="conditionOperator" ${attrs}>${["EQ","NEQ","GT","GTE","LT","LTE"].map((value)=>`<option${selected(condition.operator,value)}>${value}</option>`).join("")}</select></div><div class="field"><label>Value</label><input data-wf-field="conditionValue" ${attrs} value="${escapeHtml(conditionValue)}"></div></div>`;
  } else if (step.type === "DELAY") {
    config = `<div class="field"><label>Delay (ms)</label><input type="number" min="0" data-wf-field="durationMs" ${attrs} value="${escapeHtml(step.config?.durationMs || 0)}"></div>`;
  } else if (step.type === "PAUSE") {
    config = `<div class="field"><label>Pause reason</label><input data-wf-field="pauseReason" ${attrs} value="${escapeHtml(step.config?.reason || "")}"></div>`;
  }
  return `<div class="workflow-step"><div class="controls"><select aria-label="Step type" data-wf-field="type" ${attrs}>${["SOLVE_SBC","SUBMIT_SBC","CLAIM_REWARD","OPEN_REWARD_PACK","RESOLVE_ITEMS","ORGANIZE_ITEMS","HANDLE_PLAYER_PICK","DELAY","CONDITIONAL","LOOP","PAUSE"].map((value)=>`<option${selected(step.type,value)}>${value}</option>`).join("")}</select><button class="action" aria-label="Move step up" data-wf-action="up" ${attrs}>↑</button><button class="action" aria-label="Move step down" data-wf-action="down" ${attrs}>↓</button><button class="action" data-wf-action="duplicate" ${attrs}>Duplicate step</button><button class="action danger" data-wf-action="delete" ${attrs}>Delete step</button></div><div class="hint">${escapeHtml(step.id)}</div>${config}<div class="form"><div class="field"><label>Timeout ms</label><input type="number" min="100" data-wf-field="timeoutMs" ${attrs} value="${escapeHtml(step.timeoutMs || 120000)}"></div><div class="field"><label>Retry attempts</label><input type="number" min="1" max="10" data-wf-field="retryAttempts" ${attrs} value="${escapeHtml(step.retryPolicy?.maxAttempts || 1)}"></div><div class="field"><label>On failure</label><select data-wf-field="onFailure" ${attrs}>${["PAUSE","STOP","SKIP"].map((value)=>`<option${selected(step.onFailure,value)}>${value}</option>`).join("")}</select></div></div></div>`;
};

const renderWorkflowSteps = (steps = [], path = []) => {
  const rows = steps.map((step, index) => {
    const nested = [];
    for (const [branch, label] of [["body","Loop body"],["thenSteps","Then"],["elseSteps","Else"]]) {
      if (!Array.isArray(step.config?.[branch])) continue;
      const nextPath = [...path, { index, branch }];
      nested.push(`<div class="nested"><b>${label}</b>${renderWorkflowSteps(step.config[branch], nextPath)}<button class="action" data-wf-add="${encodePath(nextPath)}">Add Step</button></div>`);
    }
    return workflowStepControls(step, path, index) + nested.join("");
  }).join("");
  return rows || '<div class="empty">No steps in this branch.</div>';
};

const ratingRequirementRows = (requirements = []) =>
  requirements.map((entry) => `<div class="controls requirement-row" data-rating-row><input aria-label="Rating" type="number" min="1" max="99" data-rating="rating" value="${escapeHtml(entry.rating)}"><input aria-label="Count" type="number" min="1" data-rating="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-rating="completed" value="${escapeHtml(entry.completed)}"><button class="action danger" aria-label="Remove rating requirement" data-remove-row>×</button></div>`).join("");

const specialRequirementRows = (requirements = []) =>
  requirements.map((entry) => `<div class="controls requirement-row" data-special-row><input aria-label="Card type" data-special="cardType" value="${escapeHtml(entry.cardType)}"><input aria-label="Count" type="number" min="1" data-special="count" value="${escapeHtml(entry.count)}"><input aria-label="Completed" type="number" min="0" data-special="completed" value="${escapeHtml(entry.completed)}"><label><input type="checkbox" data-special="perRemainingSquad"${checked(entry.perRemainingSquad)}> per squad</label><button class="action danger" aria-label="Remove special-card requirement" data-remove-row>×</button></div>`).join("");

const renderProjectEditor = (project = {}) => `<section class="card project-editor" data-project-id="${escapeHtml(project.id || "")}"><div class="form"><div class="field"><label>Name</label><input data-project-field="name" value="${escapeHtml(project.name || "")}" placeholder="Target SBC"></div><div class="field"><label><input type="checkbox" data-project-field="active"${checked(project.active !== false)}> Active</label></div><div class="field"><label>Priority</label><input type="number" min="0" data-project-field="priority" value="${escapeHtml(project.priority ?? 50)}"></div><div class="field"><label>Squads remaining</label><input type="number" min="0" data-project-field="requiredSquadsRemaining" value="${escapeHtml(project.requiredSquadsRemaining ?? 0)}"></div><div class="field"><label>Hard protect at/above</label><input type="number" min="1" max="99" data-project-field="atOrAbove" value="${escapeHtml(project.protectedRatings?.atOrAbove ?? "")}"></div><div class="field"><label>Hard exact ratings (comma-separated)</label><input data-project-field="exact" value="${escapeHtml((project.protectedRatings?.exact || []).join(", "))}"></div><div class="field"><label>Soft rating reserves (e.g. 89:3, 90:2)</label><input data-project-field="reserveByRating" value="${escapeHtml(Object.entries(project.protectedRatings?.reserveByRating || {}).map(([rating,count])=>`${rating}:${count}`).join(", "))}"></div><div class="field"><label>Protected player IDs</label><input data-project-field="protectedPlayerIds" value="${escapeHtml((project.protectedPlayerIds || []).join(", "))}"></div><div class="field"><label>Protected resource IDs</label><input data-project-field="protectedResourceIds" value="${escapeHtml((project.protectedResourceIds || []).join(", "))}"></div><div class="field"><label>Completion</label><input type="number" min="0" max="1" step="0.01" data-project-field="completionProgress" value="${escapeHtml(project.completionProgress ?? 0)}"></div></div><div class="section-title">Rating requirements · Rating / Count / Completed</div><div data-rating-rows>${ratingRequirementRows(project.ratingRequirements)}</div><button class="action" data-add-rating-row>Add rating requirement</button><div class="section-title">Special requirements · Type / Count / Completed</div><div data-special-rows>${specialRequirementRows(project.specialCardRequirements)}</div><button class="action" data-add-special-row>Add special requirement</button><div class="controls"><button class="action primary" data-save-project>Save project</button>${project.sourceSetId ? `<button class="action" data-sync-project="${escapeHtml(project.id)}">Sync with current SBC</button>` : ""}${project.id ? `<button class="action danger" data-remove-project="${escapeHtml(project.id)}">Remove</button>` : ""}</div>${project.sourceSetId ? `<div class="hint">Source set ${escapeHtml(project.sourceSetId)} · ${escapeHtml((project.sourceChallengeIds || []).length)} mapped challenges</div>` : ""}</section>`;

const parseReserveMap = (value) => Object.fromEntries(
  splitList(value).map((entry) => entry.split(":").map((part) => part.trim()))
    .filter(([rating,count]) => Number.isInteger(Number(rating)) && Number(count) > 0)
    .map(([rating,count]) => [String(Number(rating)), Math.trunc(Number(count))]),
);

const readProjectEditor = (card, existing = null) => {
  const field = (name) => card.querySelector(`[data-project-field="${name}"]`);
  const ratingRequirements = [...card.querySelectorAll("[data-rating-row]")].map((row) => ({
    rating:Number(row.querySelector('[data-rating="rating"]')?.value||0),
    count:Number(row.querySelector('[data-rating="count"]')?.value||1),
    completed:Number(row.querySelector('[data-rating="completed"]')?.value||0),
  }));
  const specialCardRequirements = [...card.querySelectorAll("[data-special-row]")].map((row) => ({
    cardType:row.querySelector('[data-special="cardType"]')?.value||"",
    count:Number(row.querySelector('[data-special="count"]')?.value||1),
    completed:Number(row.querySelector('[data-special="completed"]')?.value||0),
    perRemainingSquad:Boolean(row.querySelector('[data-special="perRemainingSquad"]')?.checked),
  }));
  return {
    ...(existing || {}),
    id:card.dataset.projectId||undefined,
    name:field("name")?.value||"",
    active:Boolean(field("active")?.checked),
    priority:Number(field("priority")?.value||0),
    requiredSquadsRemaining:Number(field("requiredSquadsRemaining")?.value||0),
    ratingRequirements,
    specialCardRequirements,
    protectedRatings:{
      atOrAbove:field("atOrAbove")?.value?Number(field("atOrAbove").value):null,
      exact:splitList(field("exact")?.value).map(Number),
      reserveByRating:parseReserveMap(field("reserveByRating")?.value),
    },
    protectedPlayerIds:splitList(field("protectedPlayerIds")?.value),
    protectedResourceIds:splitList(field("protectedResourceIds")?.value),
    completionProgress:Number(field("completionProgress")?.value||0),
  };
};

export class GrindPanel {
  constructor(runtime, { legacyOnly = true } = {}) {
    this.runtime = runtime;
    this.legacyOnly = legacyOnly;
    this.host = document.createElement("grindpilot-panel");
    // Open shadow DOM keeps the panel style-isolated while remaining inspectable
    // for accessibility tools and the opt-in Developer Mode.
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.state = runtime.getState();
    this.activeSection = "Easy Loop";
    this.previouslyFocused = null;
    this.renderShell();
    document.documentElement.appendChild(this.host);
    this.unsubscribe = runtime.subscribe((state) => { this.state = state; this.renderViews(); });
    this.renderViews();
  }

  renderShell() {
    this.shadow.innerHTML = `<style>${css}</style><button class="launcher${this.legacyOnly ? " hidden" : ""}" aria-label="Open FUT Magic legacy tools">FM</button><section class="panel hidden" role="dialog" aria-modal="true" aria-labelledby="legacy-panel-brand legacy-panel-section"><aside><div class="brand" id="legacy-panel-brand">FUT Magic<small>ADVANCED · LEGACY TOOLS</small></div>${sections.map((name) => `<button class="nav${name === this.activeSection ? " active" : ""}" data-section="${name}"${name === this.activeSection ? ' aria-current="page"' : ""}>${name}</button>`).join("")}</aside><main class="main"><div class="top"><h2 id="legacy-panel-section"></h2><button class="close" aria-label="Close legacy tools">×</button></div><div class="content"></div></main></section>`;
    this.shadow.querySelector(".launcher").addEventListener("click", () => this.toggle(true));
    this.shadow.querySelector(".close").addEventListener("click", () => this.toggle(false));
    this.shadow.querySelector(".panel").addEventListener("keydown", (event) => this.handleDialogKeydown(event));
    this.shadow.querySelectorAll(".nav").forEach((node) => node.addEventListener("click", () => {
      this.activeSection = node.dataset.section;
      this.shadow.querySelectorAll(".nav").forEach((entry) => {
        entry.classList.toggle("active", entry === node);
        if (entry === node) entry.setAttribute("aria-current", "page");
        else entry.removeAttribute("aria-current");
      });
      this.renderViews();
    }));
  }

  handleDialogKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.toggle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.shadow.querySelectorAll(
      '.panel button:not(:disabled),.panel input:not(:disabled),.panel select:not(:disabled),.panel textarea:not(:disabled),.panel summary,.panel a[href]',
    )].filter((node) => node.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && this.shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  toggle(open) {
    const panel = this.shadow.querySelector(".panel");
    if (open && panel.classList.contains("hidden")) {
      this.previouslyFocused = document.activeElement;
    }
    panel.classList.toggle("hidden", !open);
    this.shadow.querySelector(".launcher").classList.toggle("hidden", this.legacyOnly || open);
    if (this.runtime.state.legacyPanelOpen !== open) {
      this.runtime.state.legacyPanelOpen = open;
      this.runtime.emit();
    }
    if (open) {
      this.runtime.refreshStatus?.();
      queueMicrotask(() => this.shadow.querySelector(".close")?.focus());
    } else {
      this.previouslyFocused?.focus?.();
      this.previouslyFocused = null;
    }
  }

  openSection(section = "Easy Loop") {
    if (sections.includes(section)) this.activeSection = section;
    this.shadow.querySelectorAll(".nav").forEach((entry) => {
      const active = entry.dataset.section === this.activeSection;
      entry.classList.toggle("active", active);
      if (active) entry.setAttribute("aria-current", "page");
      else entry.removeAttribute("aria-current");
    });
    this.renderViews();
    this.toggle(true);
  }

  banner() {
    const reason = this.state.pauseReason || this.state.error;
    if (reason) return `<div class="banner ${this.state.error ? "error" : "warn"}" role="${this.state.error ? "alert" : "status"}" aria-atomic="true">${escapeHtml(reason)}</div>`;
    return `<div class="banner">FUT Magic is ${escapeHtml(this.state.bridgeHealth === "healthy" ? "ready" : this.state.bridgeHealth || "checking")}</div>`;
  }

  renderViews() {
    const content = this.shadow.querySelector(".content");
    const previousFocusable = [...content.querySelectorAll(legacyFocusableSelector)];
    const previousFocusIndex = content.contains(this.shadow.activeElement)
      ? previousFocusable.indexOf(this.shadow.activeElement)
      : -1;
    const previousSelection = previousFocusIndex >= 0 && "selectionStart" in this.shadow.activeElement
      ? { start: this.shadow.activeElement.selectionStart, end: this.shadow.activeElement.selectionEnd }
      : null;
    this.shadow.querySelector(".top h2").textContent = this.activeSection;
    const render = this[`render${this.activeSection.replaceAll(" ", "")}`]?.bind(this) ?? (() => "");
    content.innerHTML = this.banner() + render();
    associateLegacyLabels(content);
    this.bindViewActions(content);
    if (previousFocusIndex >= 0) {
      queueMicrotask(() => {
        const nextFocusable = [...content.querySelectorAll(legacyFocusableSelector)];
        const target = nextFocusable[Math.min(previousFocusIndex, nextFocusable.length - 1)];
        target?.focus?.({ preventScroll: true });
        if (Number.isInteger(previousSelection?.start) && target && "setSelectionRange" in target) {
          target.setSelectionRange(previousSelection.start, previousSelection.end);
        }
      });
    }
  }

  renderEasyLoop() {
    const s = this.state;
    const count = Number(s.unassignedCount || 0);
    const runActive = !["idle", "completed", "stopped", "failed"].includes(String(s.runStatus || "idle"));
    const storageFull = Number(s.storageCount || 0) >= Number(s.storageCapacity || 100);
    const nextTitle = count > 0
      ? `Organize ${count} item${count === 1 ? "" : "s"}`
      : "Open the next pack safely";
    const nextBody = count > 0
      ? storageFull
        ? "SBC Storage is full. Every remaining card will be used directly in 10x85."
        : "Safe cards go to Club or SBC Storage. Anything left is recycled in 10x85."
      : "Open exactly one owned pack. Purchases are always blocked.";
    const icons = { completed:"✓", running:"→", waiting:"→", paused:"!", failed:"×", pending:"○" };
    const timeline = (s.timeline || []).map((entry) => `<span class="${entry.status === "completed" ? "done" : entry.active ? "active" : ""}">${icons[entry.status] || "○"} ${escapeHtml(entry.type.replaceAll("_", " "))}</span>`).join("");
    const analytics=s.analytics||{}; const consumed=analytics.ratingFlow?.consumed||{}; const received=analytics.ratingFlow?.received||{};
    return `<section class="easy-hero"><h3>${escapeHtml(nextTitle)}</h3><p>${escapeHtml(nextBody)}</p><div class="easy-status"><span>Storage ${escapeHtml(`${s.storageCount || 0}/${s.storageCapacity || 100}`)}</span><span>${escapeHtml(count)} unassigned</span><span>${escapeHtml(s.packsOpened || 0)} packs opened</span></div><div class="easy-actions"><button class="action ${count > 0 ? "primary" : ""}" data-action="recycle-cards"${count < 1 || runActive ? " disabled" : ""}>Route &amp; recycle</button><button class="action ${count < 1 ? "primary" : ""}" data-action="quick-open"${count > 0 || runActive ? " disabled" : ""}>Open one safely</button></div></section><div class="easy-steps"><div class="easy-step"><b>1 · Open safely</b><span>Open one owned pack.</span></div><div class="easy-step"><b>2 · Route &amp; recycle</b><span>Move safe cards and recycle leftovers.</span></div><div class="easy-step"><b>3 · Repeat</b><span>Continue until your target SBC is finished.</span></div></div>${timeline ? `<details><summary>Current run</summary><div class="timeline">${timeline}</div></details>` : ""}<details><summary>Run details</summary><div class="grid">${[
      ["Status", s.runStatus || "idle"], ["Step", s.currentStep || "—"], ["Iterations", `${s.iterations || 0}/${s.maxIterations || 0}`],
      ["SBCs", s.sbcCompleted || 0], ["Packs", s.packsOpened || 0], ["Picks", s.picksCompleted || 0], ["Duplicates", s.duplicatesRecycled || 0],
      ["Storage", `${s.storageCount || 0}/${s.storageCapacity || "?"}`], ["Unassigned", s.unassignedCount || 0], ["Protected saved", s.protectedCardsSaved || 0],
    ].map(([label,value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(value)}</div></div>`).join("")}</div><div class="card"><b>Per-run analytics</b><div class="hint">Duration: ${Math.round(Number(analytics.durationMs||0)/1000)}s · Pauses: ${analytics.pauses||0} · Solver failures: ${analytics.solverFailures||0}</div><div class="hint">Rating flow: ${consumed.cards||0} cards / ${consumed.ratingPoints||0} pts consumed → ${received.cards||0} cards / ${received.ratingPoints||0} pts received</div></div></details><div class="controls">${runActive ? `<button class="action" data-action="pause">Pause</button><button class="action primary" data-action="resume">Resume</button><button class="action danger" data-action="stop">Stop</button>` : ""}<button class="action" data-action="refresh">Refresh</button></div>`;
  }

  renderDashboard() { return this.renderEasyLoop(); }

  renderSBCSolver() { return `<div class="card"><p>The proven local AutoPilot solver remains the production engine.</p><p class="hint">Solve Squad, Multi Solve and Solve Entire Set remain available in their existing SBC surfaces while FUT Magic adds persistent runs and protection.</p><button class="action" data-action="legacy-sequence">Open legacy sequence planner</button></div>`; }

  renderWorkflows() {
    const cfg = this.state.draft || {};
    const templates = this.state.workflowTemplates || [];
    const legacy = this.state.legacySequences || [];
    const workflow = this.state.workflowDraft || { steps: [] };
    return `<div class="form"><div class="field"><label>Mode</label><select data-field="mode"><option${selected(cfg.mode,"REVIEW")}>REVIEW</option><option${selected(cfg.mode,"ASSISTED")}>ASSISTED</option><option${selected(cfg.mode,"AUTO")}>AUTO</option></select></div><div class="field"><label>Iterations (hard limit)</label><input data-field="maxIterations" type="number" min="1" max="1000" value="${escapeHtml(cfg.maxIterations || 1)}"></div><div class="field"><label>Template</label><select data-template-select>${templates.map((entry)=>`<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("")}</select></div><div class="field"><label>Player pick policy</label><select data-field="pickMode"><option${selected(cfg.pickMode,"PAUSE_FOR_USER")}>PAUSE_FOR_USER</option><option${selected(cfg.pickMode,"HIGHEST_RATING")}>HIGHEST_RATING</option><option${selected(cfg.pickMode,"HIGHEST_VALUE")}>HIGHEST_VALUE</option><option${selected(cfg.pickMode,"PREFER_NON_DUPLICATE")}>PREFER_NON_DUPLICATE</option><option${selected(cfg.pickMode,"PREFER_REQUIRED_SPECIAL")}>PREFER_REQUIRED_SPECIAL</option><option${selected(cfg.pickMode,"CUSTOM_PRIORITY")}>CUSTOM_PRIORITY</option></select></div><div class="field"><label>Custom priority criteria</label><input data-field="pickCriteria" value="${escapeHtml((cfg.pickPolicy?.criteria || []).join(", "))}" placeholder="NON_DUPLICATE, REQUIRED_SPECIAL, RATING, VALUE"></div><div class="field"><label>Reward packs</label><select data-field="packMode"><option${selected(cfg.packMode,"OPEN_CURRENT_REWARD")}>OPEN_CURRENT_REWARD</option><option${selected(cfg.packMode,"OPEN_MATCHING_PACKS")}>OPEN_MATCHING_PACKS</option><option${selected(cfg.packMode,"OPEN_ALL_ALLOWED_PACKS")}>OPEN_ALL_ALLOWED_PACKS</option></select></div><div class="field"><label>Max packs per pack step</label><input data-field="maxPacks" type="number" min="1" max="100" value="${escapeHtml(cfg.maxPacks || 1)}"></div></div><div class="controls"><button class="action" data-action="apply-template">Use template</button><button class="action" data-wf-add="${encodePath([])}">Add Step</button><button class="action" data-action="save-workflow">Save workflow</button><button class="action primary" data-action="start">Start workflow</button></div><div class="section-title">${escapeHtml(workflow.name || "Workflow")} · ordered typed steps</div>${renderWorkflowSteps(workflow.steps, [])}<div class="section-title">Legacy Sequence migration</div><div class="controls"><button class="action" data-action="refresh-legacy">Find legacy plans</button><select aria-label="Legacy sequence plan" data-legacy-select>${legacy.map((plan)=>`<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("")}</select><button class="action" data-action="import-legacy">Import Legacy Sequence</button></div><p class="hint">Specific set/challenge targets are verified by stable EA IDs. FUT Magic pauses and asks you to open the target when safe controller navigation is unavailable.</p>`;
  }

  renderProfiles() { return `<div class="controls"><button class="action" data-action="save-profile">Save current profile</button><button class="action" data-action="export-profile">Export</button><button class="action" data-import-profile-trigger>Import</button><input class="sr-only" aria-label="Choose a FUT Magic profile to import" data-action="import-profile" type="file" accept="application/json"></div>${(this.state.profiles || []).length ? (this.state.profiles || []).map((p) => `<div class="card"><b>${escapeHtml(p.name)}</b><div class="hint">${escapeHtml(p.id)}</div><button class="action" data-load-profile="${escapeHtml(p.id)}">Load</button></div>`).join("") : '<div class="empty">No saved grind profiles yet.</div>'}`; }

  renderInventory() { const i=this.state.inventory||{}; const buckets=this.state.inventoryBuckets||{}; const cfg=this.state.draft||{}; const targets=(this.state.projects||[]).filter((project)=>project.active!==false&&project.sourceSetId&&project.completionProgress<1); return `<div class="grid"><div class="card"><div class="label">Club</div><div class="metric">${i.clubCount||0}</div></div><div class="card"><div class="label">SBC Storage</div><div class="metric">${i.storageCount||0}</div></div><div class="card"><div class="label">Free slots</div><div class="metric">${i.storageFreeSlots ?? "?"}</div></div><div class="card"><div class="label">Unassigned</div><div class="metric">${i.unassignedCount||0}</div></div></div><div class="card"><div class="field"><label>Fallback recycling project</label><select data-organizer-target><option value="">Auto: 85x10, otherwise highest priority</option>${targets.map((project)=>`<option value="${escapeHtml(project.id)}"${selected(String(cfg.organizerTargetProjectId||""),String(project.id))}>${escapeHtml(project.name)}</option>`).join("")}</select></div><div class="controls"><button class="action" data-action="save-organizer">Save target</button><button class="action" data-action="quick-open"${Number(i.unassignedCount || 0)>0?" disabled":""}>Open safely</button><button class="action primary" data-action="recycle-cards"${Number(i.unassignedCount || 0) < 1 ? " disabled" : ""}>Route &amp; recycle</button><button class="action" data-action="inventory">Synchronize</button></div><p class="hint">Normal cards go to Club. Duplicates use only verified free SBC Storage slots. If Storage is full, every remaining card becomes mandatory in the selected SBC; if that exact squad is impossible, no submit occurs.</p></div><table class="bucket-table"><caption class="sr-only">Inventory rating buckets</caption><thead><tr><th scope="col">Rating</th><th scope="col">Club</th><th scope="col">Storage</th><th scope="col">Unassigned</th></tr></thead><tbody>${Object.entries(buckets).map(([label,value])=>`<tr><th scope="row">${escapeHtml(label)}</th><td>${value.club}</td><td>${value.storage}</td><td>${value.unassigned}</td></tr>`).join("")}</tbody></table>`; }
  renderProtectedCards() { const cfg=this.state.draft||{}; return `<div class="form"><div class="field"><label>Hard protect rating at/above</label><input data-protection="protectRatingAtOrAbove" type="number" min="1" max="99" value="${escapeHtml(cfg.protectRatingAtOrAbove ?? "")}"></div><div class="field"><label>Hard exact ratings</label><input data-protection="protectedRatings" value="${escapeHtml((cfg.protectedRatings||[]).join(", "))}"></div><div class="field"><label>Protected owned item IDs</label><input data-protection="protectedItemIds" value="${escapeHtml((cfg.protectedItemIds||[]).join(", "))}"></div><div class="field"><label>Protected player IDs</label><input data-protection="protectedPlayerIds" value="${escapeHtml((cfg.protectedPlayerIds||[]).join(", "))}"></div><div class="field"><label>Protected resource IDs</label><input data-protection="protectedResourceIds" value="${escapeHtml((cfg.protectedResourceIds||[]).join(", "))}"></div><div class="field"><label>Forbidden special types</label><input data-protection="protectedCardTypes" value="${escapeHtml((cfg.protectedCardTypes||[]).join(", "))}"></div><div class="field"><label>Soft rating reserves (89:3, 90:2)</label><input data-protection="minimumReserveByRating" value="${escapeHtml(Object.entries(cfg.minimumReserveByRating||{}).map(([r,c])=>`${r}:${c}`).join(", "))}"></div><div class="field"><label><input data-protection="protectStartingSquad" type="checkbox" checked disabled> Active squad is always protected</label><label><input data-protection="protectFavorites" type="checkbox"${checked(cfg.protectFavorites)}> Protect favourites</label><label><input data-protection="preferDuplicates" type="checkbox"${checked(cfg.preferDuplicates)}> Prefer duplicates</label><label><input data-protection="preferSbcStorage" type="checkbox"${checked(cfg.preferSbcStorage)}> Prefer SBC Storage</label><label><input data-protection="preferUntradeables" type="checkbox"${checked(cfg.preferUntradeables)}> Prefer untradeables</label></div></div><div class="controls"><button class="action primary" data-action="save-protection">Save protection policy</button></div><p class="hint">Active-squad cards are an unconditional hard exclusion. All hard protection is rechecked immediately before submit. Rating/special reserves and Target Project demand are soft conservation objectives.</p>`; }
  renderTargetProjects() { const projects=this.state.projects||[]; const dashboard=this.state.targetDashboard||[]; return `<div class="controls"><button class="action primary" data-action="new-project">New Target Project</button><button class="action" data-action="import-current-sbc">Import current SBC as Target Project</button></div>${dashboard.map((entry)=>`<div class="card"><b>Target: ${escapeHtml(entry.name)}</b><div class="hint">Progress: ${escapeHtml(entry.completedSquads)} / ${escapeHtml(entry.totalSquads)} squads completed · ${escapeHtml(entry.requiredSquadsRemaining)} remaining</div><div class="hint">Remaining ratings: ${entry.remainingRatings.map((r)=>`${r.rating}: ${r.remaining}${r.covered?" ✓":" missing"}`).join(" · ") || "unknown"}</div><div class="hint">Required specials: ${entry.remainingSpecials.map((r)=>`${escapeHtml(r.cardType.toUpperCase())}: ${r.remaining}`).join(" · ") || "none verified"}</div><div class="hint">Protection: ${escapeHtml(entry.protectedRatings.atOrAbove ? `${entry.protectedRatings.atOrAbove}+ hard protected` : "configured IDs/reserves")}</div></div>`).join("")}${renderProjectEditor({active:true,priority:50,requiredSquadsRemaining:0,protectedRatings:{exact:[],reserveByRating:{}},ratingRequirements:[],specialCardRequirements:[],completionProgress:0})}${projects.map(renderProjectEditor).join("")}`; }
  renderActivity() { const logs=(this.state.logs||[]).slice(-200).reverse(); const details=this.state.solveDetails; return `${details?`<div class="card"><b>Solve Details</b>${(details.explanations||[]).map((line)=>`<div class="hint">${escapeHtml(line)}</div>`).join("")}<div class="hint">Objective: ${escapeHtml((details.objectiveTuple||[]).join(" / "))}</div></div>`:""}${logs.length ? logs.map((e)=>`<div class="log"><span class="muted">${escapeHtml((e.timestamp||"").slice(11,19))}</span><b>${escapeHtml(e.action)}</b><span>${escapeHtml(e.message)}</span></div>`).join("") : '<div class="empty">No activity yet.</div>'}`; }
  renderSettings() { return `<div class="card"><b>Safety defaults</b><p class="hint">No pack purchases, no market automation, no credential persistence, no automatic quicksell. Ambiguous EA state always pauses.</p></div>`; }
  renderDeveloper() { const d=this.state.diagnostics||{}; const health=this.state.capabilityHealth||[]; return `<div class="form"><div class="field"><label><input data-field="developerMode" type="checkbox" ${d.enabled ? "checked" : ""}> Developer Mode</label></div></div><div class="section-title">Capability Health</div>${health.map((entry)=>`<div class="health"><b>${escapeHtml(entry.id)}</b><span>${escapeHtml(entry.status)}</span><span class="hint">${escapeHtml(JSON.stringify(entry.evidence||{}))}</span></div>`).join("")||'<div class="empty">Refresh to inspect safe capabilities.</div>'}<div class="controls"><button class="action" data-action="refresh">Refresh health</button><button class="action" data-action="diagnostic-snapshot">Take snapshot</button><button class="action" data-action="diagnostic-export">Export diagnostics</button></div><label class="sr-only" for="fut-magic-diagnostics-output">Latest redacted diagnostic snapshot</label><textarea id="fut-magic-diagnostics-output" readonly>${escapeHtml(JSON.stringify(d.latest || d, null, 2))}</textarea><p class="hint">Instrumentation remains dormant while Developer Mode is disabled. Export is redacted and excludes request bodies, headers and credentials. UNVERIFIED means capability presence was observed without dispatching a destructive operation.</p>`; }

  readDraft(root) {
    const get = (name) => root.querySelector(`[data-field="${name}"]`);
    const pickMode=get("pickMode")?.value||"PAUSE_FOR_USER";
    return { ...(this.state.draft || {}), mode:get("mode")?.value||"REVIEW", maxIterations:Number(get("maxIterations")?.value||1), storageCapacity:Number(get("storageCapacity")?.value||this.state.storageCapacity||100), packMode:get("packMode")?.value||"OPEN_CURRENT_REWARD", maxPacks:Number(get("maxPacks")?.value||1), pickMode, pickPolicy:{...(this.state.draft?.pickPolicy||{}),type:pickMode,criteria:splitList(get("pickCriteria")?.value)}, workflow:this.state.workflowDraft||this.state.draft?.workflow };
  }

  bindViewActions(root) {
    root.querySelector("[data-import-profile-trigger]")?.addEventListener("click", () =>
      root.querySelector('[data-action="import-profile"]')?.click());
    root.querySelectorAll("[data-action]").forEach((node) => node.addEventListener(node.tagName === "INPUT" ? "change" : "click", async () => {
      const action=node.dataset.action;
      try {
        if(action==="start") await this.runtime.start(this.readDraft(root));
        else if(action==="pause") await this.runtime.pause(); else if(action==="resume") await this.runtime.resume(); else if(action==="stop") await this.runtime.stop();
        else if(action==="refresh") await this.runtime.refreshStatus(); else if(action==="inventory") await this.runtime.refreshInventory();
        else if(action==="recycle-cards") await this.runtime.recycleCards();
        else if(action==="quick-open") await this.runtime.quickOpenPack();
        else if(action==="save-organizer") await this.runtime.saveOrganizerSettings(root.querySelector("[data-organizer-target]")?.value||null);
        else if(action==="legacy-sequence") globalThis.window?.eaData?.openSequencePlanner?.();
        else if(action==="save-profile") await this.runtime.saveDraftProfile(); else if(action==="export-profile") downloadJson("grindpilot-profile.json", await this.runtime.exportCurrentProfile());
        else if(action==="import-profile") { const file=node.files?.[0]; if(file) await this.runtime.importProfile(await file.text()); }
        else if(action==="diagnostic-snapshot") await this.runtime.takeDiagnosticSnapshot(); else if(action==="diagnostic-export") downloadJson("grindpilot-diagnostics.json", await this.runtime.exportDiagnostics());
        else if(action==="export-analytics") downloadJson("grindpilot-run-analytics.json", this.runtime.exportRunAnalytics());
        else if(action==="apply-template") this.runtime.useWorkflowTemplate(root.querySelector("[data-template-select]")?.value);
        else if(action==="save-workflow") this.runtime.saveWorkflowDraft();
        else if(action==="refresh-legacy") await this.runtime.refreshLegacySequences();
        else if(action==="import-legacy") await this.runtime.importLegacySequencePlan(root.querySelector("[data-legacy-select]")?.value);
        else if(action==="import-current-sbc") await this.runtime.importCurrentSbcProject();
        else if(action==="new-project") root.querySelector('.project-editor[data-project-id=""] [data-project-field="name"]')?.focus();
        else if(action==="save-protection") {
          const value=(name)=>root.querySelector(`[data-protection="${name}"]`);
          await this.runtime.saveProtectionSettings({
            protectRatingAtOrAbove:value("protectRatingAtOrAbove")?.value?Number(value("protectRatingAtOrAbove").value):null,
            protectedRatings:splitList(value("protectedRatings")?.value).map(Number),
            protectedItemIds:splitList(value("protectedItemIds")?.value),
            protectedPlayerIds:splitList(value("protectedPlayerIds")?.value),
            protectedResourceIds:splitList(value("protectedResourceIds")?.value),
            protectedCardTypes:splitList(value("protectedCardTypes")?.value),
            minimumReserveByRating:parseReserveMap(value("minimumReserveByRating")?.value),
            protectStartingSquad:Boolean(value("protectStartingSquad")?.checked),
            protectFavorites:Boolean(value("protectFavorites")?.checked),
            preferDuplicates:Boolean(value("preferDuplicates")?.checked),
            preferSbcStorage:Boolean(value("preferSbcStorage")?.checked),
            preferUntradeables:Boolean(value("preferUntradeables")?.checked),
          });
        }
      } catch(error) { this.runtime.reportUiError(error); }
    }));
    root.querySelectorAll("[data-load-profile]").forEach((node)=>node.addEventListener("click",()=>this.runtime.loadProfile(node.dataset.loadProfile)));
    root.querySelectorAll("[data-remove-project]").forEach((node)=>node.addEventListener("click",()=>this.runtime.removeTargetProject(node.dataset.removeProject)));
    root.querySelectorAll("[data-sync-project]").forEach((node)=>node.addEventListener("click",()=>this.runtime.syncTargetProject(node.dataset.syncProject).catch((error)=>this.runtime.reportUiError(error))));
    root.querySelectorAll("[data-add-rating-row]").forEach((node)=>node.addEventListener("click",()=>node.parentElement.querySelector("[data-rating-rows]")?.insertAdjacentHTML("beforeend",ratingRequirementRows([{rating:90,count:1,completed:0}]))));
    root.querySelectorAll("[data-add-special-row]").forEach((node)=>node.addEventListener("click",()=>node.parentElement.querySelector("[data-special-rows]")?.insertAdjacentHTML("beforeend",specialRequirementRows([{cardType:"totw",count:1,completed:0,perRemainingSquad:false}]))));
    root.querySelectorAll("[data-remove-row]").forEach((node)=>node.addEventListener("click",()=>node.closest(".requirement-row")?.remove()));
    root.querySelectorAll("[data-save-project]").forEach((node)=>node.addEventListener("click",async()=>{
      try {
        const card=node.closest(".project-editor");
        const existing=(this.state.projects||[]).find((project)=>project.id===card.dataset.projectId)||null;
        await this.runtime.saveTargetProject(readProjectEditor(card,existing));
      } catch(error) { this.runtime.reportUiError(error); }
    }));
    root.querySelectorAll("[data-wf-add]").forEach((node)=>node.addEventListener("click",()=>this.runtime.addWorkflowBuilderStep(decodePath(node.dataset.wfAdd))));
    root.querySelectorAll("[data-wf-action]").forEach((node)=>node.addEventListener("click",()=>{
      const path=decodePath(node.dataset.wfPath); const index=Number(node.dataset.wfIndex);
      if(node.dataset.wfAction==="delete")this.runtime.deleteWorkflowBuilderStep(path,index);
      else if(node.dataset.wfAction==="duplicate")this.runtime.duplicateWorkflowBuilderStep(path,index);
      else this.runtime.moveWorkflowBuilderStep(path,index,node.dataset.wfAction==="up"?-1:1);
    }));
    root.querySelectorAll("[data-wf-field]").forEach((node)=>node.addEventListener("change",()=>{
      const path=decodePath(node.dataset.wfPath); const index=Number(node.dataset.wfIndex); const card=node.closest(".workflow-step");
      const read=(name)=>card.querySelector(`[data-wf-field="${name}"]`);
      const type=read("type")?.value;
      if(node.dataset.wfField==="type") {
        this.runtime.updateWorkflowBuilderStep(path,index,{type}); return;
      }
      const patch={
        timeoutMs:Number(read("timeoutMs")?.value||120000),
        onFailure:read("onFailure")?.value||"PAUSE",
        retryPolicy:{maxAttempts:Number(read("retryAttempts")?.value||1)},
        config:{},
      };
      if(type==="SOLVE_SBC")patch.config.target={kind:read("targetKind")?.value||"CURRENT_OPEN_SBC",setId:read("setId")?.value||null,challengeId:read("challengeId")?.value||null};
      else if(type==="LOOP")patch.config.maxIterations=Number(read("loopIterations")?.value||1);
      else if(type==="DELAY")patch.config.durationMs=Number(read("durationMs")?.value||0);
      else if(type==="PAUSE")patch.config.reason=read("pauseReason")?.value||"Workflow pause";
      else if(type==="CONDITIONAL")patch.config.condition={type:"COMPARE",left:{type:"PATH",path:read("conditionPath")?.value||"unresolvedUnassigned"},operator:read("conditionOperator")?.value||"EQ",right:{type:"LITERAL",value:Number.isNaN(Number(read("conditionValue")?.value))?read("conditionValue")?.value:Number(read("conditionValue")?.value)}};
      this.runtime.updateWorkflowBuilderStep(path,index,patch);
    }));
    root.addEventListener("click",(event)=>{
      const remove=event.target.closest?.("[data-remove-row]");
      if(remove) remove.closest(".requirement-row")?.remove();
    });
    const dev=root.querySelector('[data-field="developerMode"]'); if(dev) dev.addEventListener("change",()=>this.runtime.setDeveloperMode(dev.checked));
  }

  dispose() { this.unsubscribe?.(); this.host.remove(); }
}
