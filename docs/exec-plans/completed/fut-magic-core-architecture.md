# FUT Magic core architecture — completed

## Outcome

FUT Magic now has immutable, serializable application contracts for explicit
`fc26 | fc27 | unknown` game context, evidence-backed capabilities and data
providers, goal-to-preview-plan compilation, Free/Pro entitlement decisions,
and collision-safe presentation slots. The Product Shell consumes the new game
context contract.

The architecture remains intentionally non-executing. The existing isolated
runtime and `WorkflowEngine` remain the only workflow owner and executor.

## Evidence

- Six focused application-contract tests pass.
- Full regression: 186/186 pass.
- Strict verifier and TypeScript `--noEmit`: pass.
- Compiled Side Panel/browser flow and visual captures: pass.
- Two successive runtime builds produced identical SHA-256 hashes for the
  isolated runtime bundle and both Side Panel artifacts.
- Package audit: 123 files before plan rollover; application source, local UI
  bundle, build scripts, GPL source, and Preact notice present; development
  output, `node_modules`, and captured sources absent.

## Decisions

1. FC27 and unknown contexts default to `unverified` and block plans.
2. Undeclared capabilities are unverified, never implicitly available.
3. Data providers return `{ value, evidence, observedAt }` envelopes.
4. Plan IDs are deterministic over normalized plan content.
5. Entitlements may gate product features, never safety invariants.
6. Surface-slot exclusive collisions throw instead of picking a hidden winner.

## Follow-up debt

- Bind real goal strategies through an ApplicationHost only after parity tests.
- Add inventory/policy/capability fingerprints before execution is possible.
- Replace Side Panel polling with a versioned reconnecting state port.
