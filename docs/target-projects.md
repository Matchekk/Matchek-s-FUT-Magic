# Target Projects

Target Projects reserve cards for a larger SBC goal while smaller repeatable
SBCs are being ground. A project can be entered manually or imported from the
SBC set currently open in the EA Web App.

## Data model

Each project stores its own stable project ID, name, priority, active state,
remaining squads, rating requirements, special-card requirements, explicit
hard protections and soft rating reserves. An imported project additionally
stores the EA set ID, every mapped challenge ID and the last verified
completion state for each challenge.

An import uses only requirement types that the bridge can identify exactly.
Unknown requirements are retained on the source challenge and shown as
unknown; they are never converted into guessed rating or special-card demand.
Synchronization is accepted only when the currently open set has the same set
ID and every stored challenge ID maps exactly once.

## Protection behavior

- Explicit item/player/resource IDs, selected exact ratings and the configured
  hard rating threshold exclude cards before solve and are checked again before
  submit.
- Rating reserves, special reserves and future squad demand are soft,
  lexicographic conservation objectives. They influence which valid solution
  wins but cannot make a genuinely solvable SBC appear impossible.
- A challenge is marked complete only after submission completion is verified,
  including verified reload recovery. Progress is not incremented on a click
  response alone.

The dashboard shows completed/total squads, remaining rating buckets, special
requirements, local coverage and the active protection summary.
