# Private Global Project Optimizer implementation plan
Status: **designed, not implemented or deployed**.

No private FUT Magic backend workspace, service origin, credentials, billing
system or commercial-data authorization is available in this program
workspace. This document is the handoff for a future separately governed
private repository. It does not claim a working Pro service or measured
production performance.

## Scope and non-goals

The first service implements only the published exact
`project_optimization.v1` protocol. It allocates request-projected FC26 cards
across fully known 11-card squad requirements containing:

- a squad-rating target;
- zero or more closed special-class counts;
- request-declared local eligibility edges.

It does not understand chemistry, league, nation, club, rarity, position,
Formation, FC27, arbitrary FodderPolicy settings or EA controller behavior.
Any requirement the public client cannot represent exactly must prevent request
creation; it must not be omitted or guessed.

The service is a deterministic optimizer, not an LLM. Its result is a bounded
proposal. The public extension continues to own protection, freshness,
identity, capability checks, explanations, preview, approval, workflow
compilation, EA interaction, verification, checkpointing and recovery.

## Repository and licensing boundary

Create a separate private repository, Git history, build, artifact registry,
deployment, secrets store and CI. The service must independently implement the
published behavioral protocol and must not import or copy the GPL extension's
validators, solver, tests, fixtures or domain implementation.

For conformance, run the public GPL client/validator as a separate black-box
process or test client. Do not link it into the private service. If a shared
language-neutral schema package is desired later, it must be newly authored,
narrowly scoped, wholly owned and separately licensed with explicit owner/legal
approval; moving current GPL files does not change their license.

Before launch, private CI must produce a dependency/SBOM/license report and
reject public-repository imports or suspicious copied code. Public extension
artifacts continue to receive immutable corresponding-source archives, hashes,
build instructions, lockfiles, notices and dependency licenses.

## Service architecture

```text
fixed HTTPS POST /v1/project-optimizations
  -> bounded JSON edge
  -> FUT Magic identity verification
  -> server-side entitlement + consent verification
  -> independent exact v1 validation
  -> atomic quota/idempotency admission
  -> deterministic optimizer worker
  -> independent semantic response validation
  -> detached provenance signature + no-store response
```

Components:

1. A fixed API edge accepts only the reviewed route, JSON content type and
   decoded bodies up to 512,000 bytes. It rejects redirects and compressed-body
   expansion beyond the limit.
2. An identity gateway validates FUT Magic account credentials obtained with an
   owner-approved OIDC Authorization Code + PKCE flow. It never accepts EA
   credentials, cookies, authorization/session material or Web App data.
3. An entitlement authority reads current server-side subscription state. The
   client snapshot is UX evidence and never authorizes paid compute.
4. A consent verifier checks the current Project Optimization disclosure receipt
   in transport metadata; the exact v1 JSON body is not widened.
5. An independently authored validator enforces every published exact-key,
   enum, structural, time and size bound.
6. A bounded idempotency/quota store provides atomic admission, one active job
   per account, replay control and short-lived successful-response reuse.
7. A pure optimizer worker receives only an immutable normalized DTO and
   cancellation deadline. It has no account, billing, transport or EA access.
8. An independent response validator recomputes every allocation constraint.
9. A provenance signer signs a digest in detached HTTP headers without adding
   fields to the exact response body.
10. Allowlisted metrics/tracing, deployment control and an incident kill switch
    observe codes and aggregate sizes/timing—not card payloads.

The future MV3 adapter lives only in the service worker. It owns the fixed
origin, FUT Magic token, bounded streaming response reader, origin/content-type
checks and detached-signature verification. `CloudPlannerProvider` remains
token-free and transport-injected.

## Normative v1 request interpretation

- `fingerprint` is an opaque client binding value. The server must echo it and
  must not infer its algorithm or use it as the idempotency body digest.
- The server separately canonicalizes the validated body and computes SHA-256.
- `itemHandle`, group, project and requirement handles are meaningful only
  inside this request and must never be stored as cross-request identities.
- `eligibleRequirementHandles` is the complete local hard-eligibility edge set.
- `localCost` is a bounded, additive client-derived tail penalty. It is not a
  market price and the service must not enrich or reinterpret it.
- `versionGroupHandle` is informational in v1; it does not create another
  exclusion rule. A non-null `playerGroupHandle` is unique within one squad.
- Hard-protected and active-squad cards are absent, not tagged. Their appearance
  as extra fields is invalid input.
- `unknownRequirementCount` must be zero. FC27 is rejected.

The server should apply a stricter pre-solve complexity gate without changing
the public protocol: no more than 40,000 eligibility edges, 20,000 edges in one
connected component, 256 MiB estimated solver memory or the configured
deterministic work budget. Rejection is explicit; never truncate or sample.

## Deterministic optimization model

Let candidate `i` and requirement `r` be connected only when the request names
the eligibility edge.

- `x[i,r] ∈ {0,1}`: candidate `i` is assigned to requirement `r`.
- `y[r] ∈ {0,1}`: requirement `r` receives a complete valid squad.
- `g[r] = 1 - y[r]`: requirement `r` is a coverage gap.

Hard constraints:

1. `x` exists only on declared eligibility edges.
2. `sum_i x[i,r] = 11 * y[r]`.
3. `sum_r x[i,r] <= 1`; one owned item is used globally at most once.
4. For each non-null player group and requirement,
   `sum_group x[i,r] <= 1`.
5. Each declared special-class count is met when `y[r] = 1`.
6. Each fulfilled squad meets the exact public FC26 rating function.

### Exact FC26 rating encoding

For requirement `r`, let `S[r] = sum_i rating[i] * x[i,r]`. For each selected
edge, binary `a[i,r]` identifies a rating strictly above the squad average and
integer `d[i,r]` equals `11 * rating[i] - S[r]` only in that case. Enforce:

- `a <= x`;
- `a = 1 => 11 * rating[i] >= S[r] + 1`;
- `x = 1, a = 0 => 11 * rating[i] <= S[r]`;
- `x = 0 => a = d = 0`.

Then `N[r] = 11 * S[r] + sum_i d[i,r]` is 121 times the adjusted average.
For target `T`, define `H(T) = 100 * (T - 1) + 96`. The exact positive-number
rounding threshold used by the public FC26 implementation is:

```text
200 * N[r] >= 121 * (2 * H(T) - 1)
```

Apply it only when `y[r] = 1` using checked integer big-M constraints. Use no
floating-point feasibility decision.

## Immutable v1 model objective

Solve these minimization stages lexicographically and fix each proven optimum
before starting the next stage:

1. uncovered requirement count;
2. sum of `(priority + 1)` for uncovered requirements;
3. selected special-card count;
4. selected non-duplicate count;
5. selected non-SBC-Storage count;
6. tradability risk (`untradeable=0`, `tradable=1`, `unknown=2`);
7. flexibility loss `max(0, eligible-requirement degree - 1)`;
8. high part of total `localCost` in base 1,000,000,000;
9. low part of total `localCost`;
10. total FC26 rating overshoot.

This chooses the maximum number of covered squads first. Project priority
chooses among equal-coverage outcomes; it does not sacrifice several coverable
low-priority squads for one high-priority squad. That is an explicit v1 product
decision. Any different objective order requires a new immutable `modelVersion`
and product/contract review.

Return the ten bounded fields above as `objectiveTuple`. The tuple describes
only the sanitized v1 model, not the user's whole club or arbitrary local policy.
Stable canonical handle rank may break a final semantic tie internally but is
not an objective field or user-facing quality claim.

## Solver implementation

The recommended first implementation uses OR-Tools CP-SAT or an equivalently
auditable integer solver:

- canonical-sort projects, requirements and candidates by request handle;
- decompose the eligibility bipartite graph into independent components;
- seed a deterministic feasible hint from most-constrained requirement, then
  higher priority, preservation tuple and handle;
- use integer-only modeling, one worker, fixed seed/search parameters and an
  immutable `modelVersion`;
- use one global deterministic work budget across sequential objective stages;
- if a stage is not proven, do not optimize later stages as though it were;
- allow only proven-safe preprocessing such as removing zero-edge candidates;
- propagate cancellation to queued and active solve work;
- cap incumbent counters and check all integer arithmetic.

Changing solver version, seed/search behavior, rating semantics, objective
order or deterministic tie behavior requires a new model version. Changing
exact request/response structure requires `project_optimization.v2`.

## Response semantics

- `complete`: every requirement has one allocation and there are no gaps.
- `partial`: at least one allocation and one gap; every requirement appears
  exactly once across those collections.
- `infeasible`: zero allocations and a gap for every requirement, only after
  proving that no requirement can receive a valid squad.
- A deadline with no valid incumbent is a provider timeout, never a fabricated
  infeasible response.
- `globally_optimal`: a complete result with every lexicographic stage proven.
- `best_found`: a valid complete or partial incumbent without full proof; add
  `best_effort_not_proven_optimal`.
- `evaluatedAllocationCount`: a saturating count of feasible complete 11-card
  per-requirement allocations admitted to global search, not solver branches.
- `missingCandidateCount`: after committed allocations,
  `max(1, 11 - maximum eligible distinct-player matching size)` for the gap.
  Rating/special infeasibility therefore conservatively reports at least one.

Reason and warning codes are mechanically derived from feasibility/objective
deltas. They are never model-authored free text.

## Replay, quotas and failures

Atomically key idempotency by `(accountId, contract, requestId)` and store the
canonical request digest, opaque fingerprint, model version and expiry.

- Same key/digest while running: bounded retry response; do not start a second
  solver.
- Same key/digest after success: return the byte-identical fresh cached response.
- Same key with changed digest/fingerprint: idempotency conflict.
- Expired requests/results: reject and never extend lifetime.
- Worker lease recovery uses fencing tokens; stale workers cannot publish.
- Cache entries are model-version scoped across canary and rollback.

Initial hard ceilings, pending measurement:

- published 512,000-byte / 5,000-candidate / 100-project / 500-requirement /
  five-minute request limits;
- one active optimization per account and a small bounded global queue;
- token-bucket request and daily complexity quotas based on edges/components;
- server deadline = minimum of request expiry, 30 seconds and adapter deadline,
  with time reserved for output validation/signing;
- per-job CPU/memory isolation and overload shedding with a closed error;
- no unbounded queue, retry, log, trace, cache or callback collection.

`429`, dependency-unavailable and deadline outcomes are transport/service errors,
not optimization response statuses. Raw stacks, bodies, headers and dependency
messages must never reach the client.

## Data, consent and retention gates

Treat optimizer requests as account-linked pseudonymous data even though card
handles are random. Before first transmission, present the service operator,
specific purpose, recipients/subprocessors, exact data categories, persistence,
retention class, policy version and withdrawal method. Confirm that EA
credentials, persistent IDs and protected cards are excluded and that consent
does not cover analytics, diagnostics, advertising or model training.

An approved retention schedule must exist before launch. Recommended engineering
baseline, subject to owner/legal approval:

- request and proposal bodies: memory or encrypted idempotency cache only,
  deleted no later than response expiry and excluded from backups;
- quota state: rolling TTL only;
- replay tombstone: keyed HMAC/outcome only for a short approved window;
- telemetry: aggregate sizes, timings, status/model/error codes without handles,
  fingerprints, request IDs or bodies;
- consent ledger: policy metadata only, no inventory content;
- billing/legal records: isolated from optimizer data.

Account deletion and consent withdrawal must revoke sessions/entitlements, stop
future transmission, remove account-linked operational data, propagate to
subprocessors and purge backups inside the published window. Test this before
launch.

Maintain a subprocessor register with legal role, purpose, data categories,
regions, DPA/transfer basis, retention/deletion, breach terms, no-training/ads
controls and change notification. Every commercial data source needs documented
automated/commercial/derived-output/caching/attribution rights. FUT.GG remains
excluded from paid optimizer reliance until written permission is recorded or
the dependency is removed.

## Verification matrix

These are future gates, not achieved service results:

1. Contract parity: a neutral JSON corpus must have 100% client/service
   agreement on valid and invalid shapes; breaking changes create v2.
2. Solver oracle: exhaustive bounded cases and at least 10,000 deterministic
   generated seeds must exactly match an independent brute-force/CP-SAT oracle.
   No false `globally_optimal` claim is allowed.
3. Solver properties: at least 100,000 deterministic cases cover permutation
   invariance, stable ties, no item reuse, group uniqueness, eligibility,
   rating/special constraints and monotonic feasibility.
4. Adversarial parser/schema corpus: malformed/duplicate-key JSON, invalid
   Unicode, controls, unknown fields/enums, bombs, limits, TTL and handle attacks
   all fail before solver/billing and never echo payloads/stacks.
5. Auth/entitlement: every wrong/missing/expired/revoked/cross-tenant token and
   Free grant fails before solving; server state overrides client claims.
6. Replay/idempotency: concurrency executes once, ambiguous exact retry returns
   one identical response, changed digest conflicts and cross-user replay fails.
7. Privacy canaries: persistent IDs, names, routes, cookies, tokens, protected
   markers and raw evidence appear in no request, log, trace, metric, queue,
   cache, crash dump or retained record.
8. Failure injection: network/TLS reset, partial body, wrong content type, quota,
   dependency, solver crash/OOM, store outage, clock skew, abort and stale reply
   all yield a closed sanitized result with no local mutation.
9. Load/deadline: measure typical, near-limit and maximum valid inputs; prove
   queue, CPU, memory and cancellation bounds before setting a production SLO.
   Proposed targets such as p95/p99 are hypotheses until this test is run.
10. End to end: mutate every local inventory/project/policy/capability/consent /
    entitlement dependency in flight. All stale proposals fail before preview or
    workflow creation; cloud output itself causes zero EA mutations.
11. Rollout/rollback: dark launch, internal, 1%, 10%, 50%, then 100% cohorts.
    Any privacy canary, unauthorized solve or locally invalid proposal halts the
    rollout. Rehearse the kill switch and previous-model rollback.

Private CI should expose mandatory jobs equivalent to `contract-parity`,
`solver-oracle`, `solver-properties`, `adversarial`, `auth-replay`,
`privacy-canaries`, `failure-injection`, `load-deadline` and `rollback-drill`.

## Public-client integration still required

After a service exists, a separate public milestone must add:

1. reviewed fixed origin and minimum manifest permission;
2. service-worker-only auth/transport and session-token isolation;
3. purpose-specific disclosure, consent receipt and withdrawal UI;
4. bounded JSON reader, no redirects, content-type and detached-signature checks;
5. local private snapshot fingerprint stored beside—but never sent with—the
   request;
6. one-use handle resolution, then fresh inventory/projects/policy/game /
   capability/entitlement/consent reads;
7. FodderPolicy, identity, rating, special and exact requirement revalidation;
8. a read-only explainable preview;
9. explicit approval followed by another fresh revalidation and local-only
   compilation to known workflow operations;
10. end-to-end stale/reload/revocation/privacy/browser verification.

If the existing `COMPLETE_SBC` path re-solves to different cards, it cannot claim
to preserve a global allocation. Integration must either bind a locally approved
exact allocation or replan after each verified submission.

## Owner decisions before implementation or launch

- legal entity/service controller and contributor IP ownership;
- independent protocol implementation versus a newly licensed neutral package;
- FUT Magic name/trademark and EA automation risk;
- every commercial provider permission, especially FUT.GG;
- privacy legal basis, jurisdictions/transfers, minors and DPIA need;
- account/subscription/cancellation/refund/tax/consumer terms;
- exact retention/deletion exceptions and subprocessor program;
- live origin, identity/billing vendors, budgets and production SLO after load
  evidence.

Until those decisions and gates pass, the accurate status is:

> Public protocol implemented and tested; private optimizer designed but not
> implemented, deployed, commercially authorized or privacy-approved.
