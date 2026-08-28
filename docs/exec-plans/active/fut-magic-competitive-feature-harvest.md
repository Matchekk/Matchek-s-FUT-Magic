# FUT Magic competitive feature harvest

## Objective

Implement the strongest user conveniences observed in reviewed products as
independent FUT Magic domains, while preserving the existing approval,
intent, verification, recovery, Activity Guard, EA-adapter, GPL/private-service
and FC27 observe-only boundaries.

This is a multi-milestone program. Each milestone must leave the repository
healthy and may not claim live EA/provider verification from synthetic tests.

## Baseline — 2026-08-28

- Branch: `bug-hunter-fix-20260828-080904` with pre-existing, preserved UI/
  reliability work in the working tree.
- `npm ci`: passed; zero reported vulnerabilities.
- `npm test`: 387/387 passed.
- `npm run test:browser`: passed both browser integration harnesses.
- `npm run check`: passed repository verification and TypeScript.
- `npm run package`: produced CWS/source candidates and release provenance.
- Seven read-only specialist audits covered competitive architecture, FUT Magic
  architecture, solver/set planning, inventory/routing, Evolutions,
  reliability/activity and QA. No specialist modified the workspace.

## Architectural decisions

1. Existing specialized Router, duplicate preview, reward correlation, Pro
   contracts and Evolution planner are compatibility foundations, not throwaway
   prototypes.
2. New planning modules are pure serializable domains. They do not import the
   EA adapter, browser APIs, cloud transport, or WorkflowEngine.
3. Every consuming or destructive plan binds exact owned instances and fresh
   evidence. Missing provenance blocks rather than defaults to “untradeable” or
   “safe.”
4. Free Set Planner is sequential and may return incomplete; it never claims
   global optimality or infeasibility from a greedy failure.
5. Activity history remains qualitative. No community number becomes a safe
   quota or ban-evasion promise.
6. The Evolution core stays proposal-only and the consumer feature remains
   disabled until lawful verified metadata exists.
7. Existing `grindpilot.*` keys and the isolated-runtime executor remain
   compatible. New persisted state requires a versioned key and migration.

## Milestones

### 1. Routing foundation

- [x] Add closed RoutingRule/Ruleset/Engine/Validator/Explainer modules.
- [x] Add deterministic location-aware DuplicateRelations.
- [x] Preserve parity with current safe Club/Storage decisions.
- [x] Add the `en`/`de` i18n kernel for all new copy.
- [x] Test safety monotonicity, determinism, explanations and bounds.

### 2. Pack correlation

- [x] Extract an operation-bound EarnedPackTracker around current reward logic.
- [x] Require exactly one new owned unit; reject +2/multiple/no/contradictory deltas.
- [x] Persist and consume one exact reward binding in the existing workflow.
- [x] Feed post-pack Unassigned evidence to the shared Router as advice only.

### 3. Set planning integrity

- [x] Add ReservationLedger and SolutionConflictValidator.
- [x] Add a bounded SquadCandidateGenerator port.
- [x] Add the local sequential Set Planner and honest incomplete/stale states.
- [x] Bind inventory, challenge, project and policy evidence.
- [x] Keep future Pro optimization on the existing proposal-only contracts.

### 4. Activity and scheduler safety

- [x] Add a bounded persona/game/session ActivityLedger with rolling windows.
- [x] Add canonical NORMAL/ELEVATED/CAUTION/PAUSED/RECOVERY evaluation.
- [x] Add a centralized pre-dispatch scheduler seam and failure-streak breaker.
- [x] Preserve recovery reads and postcondition truth; no action quota copy.

### 5. Duplicate recycle recipe

- [x] Add an explainable lexicographic target scorer and read-only preview.
- [x] Require exact blocking duplicates and complete verified requirements.
- [x] Recheck protection/project/inventory and Activity evidence at approval;
  live requirement/capability truth is still verified by the EA adapter.
- [x] Compile only the approved exact plan to the existing WorkflowEngine.
- [x] Keep legacy Organizer isolated from the new preview-bound path.

The exact preview/compiler path is currently an internal verified runtime. The
primary Clear duplicates surface does not yet have sufficient live candidate
evidence to expose it; it pauses safely rather than guessing or using the
legacy Organizer.

### 6. Evolution and UX deltas

- [x] Export reusable eligibility reasons and versioned immutable simulation.
- [x] Add bounded beam search, diversity selection and named explainable result modes.
- [x] Add a read-only generation-bound Club Scan coordinator for verified data.
- [x] Add solver presets and Smart/Prefer/Only/Avoid Storage policy mapping.
- [x] Keep live Evolution UI disabled while the provider is not configured.

### 7. Review and release gate

- [x] Run independent architecture, reliability, licensing, Apple Design and
  accessibility reviews.
- [x] Fix justified findings and complete the Bug Hunter Hunter/Skeptic/Referee
  verification pipeline.
- [x] Run unit, browser, static, package and archive-reachability gates.
- [x] Record deferred private Pro and live EA/provider work truthfully.

## Core invariants

- No owned item appears twice in one project plan.
- Protected/active-squad items cannot be consumed by default.
- Every routing decision has a closed explanation.
- Stale inventory/project/catalog evidence invalidates execution.
- Reward workflow never opens an uncorrelated pack.
- Every Evolution result is eligibility-valid step by step and remains bounded.
- Planner output is data; only the existing local executor may mutate EA state.
- No reference package or `sources/` content enters production or release
  archives.

## Evidence log

Progress and focused/full gate results are appended after each milestone.

- Routing/i18n focused tests: 12 passed.
- Existing Router/Clear duplicates/inventory regression group: 21 passed.
- Earned-pack, PackService and pack workflow group: 25 passed.
- Reservation/candidate/conflict/sequential planning group: 18 passed before
  the nested-fingerprint regression was added.
- Activity/scheduler/workflow group: 18 passed; runtime/e2e group: 19 passed.
- Duplicate recipe domain: 4 passed; exact WorkflowEngine runtime coverage was
  added for dispatch and stale-evidence rejection.
- Evolution planner/analysis: 39 passed; bounded beam strategy: 3 passed.
- Product-auth single-flight and solver preset focused coverage was added.
- Independent review found no copied competitor code/assets/contracts. Its
  justified execution, routing, Activity, pack, candidate, accessibility and
  screenshot findings were fixed or truthfully isolated as planning-only.
- Final 2026-08-28 gates: `npm ci` passed with zero vulnerabilities;
  `npm test` passed 469/469; both browser harnesses passed; `npm run check`
  passed; packaging produced a 24-file CWS candidate and a 291-file source
  candidate without competitor archives or design-source artifacts.
