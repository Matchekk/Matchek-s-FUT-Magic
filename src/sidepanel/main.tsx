import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "./styles.css";

type PrimaryRoute = "home" | "projects" | "club" | "more";
type Route = PrimaryRoute | "protection";
type Command = { type: string; section?: string; projectId?: string; planId?: string };

type SbcPlanViewModel = {
  id: string;
  state: string;
  status: string;
  challengeName: string | null;
  targetRating: number | null;
  selectedCount: number;
  cards: Array<{
    name: string | null;
    rating: number;
    location: string;
    isSpecial: boolean;
    isDuplicate: boolean;
    isTradable: boolean;
  }>;
  ratingRange: { min: number; max: number } | null;
  specialCount: number;
  duplicateCount: number;
  storageCount: number;
  protectedCount: number;
  selectedProtectedCount: number | null;
  explanations: string[];
  blockers: Array<{ code: string; message: string }>;
  canApprove: boolean;
  approvalLabel: string;
  notice: string | null;
};

type DuplicateRouteViewModel = {
  id: string | null;
  state: string;
  status: string;
  totalCount: number;
  safeCount: number;
  toClubCount: number;
  toStorageCount: number;
  attentionCount: number;
  cards: Array<{
    name: string | null;
    rating: number;
    isSpecial: boolean;
    isTradable: boolean | null;
    action: string;
    destination: string;
    reason: string;
  }>;
  explanations: string[];
  blockers: Array<{ code: string; message: string }>;
  canApprove: boolean;
  approvalLabel: string;
  notice: string | null;
};

type RouterRecommendationViewModel = {
  status: "ready" | "attention" | "clear" | "blocked" | "expired";
  kind: "keep" | "move_to_club" | "move_to_sbc_storage" | "reserve" | "pause" | "ask_user";
  title: string;
  reason: string;
  evidence: string;
  observedAt: number;
  card: {
    name: string | null;
    rating: number;
    isSpecial: boolean;
    isTradable: boolean;
  } | null;
  destination: "club" | "sbc_storage" | "unassigned" | null;
  readOnly: true;
};

type CompatibilityViewModel = {
  gameVersion: "fc27" | "unknown";
  versionState: "observed" | "unknown";
  contextState: "verified" | "unverified";
  planningState: "observe_only" | "unavailable";
  gameLabel: string;
  title: string;
  message: string;
};

type ProjectViewModel = {
  id: string;
  name: string;
  state: string;
  completedSquads: number;
  totalSquads: number | null;
  progress: number | null;
  requiredSquadsRemaining: number;
  remainingRatings: Array<{ rating: number; needed: number; exactRatingInClub: number | null }>;
  remainingSpecials: Array<{ type: string; needed: number }>;
  protectionSummary: string[];
  source: string;
  unknownRequirementCount: number;
  preview: SbcPlanViewModel | null;
  planNotice: string | null;
};

type RunViewModel = {
  title: string;
  modeLabel: string;
  status: string;
  progress: { current: number; total: number | null; label: string };
  currentStep: { label: string; status: string } | null;
  nextStep: { label: string } | null;
  timeline: Array<{ label: string; status: string; active: boolean }>;
  guard: { state: string; label: string; reason: string | null };
  intervention: { title: string; message: string } | null;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
};

type AppViewModel = {
  protocolVersion: number;
  revision: number;
  observedAt: number;
  brand: { name: string; paidName: string; plan: "free" | "pro" };
  connection: { state: string; label: string };
  context: {
    gameVersion: string;
    state: "verified" | "unverified";
    challengeKind: "classic_squad" | "streamlined_score" | "unknown";
    gameVersionObservation: "observed" | "compatibility_default" | "unverified";
    gameVersionSource: string | null;
    route: string | null;
    setId: string | null;
    setName: string | null;
    challengeId: string | null;
    challengeName: string | null;
    observedAt: number;
    evidence: unknown;
  };
  compatibility: CompatibilityViewModel | null;
  notice: { tone: string; title: string; message: string } | null;
  run: RunViewModel | null;
  projects: ProjectViewModel[];
  activeProject: ProjectViewModel | null;
  clubHealth: {
    available: boolean;
    clubCount: number | null;
    unassignedCount: number | null;
    duplicateGroupCount: number | null;
    storage: { used: number | null; capacity: number | null; free: number | null };
    ratingBands: Array<{ label: string; club: number; storage: number }>;
    protectedCount: number | null;
  };
  duplicateRoute: DuplicateRouteViewModel | null;
  routerRecommendation: RouterRecommendationViewModel | null;
  protection: {
    status: "idle" | "ready" | "unverified" | "blocked";
    observedAt: number;
    verificationMessage: string;
    uniqueHardProtectedCount: number | null;
    analyzedItemCount: number | null;
    reasonGroups: Array<{
      code: string;
      label: string;
      count: number;
      examples: Array<{ name: string; rating: number; location: string }>;
    }>;
    ratingReserves: Array<{ rating: number; minimum: number; observedCount: number | null }>;
    specialReserves: Array<{ cardType: string; minimum: number; observedCount: number | null }>;
    projectSignals: Array<{
      name: string;
      hardExclusions: string[];
      conservationPreferences: string[];
      unknownRequirementCount: number;
    }>;
    preferences: Array<{ id: string; label: string; enabled: boolean }>;
    evidenceWarnings: string[];
    advancedActive: boolean;
  };
  actions: Array<{
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    disabledReason?: string;
    command: Command | null;
    plan: "free" | "pro";
  }>;
  legal: {
    disclaimer: string;
    license: string;
    sourceUrl: string;
    licenseUrl: string;
    privacyUrl: string;
    noticesUrl: string;
    warranty: string;
  };
};

const iconPaths: Record<string, string> = {
  home: "M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  projects: "M5 5.5A1.5 1.5 0 0 1 6.5 4h3l1.5 2H18a1 1 0 0 1 1 1v11.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5z",
  club: "M12 3 4.5 6v5.5c0 4.5 3 7.6 7.5 9.5 4.5-1.9 7.5-5 7.5-9.5V6zm0 4.2 2 1.5-.75 2.35.75 2.35-2 1.45-2-1.45.75-2.35L10 8.7z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  chevron: "m9 5 7 7-7 7",
  back: "m15 5-7 7 7 7",
  alert: "M12 4 3.5 19h17zM12 9v4.5M12 17h.01",
  check: "m5 12 4 4L19 6",
  refresh: "M20 6v5h-5M4 18v-5h5M18.5 10A7 7 0 0 0 6.2 7.5L4 11m16 2-2.2 3.5A7 7 0 0 1 5.5 14",
  sbc: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h3",
  recycle: "M7.2 7.4A6.5 6.5 0 0 1 18 9l1.5-2M18 9l-3-.5M16.8 16.6A6.5 6.5 0 0 1 6 15l-1.5 2M6 15l3 .5",
  duplicate: "M8 8h11v11H8zM5 16V5h11",
  protect: "M12 3 19 6v5.5c0 4.3-2.8 7.2-7 9.1-4.2-1.9-7-4.8-7-9.1V6zM9 12l2 2 4-4",
  evolution: "M7 18 17 6M10 6h7v7M5 8v10h10",
  optimize: "M4 17l5-5 4 3 7-8M16 7h4v4",
  pause: "M9 7v10M15 7v10",
  stop: "M8 8h8v8H8z",
  activity: "M4 12h4l2-5 4 10 2-5h4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 13.5l1.5 1.2-2 3.4-1.8-.7a7 7 0 0 1-2.2 1.3l-.3 1.9h-4l-.3-1.9a7 7 0 0 1-2.2-1.3l-1.8.7-2-3.4L5.5 13.5a7 7 0 0 1 0-3L4 9.3l2-3.4 1.8.7a7 7 0 0 1 2.2-1.3l.3-1.9h4l.3 1.9a7 7 0 0 1 2.2 1.3l1.8-.7 2 3.4-1.5 1.2a7 7 0 0 1 0 3z",
  spark: "M12 3c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z",
  dot: "M12 12h.01",
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={iconPaths[name]} /></svg>;
}

function BrandMark() {
  return <svg class="brand-mark" aria-hidden="true" viewBox="0 0 128 128" fill="none">
    <path d="M34 91 27 36l56-12-5 15-34 7 5 39c15 2 30-2 42-11" stroke="var(--fm-accent-primary)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M25 96c26 7 55 1 74-20" stroke="var(--fm-accent-secondary)" stroke-width="8" stroke-linecap="round" />
    <path d="m91 72 11 1-3 11" stroke="var(--fm-accent-secondary)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M99 27c0 8-4 12-12 12 8 0 12 4 12 12 0-8 4-12 12-12-8 0-12-4-12-12Z" fill="var(--fm-text-primary)" />
  </svg>;
}

function BrandLockup({ plan, compact = false }: { plan?: "free" | "pro"; compact?: boolean }) {
  if (!compact) return <div class="brand-lockup brand-lockup-full">
    <BrandMark />
    <span class="brand-wordmark brand-wordmark-full"><b>FUT</b> <strong>Magic</strong></span>
    {plan === "pro" ? <ProBadge /> : null}
  </div>;
  return <div class={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
    <BrandMark />
    <span class="brand-wordmark"><b>FUT</b> <strong>Magic</strong></span>
    {plan === "pro" ? <ProBadge /> : null}
  </div>;
}

function ProBadge() {
  return <span class="pro-label" aria-label="FUT Magic Pro">Pro</span>;
}

function StatusBadge({ state, children }: { state: string; children: preact.ComponentChildren }) {
  return <span class={`state-label state-${state}`}><span class="state-dot" />{children}</span>;
}

const actionIcon: Record<string, string> = {
  "complete-sbc": "sbc",
  "grind-upgrades": "recycle",
  "clear-duplicates": "duplicate",
  "protect-cards": "protect",
  "plan-evolution": "evolution",
  "optimize-club": "optimize",
};

function ActionIcon({ actionId }: { actionId: string }) {
  return <span class="action-symbol" aria-hidden="true"><Icon name={actionIcon[actionId] || "spark"} size={18} /></span>;
}

function CompatibilityStatus({ compatibility }: { compatibility: CompatibilityViewModel | null }) {
  if (!compatibility) return null;
  const stateLabel = compatibility.planningState === "observe_only"
    ? `${compatibility.gameLabel} · Observe only`
    : `${compatibility.gameLabel} · Planning off`;
  return <section class={`compatibility-status compatibility-${compatibility.versionState}`} aria-labelledby="compatibility-title" aria-describedby="compatibility-message" role="status">
    <div class="compatibility-copy"><h2 id="compatibility-title">{compatibility.title}</h2><p id="compatibility-message">{compatibility.message}</p></div>
    <span class="compatibility-state" aria-label={`Compatibility state: ${stateLabel}`}>{stateLabel}</span>
  </section>;
}

const request = (action: "SNAPSHOT" | "COMMAND", command?: Command): Promise<AppViewModel> =>
  new Promise((resolve, reject) => {
    const requestId = `fm-panel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error("FUT Magic extension messaging is unavailable"));
      return;
    }
    chrome.runtime.sendMessage({ type: "FUT_MAGIC_PANEL_REQUEST_V1", requestId, action, command }, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) {
        reject(new Error(error?.message || response?.error?.message || "FUT Magic could not reach the EA Web App"));
      } else if (response?.requestId !== requestId) {
        reject(new Error("FUT Magic received a mismatched panel response"));
      } else if (response?.data?.protocolVersion !== 1) {
        reject(new Error("FUT Magic received an unsupported panel protocol"));
      } else resolve(response.data as AppViewModel);
    });
  });

const formatValue = (value: number | null) => value == null ? "—" : value.toLocaleString();
const percent = (value: number | null) => value == null ? null : Math.round(value * 100);

function Progress({ value, label }: { value: number | null; label: string }) {
  const known = value != null && Number.isFinite(value);
  const numeric = Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
  return <div class={`progress-track${known ? "" : " progress-unknown"}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? numeric : undefined} aria-valuetext={known ? `${numeric}%` : "Progress unavailable"}><span style={{ transform: `scaleX(${numeric / 100})` }} /></div>;
}

function RunCard({ run, onCommand }: { run: RunViewModel; onCommand: (command: Command) => Promise<void> }) {
  const total = run.progress.total;
  const ratio = total ? run.progress.current / total : 0;
  return <section class="focus-surface" aria-labelledby="active-run-title">
    <div class="row between start">
      <div><p class="kicker">Active run</p><h2 id="active-run-title">{run.title}</h2></div>
      <StatusBadge state={run.guard.state}>{run.status === "recovery_required" ? "Needs review" : run.status}</StatusBadge>
    </div>
    <div class="row between run-progress"><span>{run.progress.current}{total ? ` of ${total}` : ""} {run.progress.label}</span><span class="secondary">{run.modeLabel}</span></div>
    <Progress value={ratio} label="Run progress" />
    {run.intervention ? <div class="inline-warning" role="status"><Icon name="alert" size={18} /><div><strong>{run.intervention.title}</strong><p>{run.intervention.message}</p></div></div> : null}
    <ol class="run-steps">
      {run.timeline.filter((step) => step.status === "completed" || step.active || step.status === "pending").slice(0, 5).map((step) =>
        <li class={step.active ? "current" : step.status === "completed" ? "complete" : "pending"}><span class="step-icon"><Icon name={step.status === "completed" ? "check" : step.active ? "chevron" : "dot"} size={15} /></span>{step.label}</li>)}
    </ol>
    <div class="row between guard-row"><span>Activity Guard</span><strong>{run.guard.label}</strong></div>
    <div class="button-row">{run.canPause ? <button onClick={() => onCommand({ type: "PAUSE_RUN" })}><Icon name="pause" size={17} />Pause</button> : null}{run.canResume ? <button class="primary" onClick={() => onCommand({ type: "RESUME_RUN" })}><Icon name="refresh" size={17} />Resume</button> : null}{run.canStop ? <button class="danger-quiet" onClick={() => onCommand({ type: "STOP_RUN" })}><Icon name="stop" size={17} />Stop</button> : null}</div>
  </section>;
}

function ProjectSummary({ project, onOpen }: { project: ProjectViewModel; onOpen?: () => void }) {
  const completion = percent(project.progress);
  const content = <>
    <div class="row between start"><div class="truncate"><h3>{project.name}</h3><p class="secondary">{project.totalSquads ? `${project.completedSquads} of ${project.totalSquads} squads` : `${project.requiredSquadsRemaining} squads remaining`}</p></div>{onOpen ? <Icon name="chevron" size={18} /> : null}</div>
    <Progress value={project.progress} label={`${project.name} progress`} />
    <div class="row between metadata"><span>{completion == null ? "Progress recorded locally" : `${completion}% complete`}</span><span>{project.source === "ea_import" ? "Synced from EA" : "Manual project"}</span></div>
  </>;
  return onOpen ? <button class="project-row" data-project-id={project.id} onClick={onOpen}>{content}</button> : <div class="project-summary">{content}</div>;
}

function Home({ vm, onCommand, go, openProtection }: { vm: AppViewModel; onCommand: (command: Command) => Promise<void>; go: (route: Route) => void; openProtection: () => void }) {
  return <div class="screen" aria-labelledby="home-title">
    <h1 id="home-title" tabIndex={-1}>Home</h1>
    {vm.notice ? <section class={`notice notice-${vm.notice.tone}`} role={vm.notice.tone === "error" ? "alert" : "status"}><Icon name="alert" size={20} /><div><strong>{vm.notice.title}</strong><p>{vm.notice.message}</p></div></section> : null}
    {vm.run ? <RunCard run={vm.run} onCommand={onCommand} /> : null}
    {!vm.run && vm.activeProject ? <section class="focus-surface"><p class="kicker">Current project</p><ProjectSummary project={vm.activeProject} /><button class={`${vm.compatibility ? "" : "primary "}wide`} onClick={() => go("projects")}>{vm.compatibility ? "View project" : "Continue project"}</button></section> : null}
    {vm.context.challengeName ? <section class="context-line"><span class="context-icon"><Icon name="projects" size={18} /></span><div><span class="secondary">Open in EA</span><strong>{vm.context.challengeName}</strong></div></section> : null}
    <section class="section-block" aria-labelledby="goals-title"><h2 id="goals-title">What do you want to do?</h2><div class="action-list">{vm.actions.map((action) => <button class={`action-row${action.plan === "pro" ? " action-row-pro" : ""}`} data-protection-entry={action.id === "protect-cards" ? "home" : undefined} disabled={!action.enabled} aria-describedby={!action.enabled ? `${action.id}-reason` : undefined} onClick={async () => { if (!action.command) return; if (action.id === "protect-cards" && action.command.type === "PREVIEW_FODDER_REVIEW") { openProtection(); return; } await onCommand(action.command); if (action.id === "complete-sbc" && action.command.type === "PREVIEW_SBC_PROJECT") go("projects"); if (action.id === "clear-duplicates" && action.command.type === "PREVIEW_CLEAR_DUPLICATES") go("club"); }}><ActionIcon actionId={action.id} /><span class="action-copy"><strong>{action.label}</strong><span id={`${action.id}-reason`}>{action.enabled ? action.description : action.disabledReason}</span></span>{action.plan === "pro" ? <ProBadge /> : <Icon name="chevron" size={18} />}</button>)}</div></section>
  </div>;
}

function SbcPlanPreview({ project, onCommand, planningBlockedReason }: { project: ProjectViewModel; onCommand: (command: Command) => Promise<void>; planningBlockedReason?: string | null }) {
  const plan = project.preview;
  if (planningBlockedReason) return <section class="plan-actions" aria-labelledby="plan-unavailable-title">
    <h2 id="plan-unavailable-title">Planning unavailable</h2>
    <p class="secondary plan-copy">{planningBlockedReason}</p>
    <p class="migration-copy">Project progress remains visible. No EA action is available.</p>
  </section>;
  if (!plan) return <section class="plan-actions" aria-labelledby="plan-title">
    <h2 id="plan-title">Current squad</h2>
    {project.planNotice ? <div class="inline-warning" role="status"><Icon name="alert" size={18} /><div><strong>Preview expired</strong><p>{project.planNotice}</p></div></div> : null}
    <p class="secondary plan-copy">Build a read-only proposal from the open EA challenge and your latest Club snapshot.</p>
    <button class="primary wide" onClick={() => onCommand({ type: "PREVIEW_SBC_PROJECT", projectId: project.id })}>Preview current squad</button>
    <p class="migration-copy">No cards are changed during preview.</p>
  </section>;
  if (!plan.canApprove) return <section class="plan-actions" aria-labelledby="plan-blocked-title">
    <div class="row between"><div><p class="kicker">Protected preview</p><h2 id="plan-blocked-title">Preview blocked</h2></div><span class="state-label state-caution"><span class="state-dot" />Safe stop</span></div>
    <div class="blocker-list">{plan.blockers.map((blocker) => <p><Icon name="alert" size={17} />{blocker.message}</p>)}</div>
    <button class="wide" onClick={() => onCommand({ type: "PREVIEW_SBC_PROJECT", projectId: project.id })}>Preview again</button>
    <p class="migration-copy">Nothing was applied to the EA squad.</p>
  </section>;
  const challengeLabel = plan.challengeName || "Open challenge";
  const ratingAlreadyNamed = plan.targetRating != null &&
    new RegExp(`\\b${plan.targetRating}\\s*[-–]?\\s*rated\\b`, "i").test(challengeLabel);
  return <section class="plan-preview" aria-labelledby="plan-ready-title">
    <div class="row between start"><div><p class="kicker">Protected preview</p><h2 id="plan-ready-title">Ready to build</h2></div><span class="preview-badge"><Icon name="check" size={14} />No cards changed</span></div>
    <p class="plan-challenge">{challengeLabel}{plan.targetRating && !ratingAlreadyNamed ? ` · ${plan.targetRating} rated` : ""}</p>
    <div class="plan-metrics" aria-label="Squad preview summary"><div><b>{plan.selectedCount}</b><span>cards</span></div><div><b>{plan.specialCount ? plan.specialCount : plan.ratingRange ? `${plan.ratingRange.min}–${plan.ratingRange.max}` : "—"}</b><span>{plan.specialCount ? "special used" : "rating range"}</span></div><div><b>{plan.selectedProtectedCount ?? "—"}</b><span>protected used</span></div></div>
    <div class="card-strip" aria-label="Selected cards">{plan.cards.map((card, index) => <div class="preview-card"><b>{card.rating}</b><span>{card.name || `Card ${index + 1}`}</span><small>{[card.isDuplicate ? "Duplicate" : null, card.location === "sbc_storage" ? "Storage" : null, card.isSpecial ? "Special" : null].filter(Boolean).join(" · ") || "Club"}</small></div>)}</div>
    {plan.explanations.length ? <details><summary>Why these cards?</summary><div class="plan-explanations">{plan.explanations.map((line) => <p>{line}</p>)}</div></details> : null}
    <button class="primary wide" aria-describedby="approval-explanation" onClick={() => onCommand({ type: "APPROVE_SBC_PLAN", projectId: project.id, planId: plan.id })}>{plan.approvalLabel}</button>
    <p class="approval-copy" id="approval-explanation">Refreshes, verifies, then submits one re-solved squad. EA submissions cannot be undone.</p>
  </section>;
}

function ProjectDetail({ project, back, onCommand, run, go, planningBlockedReason }: { project: ProjectViewModel; back: () => void; onCommand: (command: Command) => Promise<void>; run: RunViewModel | null; go: (route: Route) => void; planningBlockedReason?: string | null }) {
  return <div class="screen detail-screen" aria-labelledby="project-title"><button class="back-button" onClick={back}><Icon name="back" size={18} />Projects</button><h1 id="project-title" tabIndex={-1}>{project.name}</h1><p class="subtitle">{project.totalSquads ? `${project.completedSquads} of ${project.totalSquads} squads` : `${project.requiredSquadsRemaining} squads remaining`}</p><Progress value={project.progress} label={`${project.name} progress`} />
    {run ? <div class="inline-warning" role="status"><Icon name="refresh" size={18} /><div><strong>{run.title}</strong><p>{run.currentStep?.label || run.status} · <button class="inline-link" onClick={() => go("home")}>View run</button></p></div></div> : <SbcPlanPreview project={project} onCommand={onCommand} planningBlockedReason={planningBlockedReason} />}
    <section class="section-block"><h2>Remaining</h2>{project.remainingRatings.length ? <div class="value-list">{project.remainingRatings.map((item) => <div class="value-row"><span class="rating">{item.rating}</span><span>Need {item.needed}</span><span class="secondary">Club {formatValue(item.exactRatingInClub)}</span></div>)}</div> : <p class="empty-copy">No exact rating demand is recorded.</p>}</section>
    {project.remainingSpecials.length ? <section class="section-block"><h2>Special cards</h2><div class="value-list">{project.remainingSpecials.map((item) => <div class="value-row"><span>{item.type.toUpperCase()}</span><span>Need {item.needed}</span></div>)}</div></section> : null}
    <section class="section-block"><h2>Protection</h2>{project.protectionSummary.map((line) => <p class="explanation"><Icon name="check" size={17} />{line}</p>)}</section>
    <div class="stacked-actions"><button disabled={Boolean(planningBlockedReason)} onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section: "Target Projects" })}>Open project tools</button><p class="migration-copy">{planningBlockedReason || "Advanced import, sync, and reserve controls."}</p><button class="pro-control" disabled>Optimize entire project <ProBadge /></button><p class="disabled-copy">FUT Magic Pro optimization is not connected in this build.</p></div>
  </div>;
}

function Projects({ vm, onCommand, go }: { vm: AppViewModel; onCommand: (command: Command) => Promise<void>; go: (route: Route) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => vm.projects.find((project) => project.preview)?.id || null);
  const restoreProjectId = useRef<string | null>(null);
  const selected = vm.projects.find((project) => project.id === selectedId) || null;
  const planningBlockedReason = vm.compatibility?.gameVersion === "fc27"
    ? "FC 27 planning is not verified in this build."
    : vm.compatibility ? "Confirm the game version before planning." : null;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedId) {
        document.querySelector<HTMLElement>("#project-title")?.focus();
        return;
      }
      const restoreId = restoreProjectId.current;
      restoreProjectId.current = null;
      if (restoreId) document.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(restoreId)}"]`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId]);
  if (selected) return <ProjectDetail project={selected} back={() => { restoreProjectId.current = selected.id; setSelectedId(null); }} onCommand={onCommand} run={vm.run} go={go} planningBlockedReason={planningBlockedReason} />;
  return <div class="screen" aria-labelledby="projects-title"><div class="row between"><h1 id="projects-title" tabIndex={-1}>Projects</h1><button class="icon-button" aria-label="Import the open SBC" disabled={Boolean(planningBlockedReason)} onClick={() => onCommand({ type: "IMPORT_CURRENT_SBC_PROJECT" })}>+</button></div><p class="subtitle">{planningBlockedReason || "Protect a long-term target while you grind."}</p>{vm.projects.length ? <div class="project-list">{vm.projects.map((project) => <ProjectSummary project={project} onOpen={() => setSelectedId(project.id)} />)}</div> : <section class="empty-state"><BrandMark /><h2>No active projects</h2><p>{planningBlockedReason || "Open an SBC set in EA, then import it here. Unknown requirements will stay unknown."}</p><button class="primary" disabled={Boolean(planningBlockedReason)} onClick={() => onCommand({ type: "IMPORT_CURRENT_SBC_PROJECT" })}>Import open SBC</button></section>}</div>;
}

function RecommendedNext({ recommendation, batchSafeCount = 0 }: { recommendation: RouterRecommendationViewModel | null; batchSafeCount?: number }) {
  if (!recommendation) return null;
  const includedInBatch = batchSafeCount > 0 && ["move_to_club", "move_to_sbc_storage"].includes(recommendation.kind);
  const statusLabel = {
    ready: "Verified suggestion",
    attention: "Needs attention",
    clear: "Clear",
    blocked: "Blocked",
    expired: "Expired",
  }[recommendation.status];
  const subject = recommendation.card
    ? `${recommendation.card.rating || "—"} ${recommendation.card.name || "Unidentified card"}${recommendation.card.isSpecial ? " · Special" : ""}${recommendation.card.isTradable === true ? " · Tradable" : recommendation.card.isTradable === false ? " · Untradeable" : ""}`
    : null;
  const evidence = String(recommendation.evidence || "").trim();
  const reason = String(recommendation.reason || "").trim();
  const showEvidence = evidence && evidence !== reason;
  const observed = Number.isFinite(recommendation.observedAt) && recommendation.observedAt > 0
    ? `Checked ${new Date(recommendation.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Freshness unavailable";
  return <section class={`recommended-next recommendation-${recommendation.status}`} aria-labelledby="recommended-next-title">
    <div class="recommended-next-heading"><p>{includedInBatch ? "Priority within this batch" : "Recommended next"}</p><span>{statusLabel}</span></div>
    <h3 id="recommended-next-title">{recommendation.title}</h3>
    {subject ? <p class="recommended-subject">{subject}</p> : null}
    <p class="recommended-reason">{reason}</p>
    <p class="recommended-readonly">{includedInBatch ? `Already included in the ${batchSafeCount}-item approval above. This is a read-only priority, not a second action. Nothing changes automatically.` : "Suggestion only — nothing changes automatically."}</p>
    {showEvidence ? <details><summary><span>Why this recommendation?</span><Icon name="chevron" size={17} /></summary><p>{evidence}</p></details> : null}
    <small class="recommended-observed">{observed}</small>
  </section>;
}

function DuplicateRoutePreview({ vm, onCommand }: { vm: AppViewModel; onCommand: (command: Command) => Promise<void> }) {
  const plan = vm.duplicateRoute;
  const recommendation = vm.routerRecommendation;
  if (!plan) {
    return vm.clubHealth.unassignedCount ? <section class="plan-actions" aria-labelledby="route-title">
      <p class="kicker">Safe route</p><h2 id="route-title">Review Unassigned items</h2>
      <p class="secondary plan-copy">Preview one bounded set of verified moves to Club or SBC Storage.</p>
      <button class="primary wide" onClick={() => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" })}>Review safe route</button>
      <p class="migration-copy">Preview changes nothing. It does not build or submit an SBC, use Organizer, open a pack, or quicksell.</p>
      <RecommendedNext recommendation={recommendation} />
    </section> : <section class="plan-actions" aria-labelledby="route-clear-title"><p class="kicker">Safe route</p><h2 id="route-clear-title">Unassigned is clear</h2><p class="secondary plan-copy">There are no current items to route.</p><RecommendedNext recommendation={recommendation} /></section>;
  }
  if (plan.status === "expired") return <section class="plan-actions" aria-labelledby="route-expired-title">
    <p class="kicker">Safe route</p><h2 id="route-expired-title">Preview expired</h2>
    <div class="inline-warning" role="status"><Icon name="alert" size={18} /><div><strong>Nothing moved</strong><p>{plan.notice}</p></div></div>
    <button class="wide" onClick={() => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" })}>Preview again</button>
    <RecommendedNext recommendation={recommendation} />
  </section>;
  if (!plan.canApprove) return <section class="plan-actions" aria-labelledby="route-blocked-title">
    <div class="row between"><div><p class="kicker">Safe route</p><h2 id="route-blocked-title">{plan.status === "clear" ? "Unassigned is clear" : "Preview blocked"}</h2></div><span class="state-label state-caution"><span class="state-dot" />Safe stop</span></div>
    {plan.blockers.length ? <div class="blocker-list">{plan.blockers.map((blocker) => <p><Icon name="alert" size={17} />{blocker.message}</p>)}</div> : <p class="secondary plan-copy">There are no verified moves to apply.</p>}
    <button class="wide" onClick={() => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" })}>Preview again</button>
    <p class="migration-copy">Nothing was moved.</p>
    <RecommendedNext recommendation={recommendation} />
  </section>;
  const safeCards = plan.cards.filter((card) => ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(card.action));
  const heldCards = plan.cards.filter((card) => !["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(card.action));
  return <section class="plan-preview route-preview" aria-labelledby="route-ready-title">
    <div class="row between start"><div><p class="kicker">Safe route</p><h2 id="route-ready-title">Ready to move</h2></div><span class="preview-badge"><Icon name="check" size={14} />No cards changed</span></div>
    <div class="plan-metrics" aria-label="Safe route summary"><div><b>{plan.toClubCount}</b><span>to Club</span></div><div><b>{plan.toStorageCount}</b><span>to Storage</span></div><div><b>{plan.attentionCount}</b><span>need attention</span></div></div>
    <div class="route-group"><h3>Safe moves</h3><div class="card-strip" aria-label="Approved safe moves">{safeCards.map((card, index) => <div class="preview-card"><b>{card.rating}</b><span>{card.name || `Card ${index + 1}`}</span><small>{card.destination === "club" ? "Move to Club" : "Move to SBC Storage"} · {card.reason}</small></div>)}</div></div>
    {heldCards.length ? <div class="route-group attention-group"><h3>Stays Unassigned</h3><div class="card-strip" aria-label="Items needing attention">{heldCards.map((card, index) => <div class="preview-card"><b>{card.rating}</b><span>{card.name || `Card ${index + 1}`}</span><small>{card.reason}</small></div>)}</div></div> : null}
    <button class="primary wide" aria-describedby="route-approval-explanation" onClick={() => onCommand({ type: "APPROVE_CLEAR_DUPLICATES_PLAN", planId: plan.id || undefined })}>{plan.approvalLabel}</button>
    <p class="approval-copy" id="route-approval-explanation">Only the items shown under Safe moves can move. This does not build or submit an SBC, use Organizer, open a pack, or quicksell.</p>
    <RecommendedNext recommendation={recommendation} batchSafeCount={plan.safeCount} />
  </section>;
}

function Club({ vm, onCommand, openProtection }: { vm: AppViewModel; onCommand: (command: Command) => Promise<void>; openProtection: () => void }) {
  const club = vm.clubHealth;
  const storageValue = club.storage.used == null ? "—" : `${club.storage.used}/${club.storage.capacity ?? "?"}`;
  const rows = [
    ["Unassigned", formatValue(club.unassignedCount), club.unassignedCount ? "Needs attention" : "Clear"],
    ["Duplicate groups", formatValue(club.duplicateGroupCount), "Exact-version groups"],
    ["SBC Storage", storageValue, club.storage.free == null ? "Unavailable" : `${club.storage.free} spaces free`],
    ...club.ratingBands.map((band) => [band.label, formatValue(band.club + band.storage), `${band.club} Club · ${band.storage} Storage`]),
    ["Protected cards", formatValue(club.protectedCount), "Review exclusions and reserves"],
  ];
  return <div class="screen" aria-labelledby="club-title"><div class="row between"><h1 id="club-title" tabIndex={-1}>Club</h1><button class="icon-button" aria-label="Refresh club health" onClick={() => onCommand({ type: "REFRESH" })}><Icon name="refresh" size={19} /></button></div><p class="subtitle">Current Club health and one bounded Unassigned route.</p>{club.available ? <><DuplicateRoutePreview vm={vm} onCommand={onCommand} /><div class="health-list">{rows.map(([label, value, detail]) => label === "Protected cards" ? <button class="health-row health-action" data-protection-entry="club" aria-label={`Card protection, ${value}, ${detail}`} onClick={openProtection}><div><strong>Card protection</strong><span>{detail}</span></div><span class="health-action-value"><b>{value}</b><Icon name="chevron" size={18} /></span></button> : <div class="health-row"><div><strong>{label}</strong><span>{detail}</span></div><b>{value}</b></div>)}</div></> : <section class="empty-state"><h2>Club data unavailable</h2><p>Keep the EA Web App open while FUT Magic reconnects.</p><button onClick={() => onCommand({ type: "REFRESH" })}>Try again</button></section>}</div>;
}

function More({ vm, onCommand, openProtection }: { vm: AppViewModel; onCommand: (command: Command) => Promise<void>; openProtection: () => void }) {
  const items: Array<[string, string, string]> = [
    ["Recipes", "Profiles", "Saved local grind configurations"],
    ["Activity", "Activity", "Recent verified actions and explanations"],
    ["Settings", "Settings", "Safety defaults and preferences"],
  ];
  return <div class="screen" aria-labelledby="more-title"><h1 id="more-title" tabIndex={-1}>More</h1><div class="settings-list"><button class="settings-row" data-protection-entry="more" onClick={openProtection}><span class="settings-icon"><Icon name="protect" size={18} /></span><span><strong>Card protection</strong><small>Review exclusions, reserves and selection preferences</small></span><Icon name="chevron" size={18} /></button>{items.map(([label, section, description]) => <button class="settings-row" onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section })}><span class="settings-icon"><Icon name={label === "Activity" ? "activity" : label === "Settings" ? "settings" : "recycle"} size={18} /></span><span><strong>{label}</strong><small>{description}</small></span><Icon name="chevron" size={18} /></button>)}</div><section class="section-block"><h2>Advanced</h2><div class="settings-list inset"><button class="settings-row" onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section: "Workflows" })}><span><strong>Workflow recipes</strong><small>Typed steps, retry limits and custom policies</small></span><Icon name="chevron" size={18} /></button><button class="settings-row" onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section: "Developer" })}><span><strong>Capability health & diagnostics</strong><small>Adapter evidence and local support export</small></span><Icon name="chevron" size={18} /></button><button class="settings-row" onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section: "Easy Loop" })}><span><strong>Legacy tools</strong><small>Open the full migration-period panel</small></span><Icon name="chevron" size={18} /></button></div></section><section class="about"><div class="about-summary"><BrandLockup plan={vm.brand.plan} /><div class="about-copy"><p class="brand-tagline">Smarter plans. Better results.</p><p>Modified AutoPilot-SBC derivative · {vm.legal.license}</p><p>{vm.legal.warranty}</p><p>{vm.legal.disclaimer}</p></div></div><div class="legal-links"><a href={vm.legal.sourceUrl} target="_blank" rel="noreferrer">Source</a><a href={vm.legal.licenseUrl} target="_blank" rel="noreferrer">License</a><a href={vm.legal.privacyUrl} target="_blank" rel="noreferrer">Privacy</a><a href={vm.legal.noticesUrl} target="_blank" rel="noreferrer">Third-party notices</a></div></section></div>;
}

const locationLabel = (location: string) => {
  const normalized = String(location || "").toLowerCase();
  if (normalized === "sbc_storage" || normalized === "storage") return "SBC Storage";
  if (normalized === "unassigned") return "Unassigned";
  return "Club";
};

const checkedAt = (observedAt: number) => Number.isFinite(observedAt) && observedAt > 0
  ? `Checked ${new Date(observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  : "Not checked yet";

function ProtectionReview({ vm, back, backLabel, onCommand }: { vm: AppViewModel; back: () => void; backLabel: string; onCommand: (command: Command) => Promise<void> }) {
  const review = vm.protection;
  const count = review.uniqueHardProtectedCount;
  const statusTitle = review.status === "ready"
    ? count === 1 ? "1 card excluded from every solve" : `${formatValue(count)} cards excluded from every solve`
    : review.status === "blocked" ? "Protection review blocked"
      : review.status === "unverified"
        ? count == null || count === 0
          ? "Protection evidence is incomplete"
          : count === 1 ? "At least 1 exclusion verified" : `At least ${formatValue(count)} exclusions verified`
        : "Protection review not ready";
  const projectHardSignals = review.projectSignals.filter((project) => project.hardExclusions.length);
  const projectKeepSignals = review.projectSignals.filter((project) => project.conservationPreferences.length);
  const projectEvidenceWarnings = review.projectSignals
    .filter((project) => project.unknownRequirementCount > 0)
    .map((project) => `${project.name}: ${project.unknownRequirementCount} ${project.unknownRequirementCount === 1 ? "requirement is" : "requirements are"} excluded because the evidence is unverified.`);
  const evidenceWarnings = [...new Set([...review.evidenceWarnings, ...projectEvidenceWarnings])];
  const hasKeepRules = review.ratingReserves.length || review.specialReserves.length || projectKeepSignals.length || review.preferences.length;
  return <div class="screen detail-screen protection-screen" aria-labelledby="protection-title">
    <button class="back-button" onClick={back}><Icon name="back" size={18} />{backLabel}</button>
    <div class="row between start protection-heading"><div><h1 id="protection-title" tabIndex={-1}>Card protection</h1><p class="subtitle">What FUT Magic will never use—and what it tries to preserve.</p></div><button class="icon-button" aria-label="Refresh card protection review" onClick={() => onCommand({ type: "PREVIEW_FODDER_REVIEW" })}><Icon name="refresh" size={19} /></button></div>
    <section class={`protection-summary protection-summary-${review.status}`} aria-labelledby="protection-summary-title">
      <span class="protection-shield"><Icon name="club" size={22} /></span>
      <div><h2 id="protection-summary-title">{statusTitle}</h2><p>{review.verificationMessage || (review.status === "ready" ? `${formatValue(review.analyzedItemCount)} current Club and Storage cards analyzed.` : "Refresh while the EA Web App is open.")}</p><small>{checkedAt(review.observedAt)}</small></div>
    </section>
    {evidenceWarnings.length ? <section class="protection-warnings" aria-labelledby="protection-warnings-title"><h2 id="protection-warnings-title">Needs attention</h2>{evidenceWarnings.map((warning) => <p><Icon name="alert" size={17} />{warning}</p>)}</section> : null}
    <section class="protection-section" aria-labelledby="never-use-title"><h2 id="never-use-title">Never use</h2><p class="protection-intro">These cards are removed before planning and checked again before submission. A card may match several rules; the summary counts each card once.</p>
      <div class="protection-list">{review.reasonGroups.length ? review.reasonGroups.map((group) => <details class="protection-disclosure"><summary><span class="protection-row-copy"><strong>{group.label}</strong><small>{group.count === 1 ? "1 current card" : `${group.count} current cards`}</small></span><span class="protection-row-end"><b>{group.count}</b><Icon name="chevron" size={18} /></span></summary><div class="protection-detail"><p>Every card matching this rule is excluded while the rule remains active.</p>{group.examples.length ? <ul class="protection-examples">{group.examples.map((example) => <li><span class="rating">{example.rating || "—"}</span><span><strong>{example.name || "Unnamed card"}</strong><small>{locationLabel(example.location)}</small></span></li>)}</ul> : <p class="empty-copy">No card names are available in the current evidence.</p>}</div></details>) : <p class="protection-empty">No current hard exclusions were verified.</p>}
        {projectHardSignals.map((project) => <details class="protection-disclosure"><summary><span class="protection-row-copy"><strong>{project.name}</strong><small>Project exclusions</small></span><span class="protection-row-end"><b>{project.hardExclusions.length}</b><Icon name="chevron" size={18} /></span></summary><div class="protection-detail"><ul class="plain-rule-list">{project.hardExclusions.map((rule) => <li><Icon name="check" size={16} />{rule}</li>)}</ul></div></details>)}
      </div>
    </section>
    <section class="protection-section" aria-labelledby="try-keep-title"><h2 id="try-keep-title">Try to keep</h2><p class="protection-intro">These rules guide selection, but may yield when an SBC otherwise has no valid squad.</p>
      {hasKeepRules ? <div class="protection-list">
        {review.ratingReserves.map((reserve) => <div class="protection-static-row"><span class="protection-row-copy"><strong>{reserve.rating}-rated cards</strong><small>{reserve.observedCount == null ? "Current count unverified" : `${reserve.observedCount} currently observed`}</small></span><span class="protection-value">Keep {reserve.minimum}</span></div>)}
        {review.specialReserves.map((reserve) => <div class="protection-static-row"><span class="protection-row-copy"><strong>{reserve.cardType}</strong><small>{reserve.observedCount == null ? "Current count unverified" : `${reserve.observedCount} currently observed`}</small></span><span class="protection-value">Keep {reserve.minimum}</span></div>)}
        {projectKeepSignals.map((project) => <details class="protection-disclosure"><summary><span class="protection-row-copy"><strong>{project.name}</strong><small>Project preferences</small></span><span class="protection-row-end"><b>{project.conservationPreferences.length}</b><Icon name="chevron" size={18} /></span></summary><div class="protection-detail"><ul class="plain-rule-list">{project.conservationPreferences.map((rule) => <li><Icon name="check" size={16} />{rule}</li>)}</ul></div></details>)}
        {review.preferences.length ? <div class="preference-heading"><strong>When several safe squads work</strong><small>FUT Magic applies enabled preferences in the order shown.</small></div> : null}
        {review.preferences.map((preference) => <div class="protection-static-row"><span class="protection-row-copy"><strong>{preference.label}</strong><small>Selection preference</small></span><span class={`preference-state preference-${preference.enabled ? "on" : "off"}`}>{preference.enabled ? "On" : "Off"}</span></div>)}
      </div> : <p class="protection-empty">No reserve or selection preferences are configured.</p>}
    </section>
    <section class="protection-how" aria-labelledby="protection-how-title"><h2 id="protection-how-title">How protection works</h2><p><strong>Never use</strong> is an absolute exclusion. <strong>Try to keep</strong> helps choose between valid, protected-safe squads without making a solvable SBC appear impossible.</p></section>
    <button class="wide protection-advanced" onClick={() => onCommand({ type: "OPEN_LEGACY_UI", section: "Protected Cards" })}>Advanced protection rules</button>
    <p class="migration-copy">{review.advancedActive ? "Advanced local protection rules are active. Review or edit them in Legacy Tools." : "Review and edit advanced local rules in Legacy Tools."}</p>
  </div>;
}

function App() {
  const [route, setRoute] = useState<Route>("home");
  const [protectionOrigin, setProtectionOrigin] = useState<PrimaryRoute>("more");
  const [vm, setVm] = useState<AppViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingTimer = useRef<number | null>(null);
  const restoreFocusSelector = useRef<string | null>(null);
  const appliedRevision = useRef(-1);
  const applyViewModel = (next: AppViewModel) => {
    if (next.revision < appliedRevision.current) return;
    appliedRevision.current = next.revision;
    setVm(next);
  };
  const refresh = async () => {
    try { applyViewModel(await request("SNAPSHOT")); setError(null); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2500);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    if (headingTimer.current) window.clearTimeout(headingTimer.current);
    headingTimer.current = window.setTimeout(() => {
      if (restoreFocusSelector.current) {
        const target = document.querySelector<HTMLElement>(restoreFocusSelector.current);
        restoreFocusSelector.current = null;
        if (target) { target.focus(); return; }
      }
      document.querySelector<HTMLElement>("main h1")?.focus();
    }, 0);
  }, [route]);
  const onCommand = async (command: Command) => {
    if (busy) return;
    setBusy(true);
    try { applyViewModel(await request("COMMAND", command)); setError(null); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  };
  const openProtection = (origin: PrimaryRoute) => {
    setProtectionOrigin(origin);
    setRoute("protection");
    void onCommand({ type: "PREVIEW_FODDER_REVIEW" });
  };
  const closeProtection = () => {
    restoreFocusSelector.current = `[data-protection-entry="${protectionOrigin}"]`;
    setRoute(protectionOrigin);
  };
  const content = useMemo(() => {
    if (!vm) return null;
    if (route === "projects") return <Projects vm={vm} onCommand={onCommand} go={setRoute} />;
    if (route === "club") return <Club vm={vm} onCommand={onCommand} openProtection={() => openProtection("club")} />;
    if (route === "more") return <More vm={vm} onCommand={onCommand} openProtection={() => openProtection("more")} />;
    if (route === "protection") return <ProtectionReview vm={vm} onCommand={onCommand} back={closeProtection} backLabel={protectionOrigin === "home" ? "Home" : protectionOrigin === "club" ? "Club" : protectionOrigin === "projects" ? "Projects" : "More"} />;
    return <Home vm={vm} onCommand={onCommand} go={setRoute} openProtection={() => openProtection("home")} />;
  }, [route, vm, busy, protectionOrigin]);
  const navRoute = route === "protection" ? protectionOrigin : route;
  return <div class="app-shell" aria-busy={busy}>
    <header class="app-header"><BrandLockup plan={vm?.brand.plan} compact /><div class={`connection connection-${vm?.connection.state || "connecting"}`}><span class="state-dot" />{vm?.connection.label || "Connecting"}</div></header>
    <main aria-busy={busy} aria-disabled={busy || undefined} inert={busy ? true : undefined}><CompatibilityStatus compatibility={vm?.compatibility || null} />{error ? <section class="connection-error" role="alert"><Icon name="alert" size={20} /><div><strong>Waiting for EA Web App</strong><p>{error}</p><button onClick={() => void refresh()}>Try again</button></div></section> : null}{content || <div class="loading" role="status" aria-atomic="true"><BrandMark /><p>Connecting to the active EA Web App tab…</p></div>}</main>
    <div class="sr-live" aria-live="polite" aria-atomic="true">{busy ? "Updating FUT Magic" : ""}</div>
    <nav class="bottom-nav" aria-label="FUT Magic"><button aria-current={navRoute === "home" ? "page" : undefined} onClick={() => setRoute("home")}><Icon name="home" /><span>Home</span></button><button aria-current={navRoute === "projects" ? "page" : undefined} onClick={() => setRoute("projects")}><Icon name="projects" /><span>Projects</span></button><button aria-current={navRoute === "club" ? "page" : undefined} onClick={() => setRoute("club")}><Icon name="club" /><span>Club</span></button><button aria-current={navRoute === "more" ? "page" : undefined} onClick={() => setRoute("more")}><Icon name="more" /><span>More</span></button></nav>
  </div>;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
