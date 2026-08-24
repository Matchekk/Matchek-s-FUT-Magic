# GrindPilot FC26 upstream analysis

Reviewed on 2026-08-24. Repositories under `sources/` are local, ignored audit
snapshots and are never part of the extension package.

## Decision matrix

| Feature | Best source or reference | License at reviewed snapshot | Decision | GrindPilot target |
|---|---|---|---|---|
| Existing MV3 runtime, EA bridge, single/multi/set/sequence UI and browser solver | AutoPilot-SBC `ebf5d1e90f13329841896d8be227b3d55dd28c3b` | GPL-3.0 | Canonical copied/adapted base; preserve behavior | legacy page bridge plus `src/ea` and solver adapter |
| Cost overrides, duplicate/storage preference, pack/unassigned behavior and CP-SAT ideas | Auto-SBC `98279901aab056dd1189df763b750ea86095e3fb` | MIT | Independently reimplement behavior; do not copy the userscript or Python runtime | inventory, policies, packs, optional future solver |
| DOM settling, bounded retry, rejection and re-entry behavior | sbc-repeater `25d5d4b10a51d444732fc9f54a1fa16f7d74503b` | MIT © 2026 Jijo | Independently reimplement as verified fallback; no Paletools dependency | `DomFallbackAdapter` |
| Class discovery, snapshots/diffs and bounded diagnostics | fut-debug-overlay `e3e3f1cf0514972186aeba496f8570bdba80695f` | Root MIT © 2026 tomolom; package metadata says ISC | Ideas only because metadata conflicts; no invasive global hooks | `src/dev` |
| Open CP-SAT modelling and constraint coverage | Regista6 solver `b81c71f992d82a3543050e1fb96c95166f3a6c05` | MIT © 2023 watchdogs132 | Study models and create independent fixtures; no Python runtime | solver tests and future optional adapter |
| Solver API and negative correctness cases | bartlomiej solver `8d7a2d08cbc54e7ab20915d33901f714239e6b94` | MIT © 2024 bartlomiej-niemiec | Test reference only; reject its rating and chemistry implementations | regression suite |
| Browser worker and player-blocking UX | kosciukiewicz solver `126483eee2257541c832751f853d7ce87a7f4e33` | MIT © 2024 Witold Kościukiewicz | Ideas only; external WASM engine has no verified source/license in the repo | future worker adapter and protected-card UI |
| FC26 identity, conservation objectives and benchmark principles | solva-sbc-solver `0e63c1422335dae27e135ed917c9cf2ac56da8c5` | No explicit license found | Strict behavior reference; clean-room implementation, no source/tests/fixtures copied | inventory identity, policies, benchmark harness |
| EA interaction/service boundaries and caches | SunFlower fork `cab71138c7e35c21305401264b5849d77f0a5c50` | No explicit license found | Strict architecture reference only | domain/service boundaries |
| Parent bridge, logging and popup architecture | parent copilot `dcaaaa1d3fc7c99fe8e5eaaf05d70c9f5a32ef38` | No explicit license found | Strict architecture reference only; exclude market/session tooling | adapter, logger and UI boundaries |

## Keep, rewrite, reject

### Keep from AutoPilot

- Manifest V3 shell and local-first execution.
- Existing Single, Multi, Entire Set and Sequence flows during migration.
- EA challenge discovery, inventory reads, squad apply protections and concept
  fallback.
- Requirement compiler, heuristic solver, exact fixed-squad position matching,
  rating/storage/tradable/card-type filters and diagnostics.
- FUT.GG concept-price proxy with credential-free requests.

### Rewrite behind stable interfaces

- Sequence execution becomes a persisted explicit state machine.
- Club, Storage and Unassigned data become one item-ID-keyed inventory model.
- Reward, pack, duplicate, storage and player-pick operations return typed
  verified/ambiguous/unavailable results.
- Fodder selection becomes a configurable lexicographic conservation policy.
- Debugging becomes opt-in, bounded and read-only by default.

### Reject

- Auto-SBC's unauthenticated Python service, wildcard CORS, CSV inventory dumps,
  unsafe pruning and broken chemistry result model.
- Paletools dependencies and unverified broad DOM clicks.
- The unprovenanced GLPK/WASM blobs and the opaque external WASM engine.
- Global UT/DOM/EventTarget monkeypatching, response bodies, headers, query
  strings or session data in diagnostics.
- Any autobuyer, sniper, bid/list strategy, credential persistence or external
  account/session harvesting.

## Solver findings

AutoPilot remains the production default. The reviewed Python solvers contain
useful modelling ideas but also name-based identity, incorrect rating or
chemistry rules, season-specific special-card assumptions, and no suitable
browser runtime. A future exact solver must sit behind the same interface and
beat the default on independently authored fixtures before release.

The baseline suite must cover the 0.96 rating boundary, club/league/nation
composition, rare versus TOTW semantics, chemistry thresholds and off-position
players, protected high-rated cards, and multiple owned versions/copies. Timing
is reported as p50/p95, never used as a cross-machine correctness assertion.

## Clean-room boundary

No source, test fixture, selector string or substantial expression from the
three unlicensed repositories is copied. Their public behavior is translated
into requirements, then implemented and tested independently. Market and
session-token features seen in references are explicitly outside GrindPilot's
scope.
