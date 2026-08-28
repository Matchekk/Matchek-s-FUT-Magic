# FUT Magic architecture

## Runtime boundaries

FUT Magic remains one Chrome Manifest V3 extension and requires no Python
process. Legacy `grindpilot.*` names are retained for storage and compatibility.

```text
Chrome Side Panel
  Preact view models + typed commands
        ⇅ extension messages
MV3 background service worker
  tab broker, local solver, storage/lease, bounded data providers
        ⇅ validated EA-tab messages
isolated content runtime
  FUT Magic application contracts, domain services, WorkflowEngine, HUD
        ⇅ signed allowlisted RPC
EA Web App MAIN world
  preserved AutoPilot controller bridge and postcondition observation
```

The isolated EA-tab runtime owns the durable executor. MAIN world owns only the
narrow EA interaction adapter. The Side Panel is a pure view-model client and
must never instantiate the engine or claim its lease. The service worker is
disposable: it may restart without losing workflow truth. Every transition is
checkpointed through the isolated storage bridge.

## Module boundaries

- `src/application`: `GameContext`, evidence-backed capabilities/providers,
  goal-to-preview-plan compilation, entitlements, and presentation surface slots.
- `src/application/pro-contracts`: exact bounded DTO validators and token-free
  provider interfaces for future Pro proposals. These modules contain no
  endpoint and never create executable workflow steps.
- `src/core`: events, typed errors, bounded/redacted activity log and storage
  contracts.
- `src/ea`: `EAInteractionAdapter`, controller implementation, DOM fallback and
  health snapshots. Domain code never accesses controllers or selectors.
- `src/inventory`: normalized owned items and atomic Club/Storage/Unassigned
  snapshots keyed by canonical string item ID, plus location-aware duplicate
  relations that never collapse owned instances.
- `src/routing`: bounded rules, validation, explanations and read-only advice
  shared by Pack and Unassigned flows. See [routing.md](routing.md).
- `src/packs`: owned-pack policy, exact earned-reward correlation and opening.
  See [pack-correlation.md](pack-correlation.md).
- `src/sbc`: solver adapter plus reservation, conflict and sequential set
  planning. See [set-planner.md](set-planner.md).
- `src/recipes`: exact, preview-first duplicate-recycle compilation.
- `src/activity`: qualitative rolling history, canonical guard and the
  WorkflowEngine pre-dispatch scheduler.
- `src/policies`: fodder, protected-player, pack, duplicate and target-project
  policies.
- `src/workflow`: definitions, condition evaluator, persisted state machine and
  typed step handlers.
- `src/profiles`: complete workflow/policy presets with JSON import/export.
- `src/dev`: opt-in class/capability snapshots and deterministic diffs.
- `src/presentation`: bounded serializable product view models.
- `src/sidepanel`: Preact/TypeScript Side Panel with no EA internals.
- `src/ui`: contextual actions, compact run HUD, and Advanced-only legacy panel.

Evolution eligibility, immutable simulation, bounded beam/Pareto search,
diversity, transparent role scoring and generation-bound Club Scan are covered
in [evolution-engine.md](evolution-engine.md).

The planning direction is one-way:

```text
Goal → Planner → immutable Plan → PlanCompiler → existing runtime service intent
```

This milestone compiles preview plans only. It does not create a second
executor. The isolated runtime remains the sole workflow owner and must
revalidate capabilities, inventory generation, policy fingerprints, and
postconditions before any future compiled intent becomes executable.

The future Pro direction is also one-way:

```text
local projection -> random request handles -> exact request -> cloud proposal
-> exact response/request binding -> local handle resolution -> local recheck
-> local PlanCompiler -> existing approval/executor
```

See `docs/PRO_CONTRACTS.md`. The current build stops before transport: it has no
FUT Magic endpoint, auth token storage, billing integration or server code.
The conditional private-service handoff is
`docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md`; it is a design, not a deployed system.

Commercial provider defaults are mechanically closed. Auth and entitlement
providers return bounded `not_configured`/Free evidence, future or expired
evidence cannot grant access, and the explicitly not-configured cloud planner
cannot accept an injected transport. The inherited FUT.GG adapter is disabled
and has neither host permission nor CSP access. See
`docs/COMMERCIAL_READINESS.md` for the separate operator/backend gates.

## Local Router boundary

`src/application/router-next-action.js` is a pure, deterministic advisory
domain. It consumes one complete bounded inventory/route snapshot plus FC26
context, capability, policy, protection and Activity Guard evidence, then emits
exactly one immutable outcome. It imports no solver, workflow engine, EA
adapter, browser API or cloud provider and contains no steps, commands,
approval token or executable action list.

```text
fresh local evidence → one Router recommendation → redacted view model
                                                ↘ existing independent
                                                  Clear duplicates preview
                                                  → approval → WorkflowEngine
```

Owned-item bindings and evidence fingerprints remain in the isolated runtime.
The Side Panel receives only human copy and optional card display fields. Any
inventory refresh or non-idle run invalidates the displayed recommendation.
Future cloud Smart Route proposals must pass a separate closed adapter and the
same fresh local checks; they cannot deserialize into this local enum or bypass
PlanCompiler/WorkflowEngine.

## Game-version strategy boundary

The application layer separates version observation from planning readiness:

```text
bounded bridge context
  → GameContext (version + observation + challenge kind)
  → immutable GameStrategyRegistry (exact version + goal)
  → PlanCompiler gate
  → immutable strategy-bound plan
  → existing WorkflowEngine
  → fresh version gate before each handler
```

Legacy strategy maps are adapted as FC26-only entries. FC27 entries are
observe-only and contain no function. `EXECUTABLE_GAME_STRATEGY_VERSIONS` is a
closed shipped-code allowlist, so injected resolvers and remote compatibility
data cannot enable a future version. Plans bind strategy ID, game version,
challenge kind, readiness, and evidence revision into their deterministic ID.

`fc27-streamlined.js` and `item-score-provider.js` are isolated application
contracts. They do not import the classic constraint solver, EA adapter,
WorkflowEngine, browser APIs, endpoints, or credentials. Future observation,
score, eligibility, submission, and recovery implementations must enter through
those explicit contracts while the WorkflowEngine remains the only executor.

## Evolution planning boundary

`evolution-planner.js` is a pure proposal domain beside—not inside—the normal
Goal/PlanCompiler/WorkflowEngine path. It consumes anonymous immutable player
states plus closed, verified planning-edge records and an explicit objective
vector. It emits a deterministic Pareto frontier with a separate baseline.
Unknown evidence, cycles, repeated Evolutions, oversized input, and incomplete
bounded search fail closed without partial alternatives.

`evolution-metadata-provider.js` defines only version-neutral request,
descriptor, and catalog-evidence contracts. The shipped provider is not
configured and supports no game version. No production catalog payload shape,
network transport, endpoint, account, or activation behavior is invented.
Neither Evolution module imports the classic solver, PlanCompiler,
WorkflowEngine, EA adapter, controller, browser APIs, or cloud transport. See
`docs/EVOLUTIONS.md`.

ES modules are injected after the legacy bridge. They expose one frozen
`window.grindPilot` facade for the in-app UI and diagnostics; mutable state is
owned by repository/service instances, not globals.

## Identity and inventory

`itemId` identifies a unique owned object and is canonicalized to a non-empty
string at the boundary. `resourceId`, `definitionId`, `assetId` and
`basePlayerId` are definition metadata and may group versions or copies, but
must never replace item identity.

Each inventory refresh has a generation and separate source status. A failed
source refresh preserves its previous snapshot and records an error; it never
silently replaces data with an empty array. The same item ID cannot exist in
multiple zones within one committed snapshot.

## Interaction safety

Every state-changing adapter operation returns one of:

```js
{ status: "verified", value, evidence }
{ status: "not_applied", reason, evidence }
{ status: "ambiguous", reason, evidence }
{ status: "unavailable", reason }
```

Controller calls are primary. DOM interaction is a fallback limited to scoped
roots and stable IDs. A MutationObserver quiet window is only evidence of
settling; timeout is never success. Submit, claim, open and item movement each
require postcondition verification. Ambiguity pauses the run.

## Solver and conservation

The solver interface accepts normalized players, constraints and a conservation
policy. AutoPilot remains the default adapter. Candidate preprocessing removes
explicitly protected item IDs before solving and preserves every owned item.
Results are independently revalidated before apply.

Policy ordering is lexicographic:

1. satisfy hard SBC requirements;
2. never consume explicit protection;
3. preserve scarce required specials;
4. prefer expendable/base cards;
5. prefer duplicates and SBC Storage when configured;
6. preserve premium/high-rated fodder and reserves;
7. minimize estimated replacement value;
8. minimize rating overshoot.

## Storage and schemas

Versioned keys are allowlisted at the content-script boundary:

- `grindpilot.workflows.v1`
- `grindpilot.activeRun.v1`
- `grindpilot.activity.v1`
- `grindpilot.profiles.v1`
- `grindpilot.projects.v1`
- `grindpilot.settings.v1`
- `grindpilot.devSnapshots.v1`

Writes use revision checks and size limits. Logs are bounded and scrub tokens,
authorization headers, cookies and sensitive URL components before storage.

## Migration rule

Single, Multi and Entire Set remain on their known AutoPilot paths while the
generic engine reaches parity with Sequence. Legacy Sequence plans are migrated
to typed steps rather than discarded. Only after parity tests pass is the old
procedural runner removed.
