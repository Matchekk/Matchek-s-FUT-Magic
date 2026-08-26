# Changelog

## 2.3.0 - 2026-08-26

- Migrated customer-facing branding to FUT Magic and FUT Magic Pro while
  preserving all legacy `grindpilot.*` storage keys and attribution history.
- Added a native Chrome Side Panel with a Preact/TypeScript Home, Projects,
  Club, More, active-run controls, legal context, and strict view models.
- Added a compact in-tab run HUD and contextual Open FUT Magic entry point;
  moved the previous large panel behind Advanced → Legacy Tools.
- Added the production FUT Magic deep-navy/cyan design system, original
  scalable wordmark/symbol/lockup assets, size-specific extension icons, and
  restrained Pro violet with keyboard focus, reduced-motion,
  reduced-transparency, contrast, and narrow-width behavior.
- Added Side Panel message validation, EA-tab routing, scoped lifecycle rules,
  product-shell tests, visual harness screenshots, canonical docs, and an active
  execution plan.
- Added the first goal-first SBC vertical slice: read-only protected squad
  previews, deterministic evidence fingerprints, stale-plan rejection, explicit
  one-squad approval, post-solve target/card validation, and fail-closed planner
  blockers in the native Side Panel.
- Added the native Free Clear duplicates slice: read-only per-card routing,
  exact full-set/action fingerprints, explicit safe-move approval, independent
  execution-boundary revalidation, exact residual verification, stale and
  capability fail-closed behavior, and no hidden Organizer/SBC/pack/quicksell
  continuation.
- Hardened Side Panel command schemas, response correlation, revision ordering,
  oversized-route blocking, and full visibility of every approvable item.
- Replaced the misleading “Optimize my fodder” legacy detour with a native,
  read-only Card protection journey from Home, Club, and More. The review uses
  fresh `FodderPolicy` and Target Project evidence, keeps hard exclusions
  separate from “try to keep” signals, and marks incomplete EA flag provenance
  as unverified instead of treating unknown cards as safe.
- Added the public FUT Magic Pro v1 contract boundary without inventing a live
  service: explicit token-free auth/entitlement states, fail-to-Free gating,
  random request-local handles, exact Project Optimization and Smart Route
  proposal schemas, local-recipe metadata, downgrade-only compatibility,
  injected transport deadlines/cancellation and bounded replay protection.
- Added adversarial contract and deterministic test-provider coverage. The
  extension still ships no FUT Magic endpoint, account, billing path, private
  optimizer, credential storage or additional host permission.
- Added the conditional Global Project Optimizer private-service handoff: an
  exact deterministic FC26 allocation model, immutable objective semantics,
  service architecture, privacy/licensing gates, verification matrix and staged
  rollout plan. No backend was implemented because no separate private
  workspace or launch authority is available.
- Added the first local Router progression stage: one deterministic,
  explainable, read-only next action for the complete bounded Unassigned
  snapshot. Activity Guard and evidence degradation fail closed; private item
  bindings stay behind the view-model boundary; the existing exact batch
  approval remains the only movement path.
- Added a restrained native “Recommended next” region with suggestion-only
  copy, freshness/evidence disclosure, 300px/200% zoom coverage and no second
  action button. Multi-step, Assisted and Auto routing remain unimplemented.
- Added FC27 readiness boundaries without guessing live behavior: exact local
  game-strategy resolution, observe-only FC27 descriptors, separate streamlined
  evidence contracts, a fail-closed ItemScoreProvider, explicit version
  propagation/invalidation, and a fresh workflow execution gate.
- Added a compact FC27/unknown compatibility status. Planning controls fail
  closed while read-only project and Club context remains visible; verified
  FC26 presentation and workflows retain their existing behavior.
- Added a deterministic proposal-only Evolution graph engine with anonymous
  immutable PlayerState, verified planning edges, explicit OVR and role-aware
  objective vectors, Pareto alternatives, baseline separation, cycle/reuse
  defense, and no partial result when a search bound is reached.
- Added exact FC26/FC27 Evolution metadata request/evidence contracts and a
  shipped not-configured provider. No live catalog, price feed, provider
  connection, activation, completion, or execution is claimed.
- Documented GPL/private-cloud, FUT.GG, EA terms, FC27 evidence, and commercial
  launch constraints without claiming unresolved support.
- Hardened auth and entitlement freshness so future-dated or provider-error
  evidence fails to the complete Free feature set; the not-configured cloud
  provider can no longer retain an injected transport.
- Hard-disabled FUT.GG network access in the public build, removed its host
  permission, restricted the CSP to local connections, and replaced the legacy
  payment solicitation with source and licensing context.
- Purged legacy EA-origin player/league/nation metadata caches, kept replacement
  metadata memory-only, strengthened secret redaction, and minimized local
  diagnostic exports to bounded support-safe fields.
- Added visible Source, License, Privacy, Third-party notices, and no-warranty
  context to About/Legal while keeping every Pro-labelled action disabled and
  command-free until real providers exist.
- Split packaging into a root-manifest Chrome Web Store candidate, a wrapped
  corresponding-source archive, and a hashed release-provenance record with
  package-time entrypoint, content, and secret checks.
- Added a canonical commercial-readiness matrix. EA authorization, licensed
  providers, production account/billing/support services, hosted operator
  policy, exact tagged source, store media, and native release QA remain
  explicit blockers; no publication or purchase was performed.

## 2.2.0 - 2026-08-25

- Integrated soft fodder conservation into the production solver while keeping
  explicit protected cards as hard exclusions.
- Added complete Target Project import/synchronization, a nested workflow
  builder, five templates and Legacy Sequence migration using stable IDs.
- Added controller-level Player Pick inspection/selection with typed policies,
  identity rechecks and fail-safe ambiguity handling.
- Added persisted intents and three-way reload reconciliation for every
  destructive grind operation.
- Added rating-bucket inventory views, capability health, per-run analytics and
  structured policy/project editors in the unified blue GrindPilot panel.
- Added a 20-iteration fake-EA suite with destructive reloads, a real-browser
  integration harness, deterministic ZIP packaging and CI coverage.
- Added production guides for Target Projects, Player Picks, the Workflow
  Builder and controlled live verification.

## 2.1.2 - 2026-08-24

- Moved GrindPilot persistence into typed, schema-validated extension commands
  and added serialized, tab-owned workflow revisions.
- Added fail-closed recovery, EA response, unassigned and reward-pack
  correlation behavior around destructive actions.
- Fixed the isolated content-script bootstrap and allow immediate, verified
  recovery when a previous workflow-owner tab has been closed.
- Preserved complete imported profile limits and hidden protected-card rules.
- Protected locked/upstream-protected cards, serialized inventory refreshes and
  prevented base/promo versions of one footballer from sharing a solved squad.
- Made required-special stop conditions use fresh normalized inventory instead
  of treating missing context as an empty club.
- Added targeted service-worker, workflow, UI, reward and solver regressions.

## 2.1.1 - 2026-08-24

- Replaced the inherited shield artwork with an original, clean blue
  GrindPilot navigation-loop icon at 16, 32, 48 and 128 pixels.
- Added a scalable SVG master and release checks for manifest icon files and
  their declared PNG dimensions.

## 2.1.0 - 2026-08-24

- Renamed the unified extension to GrindPilot FC26.
- Added a revisioned workflow state machine with typed steps, conditions,
  bounded loops/retries, durable intents and reload recovery.
- Added REVIEW, ASSISTED and hash-bound AUTO approval modes.
- Added a central owned-item inventory model, duplicate planner and safe SBC
  Storage handling; no implicit quicksell path exists.
- Added correlated owned-reward pack opening and unassigned blocking.
- Added configurable fodder conservation and arbitrary Target Projects.
- Added player-pick policies with fail-safe user pause when EA state is not
  sufficiently observable.
- Added grind profiles, bounded redacted activity logs, a single in-Web-App
  panel and opt-in Developer Mode.
- Added FC26 rating, identity, policy, workflow, pack, pick, profile, inventory,
  recovery and diagnostics tests.

## 2.0.0 - 2026-08-24

- Established AutoPilot-SBC as the local-first runtime base.
- Added Auto-SBC-inspired player replacement-value policy.
- Fixed fail-open unknown requirements, insufficient pools and zero targets.
- Fixed preferred-position chemistry matching.
- Hardened solver bridge protocol, readiness, limits and timeouts.
- Added FUT.GG request deadlines, allowlists and transient-error backoff.
- Reduced extension resource/frame exposure.
- Added automated regression and manifest verification tests.
- Added privacy, architecture, upstream-analysis and license provenance docs.
