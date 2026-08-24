# GrindPilot FC26 architecture

## Runtime boundaries

GrindPilot remains one Chrome Manifest V3 extension and requires no Python
process.

```text
EA Web App MAIN world
  legacy AutoPilot bridge (preserved while migrating)
  GrindPilot modules, workflow engine and in-app panel
        ⇅ validated page messages
isolated content script
        ⇅ versioned runtime messages / chrome.storage.local
MV3 background service worker
  local solver host and bounded FUT.GG proxy
```

The page owns the durable executor because EA controllers exist only in the
MAIN world. The service worker is disposable: it may restart without losing
workflow truth. Every workflow transition is checkpointed through the isolated
storage bridge.

## Module boundaries

- `src/core`: events, typed errors, bounded/redacted activity log and storage
  contracts.
- `src/ea`: `EAInteractionAdapter`, controller implementation, DOM fallback and
  health snapshots. Domain code never accesses controllers or selectors.
- `src/inventory`: normalized owned items and atomic Club/Storage/Unassigned
  snapshots keyed by canonical string item ID.
- `src/sbc`: solver interface and adapter around the existing AutoPilot solver.
- `src/policies`: fodder, protected-player, pack, duplicate and target-project
  policies.
- `src/workflow`: definitions, condition evaluator, persisted state machine and
  typed step handlers.
- `src/profiles`: complete workflow/policy presets with JSON import/export.
- `src/dev`: opt-in class/capability snapshots and deterministic diffs.
- `src/ui`: one collapsible GrindPilot panel consuming service view models.

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
