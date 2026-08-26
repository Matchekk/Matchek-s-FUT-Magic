# FUT Magic SBC Planner execution plan

Status: completed and accepted on 2026-08-26.

## Objective

Deliver the first complete FUT Magic vertical slice: import the open EA SBC set,
show exact known remaining requirements and current owned stock, compile an
explainable protected preview plan with the existing solver, and hand execution
to the existing verified workflow path only after explicit approval.

## User journey

1. Open an SBC set in EA and choose **Import open SBC**.
2. See remaining squads, ratings, specials, exact stock, and unknown fields.
3. Choose **Preview plan**; FUT Magic explains feasibility, protected-card
   impact, shortages, and alternatives without applying a squad.
4. Approve one bounded plan to continue through the existing solver/workflow.
5. Observe progress, interventions, and postcondition evidence in the Side
   Panel/HUD.

## Scope

- A real `complete_sbc` compiler strategy targeting existing runtime services.
- Immutable inventory, project, policy, game-context, and capability
  fingerprints on every plan.
- Honest feasibility/shortage explanations; no fake market price or coverage.
- Preview/approval command contracts between Side Panel and isolated runtime.
- Project-detail UI for preview, blockers, alternatives, and approval.
- Contract, solver-parity, recovery, browser, and visual tests.

## Non-goals

- No Market, Evolution, Draft, or cloud optimizer.
- No FUT.GG automation or unlicensed commercial data.
- No FC27 execution while its context/rules are unverified.
- No solver rewrite and no second workflow executor.

## Progress

- [x] Product Shell and application contracts accepted.
- [x] Map the exact existing import/solve/workflow seams and fingerprints.
- [x] Implement the `complete_sbc` preview compiler strategy.
- [x] Add preview/approval view models and commands.
- [x] Build the project-detail preview interaction.
- [x] Verify parity, recovery, browser journey, and screenshots.

## Delivered evidence

- Preview calls the existing solver with `previewOnly: true`; it does not apply
  a squad, create a workflow run, or submit cards.
- Plans bind canonical fingerprints for game context, inventory content, Target
  Project, protection/conservation policy, and required capabilities.
- Approval refreshes every binding and rejects stale evidence before starting a
  bounded one-squad workflow. The workflow re-solves and verifies stable set,
  challenge, observed-card, and protected-card invariants before submission.
- The Side Panel exposes the exact 11-card proposal without owned item IDs or
  raw solver payloads, and labels the irreversible approval explicitly.
- Unknown requirements, missing capabilities, unobserved cards, protected-card
  selection, and route changes all stop before submission.
- `npm test`: 195 passing after the final safety-contract refinement.
- `npm run test:browser`: passed with Home, Projects, Club, More, HUD, 300px
  keyboard/overflow, and ready SBC preview captures.
- Independent UI review passed the 380×820 hierarchy after its verified
  protected-count release blocker was corrected.

## Acceptance criteria

- Unknown requirements and unavailable capabilities block preview/execution.
- Preview never mutates EA, inventory, projects, or workflow state.
- Every approved plan is stale-checked before existing runtime execution.
- Protected items remain excluded and chosen squads independently revalidate.
- UI copy distinguishes exact stock, estimated feasibility, and unknown data.
