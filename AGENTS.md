# FUT Magic repository map

FUT Magic is a GPL-3.0-only Chrome MV3 extension derived from AutoPilot-SBC.
It is evolving from the legacy GrindPilot FC26 product without discarding its
safe local solver, workflow, inventory, policy, recovery, or EA integration.

## Start here

- Product intent and tier boundary: `docs/PRODUCT.md`
- Runtime and module boundaries: `docs/ARCHITECTURE.md`
- Product-shell design system: `docs/DESIGN.md`
- Production brand assets and usage rules: `docs/BRAND.md`
- Frontend and Side Panel contracts: `docs/FRONTEND.md`
- Reliability invariants and release gates: `docs/RELIABILITY.md`
- Security rules: `docs/SECURITY.md`
- License and data-provider constraints: `docs/LICENSING.md`
- Future Pro service/data boundary: `docs/PRO_CONTRACTS.md`
- Private optimizer implementation handoff: `docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md`
- FC27 evidence policy: `docs/FC27.md`
- Evolution graph and live-data boundary: `docs/EVOLUTIONS.md`
- Commercial launch gates and Store dossier: `docs/COMMERCIAL_READINESS.md`
- Active/completed execution plans: `docs/exec-plans/`

## Runtime map

```text
Chrome Side Panel (Preact view models + typed commands)
        | extension messaging
MV3 background broker (tab routing, solver, state, providers)
        | validated tab messages
Isolated EA-tab runtime (application host + WorkflowEngine)
        | signed allowlisted RPC
MAIN-world EA bridge (controllers + postcondition observation)
```

The isolated runtime is the single workflow executor. The Side Panel and cloud
must never instantiate the engine, call EA controllers, or claim its tab lease.

## Important paths

- `src/grindpilot-main.js`: current composition root/application host. The name
  is a compatibility detail and should be migrated only with a deliberate plan.
- `src/application/`: game context, capability/provider evidence, immutable
  goal/plan compilation, entitlements, the read-only local Router, and
  surface-slot contracts.
- `src/workflow/`: persisted, typed execution and destructive recovery.
- `src/inventory/`, `src/packs/`, `src/picks/`, `src/policies/`: local domains.
- `src/ea/`: normalized EA interaction boundary.
- `src/ui/`: in-tab HUD, contextual actions, and legacy panel.
- `src/presentation/`: serializable product view models.
- `src/sidepanel/`: Preact/TypeScript UI only.
- `page/ea-data-bridge.js`: large, fragile MAIN-world compatibility bridge.
- `background.js`: MV3 solver/state/provider/message broker.
- `test/`: unit, recovery, browser, and boundary coverage.

## Non-negotiable invariants

1. No ambiguous destructive success; timeout is not success.
2. Persist intent before one execution, then observe, verify, and checkpoint.
3. Protected and active-squad cards are never silently consumed.
4. Owned `itemId` is not card-version or footballer identity.
5. UI and cloud never receive controllers, DOM nodes, cookies, or EA sessions.
6. Remote inputs are bounded data, never JavaScript, WASM, selectors, or eval.
7. Unknown requirements, capabilities, game rules, or provider shapes fail safe.
8. Safety remains free; plan ids use stable `free` and `pro` identifiers.
9. Preserve `grindpilot.*` storage keys until a tested versioned migration exists.
10. The public extension remains GPL; private Pro services require a real network
    and repository boundary.
11. Router recommendations are data-only advice; only existing approved plans
    may reach the WorkflowEngine or EA adapter.
12. Explicit FC27/unknown contexts are observe-only until a locally shipped,
    fixture-verified strategy and recovery gate deliberately changes that state.
13. Evolution results are read-only proposals from verified bounded data;
    unknown edges and incomplete searches yield no recommendation.

## Working rules

- Read the active execution plan before changing a milestone.
- Prefer small additions around the domain engine over broad bridge rewrites.
- Keep customer copy as FUT Magic / FUT Magic Pro. Historical and technical
  legacy naming may remain where migration/provenance requires it.
- Add source-backed tests for every new destructive path or game assumption.
- Do not claim live EA, native Side Panel, FC27, provider, or billing verification
  unless it was actually performed and recorded.

## Baseline commands

```bash
npm ci
npm test
npm run test:browser
npm run check
npm run package
```

Generated bundles are tracked. Rebuild before release and ensure no unexpected
generated diff remains. Do not commit `sources/`, opaque solver binaries, secrets,
or captured account data.
