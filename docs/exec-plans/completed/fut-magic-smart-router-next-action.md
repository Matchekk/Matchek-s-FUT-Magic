# FUT Magic Smart Router — one next action execution plan

## Objective

Implement the first deliberate Smart Router progression stage: one bounded,
explainable, read-only recommendation for the current duplicate/unassigned
situation. The Router must be its own deterministic planning domain and reuse
the existing protection, inventory, duplicate-route and Activity Guard evidence.
It must not become an SBC-solver branch, execute anything, promise a Pro
multi-step plan or weaken the existing Free Clear duplicates workflow.

## Current state

- Free Clear duplicates already computes and can explicitly approve a bounded
  batch of verified Club/SBC Storage moves.
- `smart_route.v1` defines a future Pro cloud proposal vocabulary, but no live
  provider, account or entitlement grant exists.
- The product shell exposes duplicate counts and the Clear duplicates journey;
  no separate Router domain currently answers “what should I do next?”
- Activity Guard, FodderPolicy, Target Projects, normalized item provenance and
  exact duplicate route evidence already exist locally.

## Decisions

- The first Router output is read-only and contains exactly one recommendation
  or an explicit pause/ask/keep outcome.
- The recommendation may point at an action the existing Clear duplicates
  preview already supports; it does not create a second executor or approval.
- Moving a card between Unassigned, Club and SBC Storage preserves ownership,
  so protection/project/scarcity/replacement objective dimensions are zero in
  this first slice. `reserve` remains a closed future outcome but is not
  inferred without an explicit consuming or resource-allocation candidate.
- Hard protection, missing provenance, Activity Guard intervention and unknown
  destinations rank ahead of convenience/value.
- No automatic quicksell, market, SBC submit, pack open or remote recipe action.
- Free answers the immediate next action. Future Pro may plan a sequence only
  after a real service, recipes and entitlement path exist.

## Work

- [x] Map the existing duplicate preview/evidence/UI integration points.
- [x] Define the Router input, exact closed action/reason model and objective.
- [x] Implement a deterministic one-next-action planner with no mutation.
- [x] Bind it to fresh duplicate preview evidence and invalidate on state change.
- [x] Add a bounded public view model with no owned-card/internal identifiers.
- [x] Integrate one restrained explanation into the native duplicate journey.
- [x] Add unit/runtime/presentation/browser/accessibility/visual tests.
- [x] Independently review the rendered UI with Apple Design criteria.
- [x] Update architecture/product/reliability/changelog/quality documentation.
- [x] Run full test, browser, check, package and archive inspection gates.

## Acceptance

- The Router is a separate module and never imports/instantiates the SBC solver
  or WorkflowEngine.
- It analyzes full bounded input or fails closed; it never silently truncates.
- It emits one closed action among keep, move to Club, move to SBC Storage,
  reserve, pause or ask user, with closed reason codes and evidence freshness.
- The v1 objective is lexicographic: Activity Guard and evidence validity,
  unresolved duplicate pressure, tradable opportunity, flexibility/friction,
  then a stable exact-version/owned-item tie-break. Consumption-related
  objective components are structurally zero because v1 never consumes cards.
- Protection/provenance/Activity Guard can only make the recommendation more
  conservative.
- The public model and UI expose no owned item/player/resource/project IDs or
  raw policy reason codes.
- The recommendation itself has no approval/execution command. Existing batch
  movement retains its exact independent approval and revalidation path.
- Narrow width, keyboard, focus, zoom and status-without-color checks pass.
- Multi-step, Assisted and Auto routing remain explicitly unimplemented.

## Evidence log

- Added `src/application/router-next-action.js` as an immutable pure advisory
  domain with a 5,000-item/100-Unassigned full-input boundary, closed action and
  reason vocabularies, canonical fingerprints, deterministic tie-breaking and
  no workflow/execution fields.
- Integrated the domain into the existing refreshed Clear duplicates evidence
  without a new message or approval command. Runtime state is display-only and
  invalidates on inventory refresh, Activity Guard transitions, protection/
  profile changes and Target Project changes.
- Added a bounded public mapper that converts internal reasons to fixed human
  copy and recursively excludes owned/resource/player/project IDs, bindings,
  fingerprints, objective tuples, route actions and raw reason codes.
- Added the flat Apple-guided Side Panel region and corrected independent-review
  feedback by presenting a move as “Priority within this batch,” explicitly
  stating that it is already included in the batch approval and is not a second
  action. Native disclosure has a visible chevron and reduced-motion support.
- `test/router-next-action.test.js`: 12 deterministic domain tests.
- `test/router-runtime.test.js`: four runtime/presentation regressions covering
  fresh reads, zero writes, redaction, batch-plan independence, expiration and
  Activity Guard.
- Focused Router/duplicate/presentation suite: 30/30 passed.
- Full `npm test`: 292/292 passed in 48.6 seconds.
- `npm run test:browser`: passed. Reviewed
  `output/visual-review/fut-magic-duplicate-route-preview.png` and
  `output/visual-review/fut-magic-router-200-percent.png` at original detail.
- Independent UI critic final verdict: approved; no P0/P1 blockers.
- `npm run check`: passed (`verify.mjs` and TypeScript).
- `npm run package`: 147 files; archive inspection confirmed Router source and
  plan are included under the versioned root, tests/test-only Pro fakes are not
  shipped, and no permission/network surface was added.

## Deferred progression

- Multi-step Router sessions, live recipes, Pack Queue and replacement data.
- A closed adapter from future Pro `smart_route.v1` proposals to fresh local
  evidence.
- Assisted compilation with per-step replan/approval.
- Auto eligibility only after the earlier stages have production evidence.
