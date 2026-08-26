# FUT Magic

> **Smarter plans. Better results.**

FUT Magic is a local-first Chrome/Edge extension for safe, explainable Ultimate
Team grinding. It preserves the proven AutoPilot-SBC solver and the mature
GrindPilot workflow/recovery foundation while evolving the product into a
goal-first operating layer.

> Unofficial. Not affiliated with or endorsed by Electronic Arts.

## Product direction

Users choose an outcome—complete an SBC, grind upgrades, clear duplicates,
protect fodder, or advance a project. FUT Magic observes the active EA Web App
context, explains the next safe action, compiles approved work to the local
workflow engine, verifies destructive results, and checkpoints recovery state.

The product has three surfaces:

1. compact contextual actions in the EA Web App;
2. a small active-run HUD;
3. a native Chrome Side Panel with Home, Projects, Club, and More.

The previous large in-page tool remains available under
More → Advanced → Legacy Tools during migration.

## FUT Magic Free and Pro

Internal tier identifiers are `free` and `pro`. Safety, protection, local
solver behavior, Review/Assisted modes, one active project, basic club health,
Activity Guard, explanations, recovery, and support diagnostics remain free.

FUT Magic Pro is intended for additional planning value such as global project
optimization, multi-step routing, advanced recipes, pack queues, analytics,
cloud profiles, and Evolution planning. A private Pro service is not included
in this public GPL repository. The present code defines strict proposal
contracts and deterministic tests only: no FUT Magic account, endpoint,
subscription or purchase path is configured.

## Safety model

Every state-changing operation follows:

```text
validate approval → read preconditions → persist intent → execute once
→ observe post-state → verify → checkpoint
```

Timeout is never success. Ambiguous submit, reward, pack, pick, or item state
pauses for recovery. Refresh recovery reconciles an in-flight operation before
anything can repeat.

Other hard rules:

- active-squad and explicitly protected cards are excluded and rechecked;
- owned-item identity remains separate from card-version/player identity;
- pack purchases, market automation, credential storage, and implicit quicksell
  are not supported;
- unknown requirements and controller states fail closed;
- the cloud must never possess an EA password, cookie, token, or session.

## Architecture

```text
Chrome Side Panel (Preact view models + typed commands)
        ⇅
MV3 service worker (tab broker, local solver, storage/lease, providers)
        ⇅
isolated EA-tab runtime (application contracts, domains, WorkflowEngine, HUD)
        ⇅ signed allowlisted RPC
MAIN-world EA bridge (controllers and postcondition observation)
```

The Side Panel does not execute workflows and never receives EA controllers,
DOM nodes, or raw workflow internals. The isolated EA-tab runtime remains the
single executor and multi-tab lease owner. Goal planning compiles immutable
preview plans against explicit game-context, capability, provider, and
entitlement evidence; it does not create a second execution path.

The first complete goal flow is available from a Target Project: **Preview
current squad** produces an exact, read-only 11-card proposal. **Build & submit
squad** then refreshes every evidence binding, rejects stale plans, re-solves,
and hands exactly one verified submission to the existing WorkflowEngine.

The second complete Free flow is **Clear duplicates**. It previews every
current Unassigned outcome, separates verified Club/SBC Storage moves from
items that stay for attention, and requires one explicit **Move N safe items**
approval. The approved workflow contains exactly one item-routing step—never
Organizer, SBC build/submission, pack opening, market activity, or quicksell.
Approval and execution each revalidate the complete Unassigned evidence.

That journey now also shows one deterministic **Recommended next** result from
a separate local Router domain. The recommendation is read-only, bounded,
Activity-Guard-aware and stripped of owned-card identifiers. It never approves
or executes anything; the existing Clear duplicates plan remains the only item
movement path. Multi-step, Assisted and Auto routing are not implemented.

The native **Card protection** journey is a third Free, read-only slice. It
recomputes current hard exclusions with the same `FodderPolicy` used by SBC
previews, then separates them from rating/special reserves and local squad
selection preferences. When EA does not expose enough flag provenance, FUT
Magic shows verified positive exclusions while marking the full count
unavailable; it never labels unknown cards safe or claims global optimization.

The **Evolution Brain** is now a separate deterministic graph-planning engine.
It preserves explicit OVR-versus-role-fit Pareto alternatives, reports the
unevolved card only as a baseline, and fails closed on unknown evidence or any
search bound. It is not connected to the product journey: the shipped metadata
provider is not configured, and no live catalog, price feed, activation, or
execution exists.

Canonical documentation:

- [`AGENTS.md`](AGENTS.md)
- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DESIGN.md`](docs/DESIGN.md)
- [`docs/FRONTEND.md`](docs/FRONTEND.md)
- [`docs/RELIABILITY.md`](docs/RELIABILITY.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/LICENSING.md`](docs/LICENSING.md)
- [`docs/PRO_CONTRACTS.md`](docs/PRO_CONTRACTS.md)
- [`docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md`](docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md)
- [`docs/FC27.md`](docs/FC27.md)
- [`docs/EVOLUTIONS.md`](docs/EVOLUTIONS.md)
- [`docs/COMMERCIAL_READINESS.md`](docs/COMMERCIAL_READINESS.md)

## Installation (unpacked)

1. Download or clone the repository.
2. Run `npm ci` and `npm run build:runtime`.
3. Open `chrome://extensions` (or the Edge equivalent).
4. Enable Developer mode and choose **Load unpacked**.
5. Select this repository and reload the EA Web App.
6. Use the FUT Magic toolbar action on a supported EA Web App tab.

Node.js 20 or newer is required for development. No Python service is needed.

## Development and release gate

```bash
npm ci
npm test
npm run test:browser
npm run check
npm run package
```

`npm test` covers solver constraints, FC26 rating, identity, inventory,
protection, projects, packs, picks, profiles, workflow recovery, signed RPC,
application contracts, one-action Router determinism/redaction, duplicate-route
staleness/recovery, protection-review evidence/fingerprints, Evolution graph/
Pareto/boundary contracts, message schemas, and product view models. `test:browser`
renders the actual Side Panel document,
HUD, legacy panel, and contextual actions in deterministic local harnesses and
captures review screenshots under `output/visual-review/`.

`npm run package` creates a root-manifest Chrome Web Store candidate ZIP, a
separate corresponding-source ZIP with tests/build inputs, and a release JSON
containing artifact hashes plus clean-tree/candidate status.

## Backward compatibility

Existing `grindpilot.*` storage keys and runtime file names are intentionally
preserved. They may already contain user projects, settings, profiles, activity,
and recovery state. Customer-facing branding is FUT Magic; technical legacy
names are migration details and will change only through versioned, tested work.

## Limits and commercial launch gates

- EA controllers are undocumented and live EA behavior is not proven by mocked
  browser fixtures.
- FC27 rules are `UNKNOWN`/`UNVERIFIED`; no FC27 destructive support is claimed.
- FUT.GG code is hard-disabled and has no host permission in this release.
  Re-enabling it requires written automated/commercial-use permission, consent,
  strict response validation, and a reviewed privacy disclosure.
- EA automation/extension terms and the FUT Magic product name require an
  explicit owner/legal decision before commercial launch.
- The public client is GPL-3.0-only. A private Pro service needs a genuine
  network/repository/build boundary and must return bounded data plans only.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), [`PRIVACY.md`](PRIVACY.md),
[`docs/LICENSING.md`](docs/LICENSING.md), and
[`docs/COMMERCIAL_READINESS.md`](docs/COMMERCIAL_READINESS.md).
