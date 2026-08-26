# FUT Magic Evolution Brain execution plan

## Objective

Implement a deterministic, bounded, proposal-only Evolution graph planner that
compares role-aware paths without guessing live EA Evolution metadata or
reducing quality to overall rating.

## Current state

- `PLAN_EVOLUTION` exists as a goal and Pro entitlement, but no planner exists.
- The Product Shell truthfully shows Evolution planning as unavailable.
- No verified live Evolution metadata provider, licensed catalog, activation
  adapter, or completion executor exists in this workspace.
- The existing WorkflowEngine has no Evolution activation/completion step and
  must not gain one from unverified data.

## Decisions

- Evolution planning is a pure graph problem over immutable `PlayerState`
  nodes and verified `EvolutionDefinition` edges.
- All game-specific attributes, eligibility rules, transformations, and role
  objectives are injected bounded data. Live cost and availability data remain
  outside this release because no provider is configured.
- Unknown eligibility or transformations block an edge; they are never inferred
  from names, OVR, rarity, or field shape.
- Ranking is multi-objective. A deterministic Pareto frontier preserves role
  fit, flexibility, cost, duration and rating tradeoffs instead of naming one
  universal “best” path.
- The public result is proposal-only: no workflow steps, activation commands,
  controller calls, market actions, or cloud transport.
- The shipped metadata provider remains explicitly not configured. Tests use
  redacted deterministic fixtures only.

## Work

- [x] Audit existing player identity, provider, entitlement and presentation boundaries.
- [x] Define bounded PlayerState, evolution edge, objective and request contracts.
- [x] Implement deterministic bounded graph search with cycle/reuse prevention.
- [x] Implement role-aware objective vectors and Pareto-frontier selection.
- [x] Add exact explanations, path fingerprints and evidence bindings.
- [x] Add a not-configured Evolution metadata provider with no transport.
- [x] Add adversarial, determinism, bounds, unknown-evidence and Pareto tests.
- [x] Keep the Product Shell truthful without exposing synthetic demo results.
- [x] Update product, architecture, reliability, design, quality and changelog docs.
- [x] Run full test, browser, check, package and archive inspection gates.

## Acceptance

- No live Evolution fact, role weighting, eligibility, transformation or price is guessed.
- Unknown/unverified edge evidence is never traversed.
- Cycles, repeated Evolution use, path explosion and oversized input fail closed.
- Pareto alternatives are deterministic and explain role-specific tradeoffs.
- Results contain no executable action or persistent owned-item identifier.
- Missing provider/entitlement remains explicit and cannot weaken Free safety.
- The existing WorkflowEngine and FC26/FC27/SBC/Router behavior remain unchanged.

## Evidence log

- Added `src/application/evolution-planner.js` and
  `src/application/evolution-metadata-provider.js` as isolated application
  contracts with no runtime executor or transport integration.
- Added 35 focused planner/provider/adversarial tests covering exact eligibility,
  unknown evidence, deterministic Pareto alternatives, explicit OVR/role-fit
  tradeoffs, baseline separation, cycles, reuse, bounds, immutability, redaction,
  and not-configured provider behavior.
- Product review retained one disabled Home row with no command or upsell:
  “Live Evolution data is not available in this build.”
- `npm test`: 363/363 passed.
- `npm run test:browser`: passed after rebuilding the Side Panel/runtime bundle.
- Visual review retained the approved FC26/FC27/unknown layouts; no new
  Evolution surface was introduced.
- `npm run check`: passed.
- `npm run package`: packaged 155 files; archive inspection found zero test,
  environment, `node_modules`, output, or nested distribution entries.
- Live catalog, price feed, provider connection, activation, completion, and
  execution remain explicit launch debt, not claimed functionality.
