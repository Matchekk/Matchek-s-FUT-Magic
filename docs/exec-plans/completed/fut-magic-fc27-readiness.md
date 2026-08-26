# FUT Magic FC27 readiness execution plan

## Objective

Build explicit version/strategy/provider boundaries so FC27 can be observed and
represented without being guessed or treated as FC26. This milestone must not
claim live FC27 rules, scoring, eligibility, submission or recovery support.

## Current state

- `GameVersion` already distinguishes `fc26`, `fc27` and `unknown`, and default
  FC27 context is unverified.
- PlanCompiler currently checks only context state; a caller can still construct
  an explicitly verified FC27 context without an independent strategy gate.
- The isolated runtime defaults to FC26 instead of propagating an explicitly
  observed game version from the EA context.
- No `ItemScoreProvider`, streamlined challenge observation model, verified
  FC27 fixture corpus or submission strategy exists.

## Decisions

- FC26 classic squad challenges and FC27 streamlined score challenges are
  different closed strategy kinds, not feature flags on one solver.
- Every FC27 fact is `verified`, `unverified` or `unknown`; absent evidence is
  never converted to a default value.
- The default FC27 strategy is observe-only. No PlanCompiler path may produce
  executable steps for FC27, even if a caller labels the outer context verified.
- A future verified strategy requires explicit score, eligibility, submission
  and recovery providers plus fixtures; compatibility metadata can only
  downgrade that evidence.
- Runtime game-version propagation must preserve explicit observed FC27/unknown
  values while retaining the FC26 compatibility default only when no version is
  supplied by the current bridge.

## Work

- [x] Audit current version detection, context, compiler and capability seams.
- [x] Define a closed game-strategy registry and readiness assessment.
- [x] Define bounded streamlined-challenge facts with per-field evidence state.
- [x] Define an injected ItemScoreProvider port and not-configured behavior.
- [x] Gate PlanCompiler independently of caller-supplied context state.
- [x] Propagate explicit observed game versions through the runtime/view model.
- [x] Add strategy, evidence, provider, compiler and runtime regressions.
- [x] Add a truthful native compatibility status only if it improves the
      current journey without inventing live support.
- [x] Update FC27, architecture, product, reliability, quality and changelog
      documentation.
- [x] Run full test, browser, check, package and archive inspection gates.

## Acceptance

- No FC27 rule, score, eligibility or submission behavior is inferred from
  FC26 or from field names alone.
- An explicitly `verified` outer FC27 GameContext still cannot compile a plan
  while the local FC27 strategy is observe-only.
- Unknown values remain null/closed-state evidence, never zero/false defaults.
- The provider boundary has no endpoint, token, credential, browser or EA
  controller dependency and returns no executable code.
- Compatibility config cannot upgrade FC27 readiness.
- Existing FC26 plans and destructive recovery behavior remain unchanged.
- Tests and UI expose the exact distinction between observed, verified and
  available-for-planning.

## Evidence log

- The immutable registry binds exact version/goal pairs; legacy strategies are
  FC26-only and FC27 descriptors are observe-only with no function.
- Raw and factory-created verified FC27 contexts, plus an injected resolver
  claiming FC27 execution, all block before strategy invocation.
- `fc27_streamlined_challenge_observation.v1` preserves unknown/unverified
  values as null and requires reviewed-fixture evidence for verified values.
- `ItemScoreProvider` has exact bounded request/response contracts; the shipped
  provider is immutable, not configured, and performs no transport.
- The ControllerAdapter owns the sole versionless legacy-bridge FC26 mapping.
  Explicit FC27/unknown values propagate and invalidate version-bound plans.
- WorkflowEngine handler gating refreshes context and pauses FC27/unknown before
  every solve, submit, claim, pack, routing, Organizer, or pick adapter action.
- Product Shell and Side Panel show one flat FC27/unknown status, keep FC26
  visually unchanged, and remove classic planning/import/tool actions.
- Independent Apple-design/accessibility critique approved the rebuilt UI with
  no P0/P1 findings after the final fixes.
- `npm test`: 328/328 pass.
- `npm run test:browser`: pass, including FC26 golden, FC27/unknown, Project
  detail, 300px, 200% zoom, and no compatibility action.
- `npm run check`: pass.
- `npm run package`: 151 files in `dist/fut-magic-2.3.0.zip`.
