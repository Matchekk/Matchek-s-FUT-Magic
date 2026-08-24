# GrindPilot workflow engine

## Definition model

A workflow is immutable while running and contains typed steps:

```js
{
  id, name, version,
  mode: "REVIEW" | "ASSISTED" | "AUTO",
  maxIterations,
  steps: [{ id, type, config, retryPolicy, timeoutMs, onFailure }],
  policies
}
```

Supported step types are `SOLVE_SBC`, `SUBMIT_SBC`, `CLAIM_REWARD`,
`OPEN_REWARD_PACK`, `RESOLVE_ITEMS`, `HANDLE_PLAYER_PICK`, `DELAY`,
`CONDITIONAL`, `LOOP` and `PAUSE`.

Step statuses are `pending`, `running`, `waiting`, `completed`, `skipped`,
`failed` and `paused`. Run statuses additionally include `stopping`, `stopped`,
`recovery_required` and `completed`.

## State machine

```text
idle → running → waiting ──approval/event──→ running
          │          │
          │          └──ambiguous──→ paused/recovery_required
          ├──pause───────────────→ paused ──resume──→ running
          ├──stop────────────────→ stopping → stopped
          ├──verified final step─→ completed
          └──exhausted failure───→ failed
```

Invalid transitions throw a typed error. Nested `setTimeout` orchestration and
arbitrary JavaScript expressions are prohibited.

## Destructive-operation protocol

For submit, claim, pack open, item movement and pick selection:

1. validate the immutable workflow/policy approval;
2. read and verify preconditions;
3. persist a serializable intent with operation ID and pre-state;
4. execute once through `EAInteractionAdapter`;
5. verify the observable post-state;
6. checkpoint the result before advancing.

If a refresh occurs with an operation marked `running`, its handler reconciles
from current EA state. It never blindly repeats a destructive action. Missing
or conflicting evidence produces `recovery_required`.

## Review modes

- `REVIEW`: only reads, solve and preview are allowed.
- `ASSISTED`: pause before each state-changing intent and authorize it once.
- `AUTO`: one confirmation approves an immutable workflow hash, policy hash,
  SBC allowlist, destructive step set and iteration limit.

Changing a workflow or policy invalidates AUTO approval. AUTO still pauses on
ambiguous recovery, unresolved unassigned items or an undecidable player pick.

## Conditions

Conditions use allowlisted metrics and operators, never `eval`:

```js
{ metric: "STORAGE_FREE_SLOTS", operator: "LTE", value: 0 }
{ metric: "DUPLICATE_RATING", operator: "GTE", value: 90 }
{ metric: "UNRESOLVED_UNASSIGNED", operator: "EQ", value: 0 }
```

`AND`, `OR` and `NOT` compose bounded trees. Unknown metrics/operators or
excessive depth fail validation.

## Retry and stop semantics

Retries are bounded and only cover classified transient failures. Each policy
defines attempts, backoff and maximum delay. Timeout is failure/ambiguity, not
success. Stop aborts waits and prevents the next destructive dispatch; an
already-dispatched operation is reconciled before the run becomes stopped.

## MVP loop

```text
SOLVE_SBC → SUBMIT_SBC → CLAIM_REWARD → OPEN_REWARD_PACK
→ RESOLVE_ITEMS → LOOP (bounded N)
```

Before another pack or iteration, `unresolvedUnassigned` must be zero. Normal
items move to Club, eligible untradeable duplicates move to SBC Storage,
tradable duplicates remain safe, and unresolved items pause. No default policy
quicksells anything and reward pack opening rejects coin/FC-point purchases.

## Recovery checkpoints

Persist after every transition: run/workflow version and hash, revision,
cursor, loop frames, step attempts/intents/results, counters, approval,
timestamps and last error. Nonserializable controller objects, Maps, Sets and
DOM nodes are never stored.
