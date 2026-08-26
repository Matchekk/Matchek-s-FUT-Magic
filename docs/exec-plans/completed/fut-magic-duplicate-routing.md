# FUT Magic Free duplicate-routing execution plan

Status: completed 2026-08-26.

## Objective

Deliver the next Free Product Polish slice: turn **Clear duplicates** into a
native, explainable, read-only route preview followed by one explicitly
approved and verified batch of safe Club/SBC Storage moves.

## Current state

- `InventoryService.planUnassignedResolution()` already produces deterministic,
  side-effect-free actions and has no quicksell action.
- `RESOLVE_ITEMS` persists intent, executes through the EA adapter, verifies
  destinations, and reconciles reloads.
- Home still sends **Clear duplicates** to the legacy Inventory panel.
- The legacy **Route & recycle** action may follow safe moves with an Organizer
  SBC submission. This new Free flow must not inherit that hidden second step.

## Architectural decisions

1. Use `GoalKind.CLEAR_DUPLICATES` and the existing `PlanCompiler` rather than
   adding bespoke Side Panel business logic.
2. Bind the plan to material inventory, Storage capacity, routing policy, game
   context, and required capability fingerprints.
3. Approval starts exactly one `RESOLVE_ITEMS` workflow node. It never submits
   an SBC, opens a pack, purchases, discards, transfers, or quicksells.
4. Bind the approved action set into the workflow definition and revalidate it
   after the workflow's own fresh inventory read, closing the approval-to-write
   race.
5. Safe moves may execute while held/blocked items remain, but the preview must
   name both the moved and remaining counts. No automatic follow-on planning.
6. Side Panel view models expose bounded card summaries and human reasons, not
   owned item IDs or internal policy codes.

## Affected modules

- `src/application/`: route planning evidence and preview helpers.
- `src/grindpilot-main.js`: plan cache, commands, approval, workflow binding.
- `src/presentation/product-shell-view-model.js`: bounded route view model and
  honest Club labels.
- `src/sidepanel/`: native Club route preview and approval UI.
- `test/`, browser fixture/harness, reliability and product documentation.

## Acceptance criteria

- Preview is read-only and counts reconcile with current Unassigned items.
- Empty, ready, blocked, stale, unavailable, running, and remaining-item states
  are explicit.
- Approval rejects changed inventory, capacity, policy, context, or capability
  evidence before starting a run.
- A second exact action-set check occurs after the workflow refresh and before
  the adapter write.
- Only the displayed safe Club/Storage moves can execute.
- Partial or ambiguous outcomes never use success styling and remain recoverable.
- No implicit quicksell, Organizer, SBC submit, pack, market, or purchase path
  exists in the compiled Free workflow.
- Home and Club use the same route summary and freshness evidence.
- UI works at 300px+, 200% text zoom, keyboard-only, reduced motion,
  reduced transparency, and increased contrast.
- Full tests, browser journey, visual critique, check, and package pass.

## Progress

- [x] Identify the existing deterministic policy and verified execution seam.
- [x] Implement route plan evidence, summary, and action binding.
- [x] Add preview and approval application commands.
- [x] Build the native Side Panel journey.
- [x] Add unit, integration, recovery, browser, and accessibility coverage.
- [x] Complete documentation, release gate, and packaging.

## Test evidence

- `npm test`: 205 passed, 0 failed.
- `npm run test:browser`: passed, including the native Home → Clear
  duplicates → Club journey, 300px width, keyboard focus, and 200% zoom at a
  600px viewport.
- Independent UI critic: no remaining P0/P1 release blocker after re-audit.
- `npm run check`: passed.
- `npm run package`: 128-file archive verified with required source/build/legal
  entries; SHA-256
  `008B8B2FDC1DED0D3C8D9296FF57A97868C6ECCD9ECA021AC1C9CA0BAAF5FA38`.

## Constraints and debt

- Live native Side Panel and EA behavior remain unverified until the controlled
  live checklist is performed.
- Organizer/SBC consumption of remaining items is intentionally separate; it
  needs its own exact target and squad preview before becoming native.
- Pro Smart Router remains a future multi-step planning domain. This Free slice
  recommends and executes one bounded current-state action only.

## Decision log

- Chose safe moves only after Product UX review identified that the current
  innocent-sounding legacy action can conceal an SBC submission.
- Rejected a modal confirmation: the route preview itself is the explicit
  approval surface; destructive scope and exclusions stay visible beside the
  primary action.
- Added a 100-item fail-closed boundary after the independent UI critic found
  that truncating an approvable preview could hide authorized moves. The public
  view model now requires every approvable card to be visible.
- Independent re-audit found no remaining P0/P1 UI release blocker.
