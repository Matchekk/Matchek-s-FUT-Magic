# Competitive patterns — clean-room record

## Purpose and evidence boundary

This record describes product behavior observed in locally supplied AutoSBC,
FUTGenie, and public AutoPilot-SBC packages. Those packages were inspected
read-only. No third-party source, CSS, constants, copy, assets, remote
contracts, selectors, or credentials are imported into FUT Magic.

The references are useful only as evidence that users value consistent item
routing, reward correlation, whole-set previews, duplicate recycling,
activity-aware pacing, and Evolution comparisons. FUT Magic specifies and
implements those outcomes independently on its existing local-first safety
architecture.

## Adopted patterns

| Observed behavior | User value | FUT Magic interpretation | How FUT Magic differs |
| --- | --- | --- | --- |
| One routing ruleset is reused after packs and in Unassigned. | Decisions stay consistent. | A pure, closed RoutingEngine consumes normalized inventory, duplicate relations, capabilities, protection and Activity Guard evidence. | Protection/evidence run before user rules; advice never authorizes execution and quicksell is not representable. |
| Multi-challenge solving reserves selected cards. | An Entire Set preview does not promise one physical card twice. | ReservationLedger and SolutionConflictValidator key only concrete owned `itemId` values and bind inventory/project evidence. | The Free planner is explicitly sequential, not globally optimal; execution stays in WorkflowEngine and revalidates after every destructive step. |
| Reward-only pack modes compare pack pools before and after a claim. | Saved packs are not opened accidentally. | EarnedPackTracker binds one verified +1 delta to one reward operation and exact owned-pack evidence. | Any ambiguous delta pauses; visible name/type alone is never enough. |
| One-click duplicate recycling chooses an eligible repeatable SBC. | Blocking duplicates can be cleared without a workflow-builder lesson. | A read-only recipe scorer and preview bind the target, exact duplicate instances, complete proposed squad and safety fingerprints before approval. | No hidden Organizer fallback, market action, quicksell, or direct EA mutation is permitted. |
| Evolution tools compare multiple paths and club candidates. | Users can find strategically different upgrades. | The existing immutable verified-edge planner remains the oracle; future club scanning reuses its eligibility/simulation contracts and returns bounded proposals. | No proprietary grade, guessed live catalog, FC27 execution, or synthetic consumer claim is introduced. |
| Concurrent product-auth refreshes share one request. | Service-worker callers do not create refresh stampedes. | A provider-neutral single-flight primitive may wrap a future FUT Magic cloud-auth refresh. | It never handles EA credentials and does not invent a provider, token store, endpoint, or purchase flow. |
| Localized catalogs centralize interface copy. | New product journeys can ship consistently in more than one language. | A small FUT Magic-owned `en`/`de` catalog with strict fallback and interpolation is introduced before new copy expands. | Competitor keys and wording are not reused. |

## Existing FUT Magic foundations retained

- `src/application/router-next-action.js` remains the bounded one-next-action
  compatibility facade; the generic routing domain must not create another
  executor.
- `src/application/duplicate-route-preview.js` and the existing Clear
  duplicates approval remain the only current native item-movement path.
- `src/packs/reward-service.js` already has conservative before/after reward
  correlation and is hardened rather than replaced.
- `src/application/pro-contracts/` already provides the public GPL/private Pro
  boundary, request-local handles, proposal validation and a transport-free
  provider interface.
- `src/application/evolution-planner.js` already provides verified immutable
  states, deterministic eligibility/transformation, bounded exploration,
  cycle prevention and Pareto alternatives.
- `src/workflow/` remains the single persisted executor. Planning domains do
  not import EA controllers, browser APIs, or WorkflowEngine.

## Rejected patterns

FUT Magic does not adopt transfer-market automation, sniping, bidding, buying,
coin farming, captcha or bot-detection evasion, platform-switch workarounds,
automatic quicksell, fixed “safe actions per hour” quotas, proprietary player
grades, remote executable rules, third-party UI/CSS/assets, giant MAIN-world
dispatchers, or unattended/shadow-ban-safety claims.

## Implementation status

| Capability | Current clean-room status |
| --- | --- |
| One-action local Router and exact duplicate movement | Preserved; generic bounded RoutingEngine now shared by Pack and Unassigned advice |
| Location-aware DuplicateRelations | Implemented with separate instance/version/footballer identities |
| Reward count-delta correlation | Hardened with operation-bound EarnedPackTracker and exact PackService resolution |
| Reservation/conflict domains and Free sequential set planner | Domain-complete and read-only; a customer-facing Entire Set approval/compiler surface is intentionally deferred |
| Global Optimizer public proposal contracts | Implemented; private service intentionally absent |
| Persona-aware ActivityLedger and cross-step circuit breaker | Implemented with an opaque, non-mixing browser-session partition until verified persona evidence exists; the bounded ledger is restored only for that partition |
| Evolution verified graph/Pareto core | Extended with public eligibility/simulator, bounded beam, diversity, role scoring and read-only Club Scan |
| i18n foundation and intent-level solver/storage presets | Implemented for `en`/`de`; Storage Only blocks without a verified enforcing solver capability |

The duplicate-recycle scorer, exact preview, and WorkflowEngine compiler are
available as verified internal domains. The primary Clear duplicates surface
does not yet synthesize the required complete candidate from live EA evidence;
until it can, it pauses instead of falling back to the legacy Organizer or
guessing an SBC target.
