# Reliability

## Destructive invariant

```text
validate approval → read preconditions → persist intent → execute once
→ observe post-state → verify → checkpoint
```

Ambiguous or unavailable post-state pauses for recovery. A reload reconciles an
in-flight write and never blindly repeats it.

## Current evidence

The 2.3 baseline has over 200 unit/integration tests, a Playwright HTTP harness,
multi-tab lease/CAS tests, atomic inventory generations, signed MAIN-world RPC,
protected-card regressions, and a 20-cycle destructive reload scenario.
Clear duplicates additionally binds the complete Unassigned set, exact route
actions, policy, capabilities, and expected residual set across approval,
workflow preparation, MAIN-world dispatch, postcondition verification, and
reload recovery.

The local Router is structurally read-only. It analyzes at most 5,000 total
items and 100 Unassigned items as one complete set or fails closed. Its
router-specific fingerprint includes exact identity/location, movement,
Storage and tradability values plus their provenance flags, relevant
capabilities, FC26 context, duplicate policy, protection/conservation evidence
and Activity Guard. Canonical selection is input-order invariant. Non-idle or
unknown Guard state, missing provenance, FC27, incoherent routes and oversized
inputs cannot produce a move recommendation. Runtime and presentation tests
prove zero adapter writes and recursively redact private bindings,
fingerprints, raw reason codes and objective tuples.

Card protection is deliberately read-only: `OPTIMIZE_FODDER` compiles a
`PROTECTION_REVIEW_V1` plan with `steps: []` and no approval path. Its canonical
fingerprints cover the full inventory fields that affect policy, policy Maps,
active projects, game/capability state, and boolean provenance. Display samples
are bounded, but safety inputs are never truncated. Missing favourite, locked,
protected, tradability, special, or active-squad evidence suppresses any
“not protected” claim and produces an explicit unverified state.

The Pro contract boundary is proposal-only and has no configured transport.
Exact schemas cap UTF-8 bytes, depth, arrays and strings; reject accessors,
cycles, non-JSON values, credentials, persistent EA IDs, URLs and executable
fields; and never truncate. Random handle maps are request-local and disposable.
Responses are bound to request/contract/fingerprint/expiry, locally revalidated,
and protected by bounded in-flight/success replay tracking. Timeouts and raw
provider failures are sanitized and cannot grant an entitlement or create work.
Only fresh `ready` entitlement evidence grants Pro; every other lifecycle state
returns the complete Free feature set.

The private Global Project Optimizer is designed but not implemented. Its
future release gates require black-box contract parity, independent exhaustive
solver oracles, deterministic property tests, auth/replay/privacy canaries,
failure injection, measured load/deadline ceilings, stale-state end-to-end
revalidation and rehearsed kill-switch/rollback. Proposed latency or capacity
targets are not current evidence.

FC27 is protected by independent compiler and execution boundaries. Raw or
factory-created verified FC27 contexts, an injected registry claiming a
verified strategy, and fully available capabilities still produce a blocked
zero-step plan without invoking the FC26 strategy. Explicit version changes
invalidate cached SBC, duplicate-route, Router, and protection plans. The
WorkflowEngine refreshes context before every FC26-semantic handler and pauses
FC27/unknown before solve, submit, claim, pack open, item movement, Organizer,
or Player Pick adapter calls. Streamlined facts reject guessed values and keep
unknown/unverified semantics null; the not-configured score provider performs
no transport and cannot fabricate scores.

Evolution graph planning is deterministic and proposal-only. Exact anonymous
player state, edge evidence, eligibility, transforms, objectives, and bounds
are fingerprinted. Unknown/unverified edges reject the request. The planner
detects semantic cycles and repeated Evolution use, does not truncate inputs,
keeps the zero-step state out of recommendations, and returns no partial
alternatives if any exploration or frontier bound is reached. Adversarial tests
also prove OVR-versus-role-fit nondomination, recursive immutability, owned-ID
redaction, and absence of execution fields. Live provider freshness and native
journey testing remain future gates because no live provider is configured.

Commercial hardening keeps every public-client boundary fail closed. The
not-configured cloud provider has an exact zero-configuration constructor and
cannot retain an injected transport. Authentication and entitlement evidence
rejects timestamps beyond a bounded clock-skew window; provider errors,
missing evidence, and future-dated assertions all resolve to the complete Free
feature set. FUT.GG traffic is hard-disabled, has no host permission, and is
blocked by the extension CSP. Legacy EA-origin league, nation, and player-cache
keys are purged and their replacements remain memory-only.

Support diagnostics are generated locally and minimize logs to time, level,
action, and a closed error code. Free-text messages, owned-player identifiers,
project names, challenge identifiers, cookies, credentials, and session tokens
are excluded or redacted. Packaging creates a root-manifest Chrome Web Store
candidate, a separately wrapped corresponding-source archive, and a release
record with SHA-256 hashes, revision, dependency-lock metadata, and a
candidate/release state. A dirty tree can only produce a candidate.

## Known gaps

- Golden EA fixtures and locale/version corpus.
- Native-extension Side Panel lifecycle automation.
- Complete recovery matrices for destructive operations beyond the now-covered
  duplicate route and SBC submission paths.
- Broader golden-fixture capability degradation and stale-plan matrices.
- Mechanical import-boundary and safety-free-across-tiers tests.
- Live Pro consent, service-worker transport and private-service integration;
  none is configured in this source release.
- Multi-step Router sessions, recipe/SBC/pack candidates, Assisted compilation
  and Auto routing; the current Router deliberately recommends one read-only
  ownership-preserving action only.
- Licensed live Evolution metadata, price, activation/completion adapters, and
  end-to-end provider freshness; only the local proposal engine exists.
- EA commercial authorization/name approval, licensed external providers,
  production account/billing/support infrastructure, operator identity and
  hosted privacy contact, exact tagged source, store media, and native release
  QA. These remain explicit commercial-readiness blockers.

## Activity scheduler and failure circuit

Every destructive workflow handler passes through the same persisted intent
boundary and then `OperationScheduler.preflight()` before dispatch. The
qualitative Activity Guard uses rolling 1m, 5m, 15m, 60m, 24h and session
history, actual classified EA-response health and a per-operation consecutive
failure circuit. It exposes NORMAL, ELEVATED, CAUTION, PAUSED and RECOVERY; it
does not expose or imply an official “safe” action quota.

The production runtime has no verified persistent FUT persona identifier. It
therefore uses an opaque browser-tab session partition, kept in session storage,
and stores each bounded ledger under a separate versioned key. Reloading the
page restores only that partition; a different tab/session does not inherit it.
Game-version filtering remains separate. This is an anonymous fallback, not a
claim of account/persona verification. If the partition or stored snapshot
cannot be restored safely, Activity Guard fails closed instead of silently
starting from NORMAL.

ELEVATED recent activity also applies a small centrally configured post-event
spacing interval before the next EA dispatch. The interval is an interruptible
reliability/pacing control, not an official EA quota or a guarantee against an
account restriction.

Scheduler failure after a verified operation never retries that operation. A
ledger failure pauses future work while preserving the completed postcondition.
Ambiguous or terminal EA responses move the guard to caution/recovery, and
three consecutive classified failures in one operation family open the local
circuit. These are reliability controls, not shadow-ban evasion promises.

## Milestone gate

Run `npm ci`, `npm test`, `npm run test:browser`, `npm run check`, and
`npm run package`. UI milestones additionally require screenshot review,
keyboard/focus review, reduced-motion/transparency checks, and an explicit note
when native Chrome/EA behavior remains unverified.
