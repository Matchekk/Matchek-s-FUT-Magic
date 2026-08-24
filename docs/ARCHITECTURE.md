# Architecture and next steps

## Current hardened architecture

The runtime keeps AutoPilot-SBC's useful privilege split:

1. `page/ea-data-bridge.js` runs in the page's MAIN world because EA's private
   controllers are not visible to an isolated content script.
2. `content-script.js` validates solver operations, request identifiers, payload
   shape/size and timeout before forwarding to the extension runtime.
3. `background.js` validates the sending EA top frame, routes local solves and
   performs bounded, credential-free FUT.GG requests.
4. `solver/` is side-effect-free domain code except for the orchestration cache.

## Target module boundaries

The upstream page bridge remains too large. Changes should progressively move
it behind these boundaries without changing behavior:

- `ea-adapter`: controller discovery, inventory reads, apply and submit only;
- `contracts`: versioned request/response schemas and limits;
- `settings-repository`: normalization, migration and atomic updates;
- `automation`: explicit single/multi/set/sequence state machines;
- `ui`: rendering and user confirmation, with no direct EA-controller access;
- `solver-worker`: cancellable extension-owned compute host;
- `prices`: optional FUT.GG client with deadline, pacing and typed cache states.

## Solver direction

The current solver is kept because it has broad requirement normalization,
concept handling, position matching, diagnostics and replay-friendly output.
It now fails closed for unknown requirements and capacity errors.

A future exact engine must not copy Auto-SBC's current CP-SAT model verbatim.
It should use player-by-slot variables, include occupied/fixed players in every
constraint, model all Min/Max/Exact scopes, use versioned rating/chemistry
kernels and return explicit `OPTIMAL`, `FEASIBLE_TIMEOUT`, `UNKNOWN_TIMEOUT` or
`INFEASIBLE` status. The existing heuristic can provide warm starts.

Every exact-engine result should be checked by an independent validator built
from the original raw requirements.
