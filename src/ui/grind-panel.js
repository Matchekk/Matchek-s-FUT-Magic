const css = `
:host{all:initial;color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}.launcher{position:fixed;right:18px;top:45%;z-index:2147483600;width:46px;height:46px;border:0;border-radius:15px;background:linear-gradient(145deg,#b9ff3c,#63d31f);color:#102006;font-weight:900;box-shadow:0 10px 32px #0008;cursor:pointer}
.panel{position:fixed;z-index:2147483599;right:18px;top:72px;width:min(960px,calc(100vw - 36px));height:min(760px,calc(100vh - 100px));display:grid;grid-template-columns:170px 1fr;background:#10140fef;border:1px solid #4f6043;border-radius:18px;box-shadow:0 24px 80px #000c;overflow:hidden;color:#edf5e7}.hidden{display:none!important}
aside{padding:16px 10px;background:#151b13;border-right:1px solid #36432f;overflow:auto}.brand{padding:4px 8px 15px;font-size:17px;font-weight:800;color:#b9ff3c}.brand small{display:block;color:#85917e;font-size:10px;font-weight:600;margin-top:3px}.nav{display:block;width:100%;border:0;background:transparent;color:#b7c2b1;text-align:left;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:12px}.nav:hover,.nav.active{background:#283322;color:#fff}.main{padding:18px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.top h2{font-size:18px;margin:0}.close{border:0;background:#2d3529;color:#dce6d6;width:31px;height:31px;border-radius:9px;cursor:pointer}.view{display:none}.view.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.card{background:#1a2118;border:1px solid #36432f;border-radius:12px;padding:12px}.metric{font-size:24px;font-weight:800;color:#b9ff3c}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8f9b89}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:13px 0}button.action{border:1px solid #53684a;background:#263420;color:#edf5e7;padding:8px 12px;border-radius:9px;cursor:pointer}button.primary{background:#a8ed39;color:#102006;border-color:#a8ed39;font-weight:800}button.danger{background:#3a211f;border-color:#79413b}button:disabled{opacity:.42;cursor:not-allowed}.form{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:11px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-size:11px;color:#9da996}input,select,textarea{width:100%;border:1px solid #46543f;background:#11160f;color:#f4f8f0;border-radius:8px;padding:8px;font:inherit;font-size:12px}textarea{min-height:90px;resize:vertical}.hint{font-size:11px;color:#87927f;line-height:1.45}.banner{border-radius:10px;padding:9px 11px;margin-bottom:12px;background:#283322;color:#d7e7cc;font-size:12px}.banner.warn{background:#3d321d;color:#ffe3a3}.banner.error{background:#45201e;color:#ffc0b8}.log{display:grid;grid-template-columns:72px 92px 1fr;gap:8px;border-bottom:1px solid #293226;padding:7px 2px;font-size:11px}.muted{color:#86907f}.section-title{margin:18px 0 8px;font-size:13px;color:#c9d7c1}.empty{padding:25px;text-align:center;color:#778270;border:1px dashed #3e4939;border-radius:10px}@media(max-width:680px){.panel{grid-template-columns:1fr;top:12px;height:calc(100vh - 24px)}aside{display:flex;gap:3px;overflow:auto;border-right:0;border-bottom:1px solid #36432f;padding:8px}.brand{display:none}.nav{white-space:nowrap;width:auto}.form{grid-template-columns:1fr}}
`;

const sections = [
  "Dashboard", "SBC Solver", "Workflows", "Profiles", "Inventory",
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

export class GrindPanel {
  constructor(runtime) {
    this.runtime = runtime;
    this.host = document.createElement("grindpilot-panel");
    this.shadow = this.host.attachShadow({ mode: "closed" });
    this.state = runtime.getState();
    this.activeSection = "Dashboard";
    this.renderShell();
    document.documentElement.appendChild(this.host);
    this.unsubscribe = runtime.subscribe((state) => { this.state = state; this.renderViews(); });
    this.renderViews();
  }

  renderShell() {
    this.shadow.innerHTML = `<style>${css}</style><button class="launcher" title="GrindPilot FC26">GP</button><section class="panel hidden"><aside><div class="brand">GrindPilot FC26<small>ONE SBC GRIND MANAGER</small></div>${sections.map((name) => `<button class="nav${name === this.activeSection ? " active" : ""}" data-section="${name}">${name}</button>`).join("")}</aside><main class="main"><div class="top"><h2></h2><button class="close" title="Close">×</button></div><div class="content"></div></main></section>`;
    this.shadow.querySelector(".launcher").addEventListener("click", () => this.toggle(true));
    this.shadow.querySelector(".close").addEventListener("click", () => this.toggle(false));
    this.shadow.querySelectorAll(".nav").forEach((node) => node.addEventListener("click", () => {
      this.activeSection = node.dataset.section;
      this.shadow.querySelectorAll(".nav").forEach((entry) => entry.classList.toggle("active", entry === node));
      this.renderViews();
    }));
  }

  toggle(open) {
    this.shadow.querySelector(".panel").classList.toggle("hidden", !open);
    this.shadow.querySelector(".launcher").classList.toggle("hidden", open);
    if (open) this.runtime.refreshStatus?.();
  }

  banner() {
    const reason = this.state.pauseReason || this.state.error;
    if (reason) return `<div class="banner ${this.state.error ? "error" : "warn"}">${escapeHtml(reason)}</div>`;
    return `<div class="banner">Controller bridge: ${escapeHtml(this.state.bridgeHealth || "checking")}</div>`;
  }

  renderViews() {
    const content = this.shadow.querySelector(".content");
    this.shadow.querySelector(".top h2").textContent = this.activeSection;
    const render = this[`render${this.activeSection.replaceAll(" ", "")}`]?.bind(this) ?? (() => "");
    content.innerHTML = this.banner() + render();
    this.bindViewActions(content);
  }

  renderDashboard() {
    const s = this.state;
    return `<div class="grid">${[
      ["Status", s.runStatus || "idle"], ["Step", s.currentStep || "—"], ["Iterations", `${s.iterations || 0}/${s.maxIterations || 0}`],
      ["SBCs", s.sbcCompleted || 0], ["Packs", s.packsOpened || 0], ["Duplicates", s.duplicatesRecycled || 0],
      ["Storage", `${s.storageCount || 0}/${s.storageCapacity || "?"}`], ["Unassigned", s.unassignedCount || 0], ["Protected saved", s.protectedCardsSaved || 0],
    ].map(([label,value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="metric">${escapeHtml(value)}</div></div>`).join("")}</div><div class="controls"><button class="action" data-action="pause">Pause</button><button class="action primary" data-action="resume">Resume</button><button class="action danger" data-action="stop">Stop</button><button class="action" data-action="refresh">Refresh</button></div>`;
  }

  renderSBCSolver() { return `<div class="card"><p>Der bewährte AutoPilot-Solver bleibt der Produktionsstandard.</p><p class="hint">Solve Squad, Multi Solve und Solve Entire Set bleiben in den vorhandenen SBC-Ansichten erreichbar. GrindPilot ergänzt diese Funktionen um persistente Workflows und Schutzrichtlinien.</p><button class="action" data-action="legacy-sequence">Open legacy sequence planner</button></div>`; }

  renderWorkflows() {
    const cfg = this.state.draft || {};
    return `<div class="form"><div class="field"><label>Mode</label><select data-field="mode"><option>REVIEW</option><option ${cfg.mode === "ASSISTED" ? "selected" : ""}>ASSISTED</option><option ${cfg.mode === "AUTO" ? "selected" : ""}>AUTO</option></select></div><div class="field"><label>Iterations (hard limit)</label><input data-field="maxIterations" type="number" min="1" max="1000" value="${escapeHtml(cfg.maxIterations || 1)}"></div><div class="field"><label>Protect rating at or above</label><input data-field="protectRatingAtOrAbove" type="number" min="1" max="99" value="${escapeHtml(cfg.protectRatingAtOrAbove || 94)}"></div><div class="field"><label>Reward packs</label><select data-field="packMode"><option>OPEN_CURRENT_REWARD</option><option>OPEN_MATCHING_PACKS</option><option>OPEN_ALL_ALLOWED_PACKS</option></select></div><div class="field full"><label>Protected card types (comma-separated)</label><input data-field="protectedCardTypes" value="${escapeHtml((cfg.protectedCardTypes || []).join(", "))}" placeholder="FOF, FUTTIES, ICON"></div><div class="field"><label>Player pick policy</label><select data-field="pickMode"><option>PAUSE_FOR_USER</option><option>HIGHEST_RATING</option><option>HIGHEST_VALUE</option><option>PREFER_NON_DUPLICATE</option><option>PREFER_REQUIRED_SPECIAL</option></select></div><div class="field"><label>Duplicate fallback</label><select disabled><option>PAUSE / SAFE HOLD</option></select></div></div><div class="controls"><button class="action primary" data-action="start">Start workflow</button></div><p class="hint">MVP loop: Solve → Submit → Claim → Open correlated reward → Resolve items → repeat. REVIEW does not submit; ASSISTED pauses before destructive steps; AUTO requires one explicit run confirmation.</p>`;
  }

  renderProfiles() { return `<div class="controls"><button class="action" data-action="save-profile">Save current profile</button><button class="action" data-action="export-profile">Export</button><label class="action">Import<input data-action="import-profile" type="file" accept="application/json" hidden></label></div>${(this.state.profiles || []).length ? (this.state.profiles || []).map((p) => `<div class="card"><b>${escapeHtml(p.name)}</b><div class="hint">${escapeHtml(p.id)}</div><button class="action" data-load-profile="${escapeHtml(p.id)}">Load</button></div>`).join("") : '<div class="empty">No saved grind profiles yet.</div>'}`; }

  renderInventory() { const i=this.state.inventory||{}; return `<div class="grid"><div class="card"><div class="label">Club</div><div class="metric">${i.clubCount||0}</div></div><div class="card"><div class="label">SBC Storage</div><div class="metric">${i.storageCount||0}</div></div><div class="card"><div class="label">Free slots</div><div class="metric">${i.storageFreeSlots ?? "?"}</div></div><div class="card"><div class="label">Unassigned</div><div class="metric">${i.unassignedCount||0}</div></div></div><div class="controls"><button class="action" data-action="inventory">Synchronize</button></div>`; }
  renderProtectedCards() { return `<div class="card"><b>Fail-closed conservation</b><p class="hint">Protected owned item IDs, resource IDs, ratings, card types, starting squad, favourites, tradables and per-rating reserves are removed from the candidate pool before solve and rechecked before submit.</p></div>`; }
  renderTargetProjects() { const projects=this.state.projects||[]; return projects.length ? projects.map((p)=>`<div class="card"><b>${escapeHtml(p.name)}</b><div class="hint">Priority ${escapeHtml(p.priority)} · ${escapeHtml(p.requiredSquadsRemaining)} squads remaining</div></div>`).join("") : '<div class="empty">No active target projects. Profiles can carry arbitrary project protection policies.</div>'; }
  renderActivity() { const logs=(this.state.logs||[]).slice(-200).reverse(); return logs.length ? logs.map((e)=>`<div class="log"><span class="muted">${escapeHtml((e.timestamp||"").slice(11,19))}</span><b>${escapeHtml(e.action)}</b><span>${escapeHtml(e.message)}</span></div>`).join("") : '<div class="empty">No activity yet.</div>'; }
  renderSettings() { return `<div class="card"><b>Safety defaults</b><p class="hint">No pack purchases, no market automation, no credential persistence, no automatic quicksell. Ambiguous EA state always pauses.</p></div>`; }
  renderDeveloper() { const d=this.state.diagnostics||{}; return `<div class="form"><div class="field"><label><input data-field="developerMode" type="checkbox" ${d.enabled ? "checked" : ""}> Developer Mode</label></div></div><div class="controls"><button class="action" data-action="diagnostic-snapshot">Take snapshot</button><button class="action" data-action="diagnostic-export">Export diagnostics</button></div><textarea readonly>${escapeHtml(JSON.stringify(d.latest || d, null, 2))}</textarea><p class="hint">Instrumentation remains dormant while Developer Mode is disabled. Export is redacted and excludes request bodies, headers and credentials.</p>`; }

  readDraft(root) {
    const get = (name) => root.querySelector(`[data-field="${name}"]`);
    return { mode:get("mode")?.value||"REVIEW", maxIterations:Number(get("maxIterations")?.value||1), protectRatingAtOrAbove:Number(get("protectRatingAtOrAbove")?.value||94), protectedCardTypes:String(get("protectedCardTypes")?.value||"").split(",").map(v=>v.trim()).filter(Boolean), packMode:get("packMode")?.value||"OPEN_CURRENT_REWARD", pickMode:get("pickMode")?.value||"PAUSE_FOR_USER" };
  }

  bindViewActions(root) {
    root.querySelectorAll("[data-action]").forEach((node) => node.addEventListener(node.tagName === "INPUT" ? "change" : "click", async () => {
      const action=node.dataset.action;
      try {
        if(action==="start") await this.runtime.start(this.readDraft(root));
        else if(action==="pause") await this.runtime.pause(); else if(action==="resume") await this.runtime.resume(); else if(action==="stop") await this.runtime.stop();
        else if(action==="refresh") await this.runtime.refreshStatus(); else if(action==="inventory") await this.runtime.refreshInventory();
        else if(action==="legacy-sequence") globalThis.window?.eaData?.openSequencePlanner?.();
        else if(action==="save-profile") await this.runtime.saveDraftProfile(); else if(action==="export-profile") downloadJson("grindpilot-profile.json", await this.runtime.exportCurrentProfile());
        else if(action==="import-profile") { const file=node.files?.[0]; if(file) await this.runtime.importProfile(await file.text()); }
        else if(action==="diagnostic-snapshot") await this.runtime.takeDiagnosticSnapshot(); else if(action==="diagnostic-export") downloadJson("grindpilot-diagnostics.json", await this.runtime.exportDiagnostics());
      } catch(error) { this.runtime.reportUiError(error); }
    }));
    root.querySelectorAll("[data-load-profile]").forEach((node)=>node.addEventListener("click",()=>this.runtime.loadProfile(node.dataset.loadProfile)));
    const dev=root.querySelector('[data-field="developerMode"]'); if(dev) dev.addEventListener("change",()=>this.runtime.setDeveloperMode(dev.checked));
  }

  dispose() { this.unsubscribe?.(); this.host.remove(); }
}

