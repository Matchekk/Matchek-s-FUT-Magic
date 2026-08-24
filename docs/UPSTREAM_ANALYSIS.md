# Upstream analysis

Analyzed snapshots:

- Auto-SBC `98279901aab056dd1189df763b750ea86095e3fb`
- AutoPilot-SBC `ebf5d1e90f13329841896d8be227b3d55dd28c3b`

## Decision summary

AutoPilot-SBC is the product/runtime base. Auto-SBC contributes domain ideas,
not its runtime. This keeps installation local-first and avoids exposing a
CPU-heavy unauthenticated backend or persisting the club inventory on disk.

| Area | Kept | Rewritten or dropped |
|---|---|---|
| Extension shell | AutoPilot MV3, storage, EA adapters | reduced frame/WAR scope |
| User flows | Single, Multi, Set, Sequence | duplicate solver event channel removed |
| Inventory/apply | AutoPilot caches and concept safeguards | tighter message validation |
| Solver | AutoPilot compiler, matching, concepts, diagnostics | fail-open rules and pool-size bug fixed |
| Cost policy | Auto-SBC duplicate/untradeable/zero-cost concepts | local typed JS policy, no backend |
| Exact solving | Auto-SBC CP-SAT idea only | existing CP-SAT implementation rejected |
| Prices | AutoPilot credential-free FUT.GG proxy | sort allowlist, deadlines, transient errors |
| GLPK | nothing | unused JS/WASM blobs excluded |

## Why Auto-SBC was not used as the runtime

The reviewed backend allows wildcard CORS, binds to `0.0.0.0`, accepts raw
unbounded solve bodies and can combine ten request threads with 24 OR-Tools
workers each. It writes full/filtered/final player datasets and global solver
logs to CSV. The userscript also loads runtime CDN code, including an HTTP D3
URL, and contains several global EA prototype patches.

Correctness blockers included club pagination retaining only the last page,
frontend promises that never settle after request failure, free/unbound
chemistry result variables, inconsistent brick/rating handling, ignored
requirement scopes and hard 50,000-coin pruning that can remove necessary
candidates.

## AutoPilot issues fixed in this derivative

- required squad size was capped to available players, so 10/11 could pass;
- unknown raw requirement types and known-but-unimplemented Legend/Trophy types
  were accepted and then evaluated as success;
- zero targets were discarded, breaking rules such as Loan players Max. 0;
- preferred position was ignored when an alternatives array existed;
- fake solver INIT, 65-second cross-layer timeout mismatch and ambiguous port
  message types;
- long-lived FUT.GG page loops and ten-minute caching of transient failures;
- all-frame injection and `<all_urls>` web-accessible resources.

## Important remaining limitations

AutoPilot's solver is a sophisticated multi-start heuristic, not an exact
optimizer. Its large page bridge and solver file still need staged
modularization. FC-26 chemistry boosts for Icons, Heroes, Cornerstones and
future card types need verified replay fixtures before implementation.

This document is a technical assessment, not legal advice. AutoPilot is GPLv3;
Auto-SBC is MIT-compatible with a GPLv3 combined work when its notice is kept.
