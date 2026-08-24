# Changelog

## 2.1.2 - 2026-08-24

- Moved GrindPilot persistence into typed, schema-validated extension commands
  and added serialized, tab-owned workflow revisions.
- Added fail-closed recovery, EA response, unassigned and reward-pack
  correlation behavior around destructive actions.
- Fixed the isolated content-script bootstrap and allow immediate, verified
  recovery when a previous workflow-owner tab has been closed.
- Preserved complete imported profile limits and hidden protected-card rules.
- Protected locked/upstream-protected cards, serialized inventory refreshes and
  prevented base/promo versions of one footballer from sharing a solved squad.
- Made required-special stop conditions use fresh normalized inventory instead
  of treating missing context as an empty club.
- Added targeted service-worker, workflow, UI, reward and solver regressions.

## 2.1.1 - 2026-08-24

- Replaced the inherited shield artwork with an original, clean blue
  GrindPilot navigation-loop icon at 16, 32, 48 and 128 pixels.
- Added a scalable SVG master and release checks for manifest icon files and
  their declared PNG dimensions.

## 2.1.0 - 2026-08-24

- Renamed the unified extension to GrindPilot FC26.
- Added a revisioned workflow state machine with typed steps, conditions,
  bounded loops/retries, durable intents and reload recovery.
- Added REVIEW, ASSISTED and hash-bound AUTO approval modes.
- Added a central owned-item inventory model, duplicate planner and safe SBC
  Storage handling; no implicit quicksell path exists.
- Added correlated owned-reward pack opening and unassigned blocking.
- Added configurable fodder conservation and arbitrary Target Projects.
- Added player-pick policies with fail-safe user pause when EA state is not
  sufficiently observable.
- Added grind profiles, bounded redacted activity logs, a single in-Web-App
  panel and opt-in Developer Mode.
- Added FC26 rating, identity, policy, workflow, pack, pick, profile, inventory,
  recovery and diagnostics tests.

## 2.0.0 - 2026-08-24

- Established AutoPilot-SBC as the local-first runtime base.
- Added Auto-SBC-inspired player replacement-value policy.
- Fixed fail-open unknown requirements, insufficient pools and zero targets.
- Fixed preferred-position chemistry matching.
- Hardened solver bridge protocol, readiness, limits and timeouts.
- Added FUT.GG request deadlines, allowlists and transient-error backoff.
- Reduced extension resource/frame exposure.
- Added automated regression and manifest verification tests.
- Added privacy, architecture, upstream-analysis and license provenance docs.
