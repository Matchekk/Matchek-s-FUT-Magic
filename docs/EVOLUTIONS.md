# Evolution Brain
FUT Magic contains a deterministic, local, proposal-only Evolution graph
planner. It is an engine and contract boundary, not a live consumer feature.
The shipped metadata provider is explicitly `not_configured`; no catalog,
price feed, account connection, activation, completion, or execution path is
included.

## Model

An anonymous immutable `PlayerState` contains an explicit overall rating, the
six bounded face attributes, positions, roles, PlayStyles, PlayStyle+, rarity,
eligibility tags, and already-applied Evolution keys. It deliberately contains
no owned `itemId`, player/resource/definition ID, player name, URL, or arbitrary
metadata.

Planning edges are exact, closed provider-output records. Each edge carries a
verified evidence fingerprint, bounded eligibility gates, and deterministic
transform data. The planner rejects the complete request if any supplied edge
is unknown or unverified. This edge record is not a remote expression language
or an executable Evolution definition.

```text
anonymous PlayerState + verified edge records + explicit role objective
  -> bounded graph exploration
  -> deterministic non-dominated frontier
  -> immutable read-only alternatives
```

The objective is an explicit vector, never a hidden weighted score. Supported
dimensions include overall, each bounded attribute, desired position/role/
PlayStyle matches, eligibility-tag matches, and path length. This allows, for
example, a higher-OVR path and a lower-OVR but better role-fit path to remain as
separate Pareto alternatives. Display rank is deterministic but does not turn
the first result into a universal “best Evolution.”

The unevolved starting state is returned only as `baseline`; it never appears
as a recommended path. No eligible evolved state returns `NO_VERIFIED_PATH`.
Hitting a depth, node, edge-evaluation, or frontier bound returns `BOUNDED`, an
exact reason, and no partial alternatives.

## Safety boundary

`src/application/evolution-planner.js` imports no PlanCompiler, WorkflowEngine,
EA adapter/controller, browser API, transport, endpoint, token, or cloud code.
Its output is marked `readOnly: true` and `canExecute: false` and has no steps,
actions, commands, approvals, or owned-card identifiers. Fingerprints are local
deterministic change detectors, not authorization tokens.

`src/application/evolution-metadata-provider.js` defines exact FC26/FC27 request,
descriptor, and evidence contracts without inventing a live catalog shape. The
production provider supports no game versions and returns the stable
`PROVIDER_NOT_CONFIGURED` state after validating its request.

Tests use synthetic, redacted fixtures only. They prove deterministic ordering,
exact eligibility, cycle/reuse prevention, input/output immutability, evidence
binding, Pareto tradeoffs, identifier redaction, and fail-closed bounds.

## Data and launch gates

Before the product can expose Evolution planning, an owner must supply and
approve a lawful, maintained source for every catalog field, field-level
provenance and freshness, exact eligibility/transform adapters, authentication
and entitlement behavior, and local presentation/revalidation. FUT.GG has no
documented permission in this repository for Evolution data and must not be
scraped or presented as a licensed source.

The truthful release statement is:

> This release includes a deterministic local Evolution path-planning engine
> and synthetic contract fixtures. It does not include a live Evolution
> catalog, provider connection, price feed, activation, or execution.

The newer bounded beam strategy, named comparison modes, transparent FUT Magic
role profiles and Club Scan coordinator are specified in
[evolution-engine.md](evolution-engine.md). The original Pareto planner remains
the exhaustive-within-bounds oracle; beam results never claim completeness.
