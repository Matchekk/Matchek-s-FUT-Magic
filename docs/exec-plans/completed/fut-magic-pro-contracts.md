# FUT Magic Pro contracts execution plan

## Objective

Define and test the public GPL client's future Pro service boundary without
inventing a live backend. Cover authentication state, entitlements, cloud plan
proposals, project optimization, Smart Router, recipe catalog, and
compatibility configuration with deterministic local fakes.

## Current state

- Free/Product Shell entitlements are synchronous local plan checks.
- `DataProvider` supports evidence-backed reads but not remote request
  validation, deadlines, or closed response schemas.
- No auth account, subscription purchase, or private planning service exists.
- The public client already owns Goal/Plan compilation, capability validation,
  workflow execution, approvals, and recovery; those responsibilities stay
  local.

## Decisions

- Public contracts and validators live in `src/application`; they are GPL.
- Providers exchange bounded versioned data only. They never receive EA
  passwords, cookies, tokens, controller objects, DOM, raw URLs, or remote code.
- Owned inventory references crossing a future cloud boundary use request-local
  opaque handles, not persistent EA item IDs.
- Cloud responses are proposals, never executable workflow definitions. The
  public client independently validates, explains, and compiles allowlisted
  operations.
- Deterministic fake providers prove states and schemas; this milestone adds no
  network origin, sign-in UI, payment flow, or server.

## Work

- [x] Define bounded schema helpers and stable contract errors.
- [x] Define AuthProvider and explicit signed-out/offline/error states.
- [x] Define EntitlementProvider with expiry/evidence and Free-safe fallback.
- [x] Define CloudPlannerProvider request/response envelopes and deadlines.
- [x] Define ProjectOptimization and SmartRoute schemas with local handles and
  closed recommendation types.
- [x] Define RecipeCatalog and CompatibilityConfig schemas with provenance,
  expiry, game-version, and capability evidence.
- [x] Add deterministic fakes and contract/adversarial tests.
- [x] Document licensing, privacy/data minimization, MV3 remote-code, offline,
  and local-compilation boundaries.
- [x] Run full test, browser, check, package, and archive inspection gates.

## Acceptance

- Unknown fields, versions, enum values, oversize payloads, persistent EA IDs,
  credentials, URLs, executable code, selectors, expressions, and arbitrary
  workflow graphs are rejected.
- Provider timeouts/errors never grant Pro or produce executable work.
- Free safety/protection/local solving remains available offline and signed out.
- Entitlements are evidence-backed, bounded, expiring, and fail to Free.
- Every response recommendation names only request-local handles and one of a
  closed set of locally understood operations.
- Compatibility configuration can disable/unverify capabilities but cannot
  enable unimplemented game semantics or inject logic.
- No manifest host permission, backend URL, credential storage, or purchasing
  path is added.

## Evidence log

Implementation:

- Public modules live in `src/application/pro-contracts/` and are exported from
  the application barrel.
- Deterministic successful provider fakes live only under `test/support/`.
- `docs/PRO_CONTRACTS.md` records the canonical public/private, privacy,
  compatibility and future live-transport boundary.
- The manifest and CSP have no new origin or permission. CloudPlannerProvider
  accepts an injected transport only and has no direct network primitive.

Validation so far:

- Pro-focused suites: 57/57 passing.
- Full `npm test`: 276/276 passing in 49.9 seconds.
- `npm run test:browser`: passed after rebuilding both runtime bundles.
- `npm run check`: passed repository verification and `tsc --noEmit`.
- `npm run package`: packaged 143 files as `dist/fut-magic-2.3.0.zip`.
- Archive inspection found all 11 public Pro contract modules, source/build
  prerequisites and `docs/PRO_CONTRACTS.md`; it found no tests, deterministic
  fakes, private backend, environment file or additional service origin.

## Follow-up boundary

A live Pro service remains a separate milestone and repository. It is blocked
from this public build until there is a reviewed fixed origin, purpose-specific
consent/disclosure, private implementation, service-side entitlement
enforcement, signed provenance, MV3 transport adapter and live end-to-end safety
verification. This milestone intentionally does not simulate those systems.
