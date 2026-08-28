# Evolution engine

FUT Magic Evolution planning is a read-only proposal domain. It consumes
normalized `PlayerState` and verified, versioned Evolution definitions; it does
not consume raw EA controllers or permit execution.

## Core

- `evaluateEvolutionEligibility` returns deterministic closed reason codes.
- `applyEvolution` is immutable and supports only verified transformation rule
  versions.
- `beamSearchEvolutionPaths` is a deterministic heuristic with hard depth,
  width, edge, node and evaluation bounds.
- Semantic cycle checks, layer deduplication and diversity filtering prevent
  repeated equivalent outcomes.
- Every returned path is replayed through the public eligibility and simulator
  APIs step by step.

Beam results explicitly report `globallyOptimal: false` and
`searchComplete: false`. Hitting a hard compute bound returns no partial result.

## Scoring and Club scan

FUT Magic owns transparent role profiles for ST, CAM, wings, midfield,
full-backs, centre-back and goalkeeper. The weights are product preferences,
not copied third-party grades. Named modes include final OVR, biggest upgrade,
shortest strong path and selected-role score.

The Club Scan coordinator accepts only verified candidates bound to one
inventory generation and catalog fingerprint, is capped at 250 candidates,
and yields between candidates so an `AbortSignal` can stop it. One aggregate
node/evaluation budget covers the full scan in addition to each per-player
search bound. Cancellation or exhausted budget returns no partial executable
result, and no owned item IDs reach public execution surfaces.

Live UI remains disabled until a lawful, complete metadata provider and FC27
fixture gate exist.
