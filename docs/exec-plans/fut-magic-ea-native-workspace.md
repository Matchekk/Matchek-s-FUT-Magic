# FUT Magic EA-native workspace

## Goal

Expose the protected local grind planner as a first-class planning route inside
the EA Web App while retaining the native Side Panel, compact HUD, and verified
WorkflowEngine execution boundary.

## Clean-room research outcome

Public AutoPilot-SBC and locally delivered competitor browser packages were
reviewed for observable architecture and product behavior only. No proprietary
source, artwork, copy, selectors owned by another extension, or remote service
contract is copied into FUT Magic.

Patterns worth implementing independently:

- a native EA navigation-controller route rather than a detached dashboard;
- one restrained FUT Magic tile on the EA home hub;
- a full-height task workspace that preserves EA navigation and back behavior;
- saved plans, clear execution state, and immediate route entry.

Patterns deliberately rejected:

- broad unrelated prototype patching;
- all-URL web-accessible resources;
- account tokens, remote telemetry, or third-party API coupling;
- copied player/card artwork or large embedded raster assets;
- unattended or ban-avoidance claims.

## Milestones

- [x] Add an isolated, idempotent native-workspace adapter in the MAIN world.
- [x] Mount the existing grind planner inside an EA view-controller route.
- [x] Add a native home-hub tile and branded SBC-hub entry.
- [x] Re-skin the planner with canonical FUT Magic semantics and accessibility.
- [x] Add boundary, manifest, browser, and package verification.

## Invariants

- The new native layer provides navigation and presentation only; it cannot
  call EA mutation controllers directly.
- Native execution remains disabled and is labelled `Planning only` until a
  typed command delegates through the isolated WorkflowEngine and scheduler.
- The legacy overlay remains available only as an Advanced compatibility tool;
  it is not represented as the verified native execution path.
- If EA native view APIs are absent or change, opening falls back to that
  compatibility overlay without silently starting work.
- Leaving the native route never converts an ambiguous run into success.
- The adapter is local, dependency-free, and exposes no new network origin.
