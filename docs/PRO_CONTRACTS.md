# FUT Magic Pro contract boundary
FUT Magic Pro is a future service boundary, not a second workflow engine. This
repository currently ships only public GPL client contracts, validators and
deterministic tests. It does not configure a FUT Magic origin, account,
subscription, purchase flow or private planner.

## Trust boundary

```text
local inventory/projects/policy
  -> remove protected cards and unsupported requirements
  -> replace local identifiers with random request-local handles
  -> validate an exact, bounded, versioned request
  -> future purpose-specific consent and disclosure gate
  -> future service-worker-only authenticated HTTPS transport
  -> private service returns a bounded proposal
  -> match request, contract, fingerprint and expiry
  -> reject foreign/reused handles and remote executable content
  -> resolve handles inside the request scope
  -> re-read local state and revalidate safety/eligibility
  -> local PlanCompiler creates a preview
  -> existing local approval and WorkflowEngine remain authoritative
```

Cloud output is never an executable workflow. It cannot contain steps,
commands, selectors, expressions, scripts, WASM, HTML, URLs or arbitrary
operation names. A known-recipe recommendation can name only an implementation
already shipped and validated in the public client.

## Public contracts

The modules in `src/application/pro-contracts/` define:

- token-free authentication state and a not-configured provider;
- evidence-backed, expiring entitlement state that fails to Free;
- request-local random handle scopes for items, groups, projects and
  requirements;
- separate Project Optimization and Smart Route request/response validators;
- recipe availability metadata tied to local recipe implementations;
- downgrade-only compatibility configuration;
- an injected CloudPlannerProvider boundary with deadlines and cancellation,
  but no built-in network transport.

All objects are exact-schema plain JSON with bounded bytes, depth, arrays,
strings and numeric ranges. Unknown versions, fields and enum values fail
closed. Persistent EA owned-item identifiers, credentials, cookies,
authorization/session data and raw URLs are forbidden.

Request fingerprints bind a response to the already sanitized, randomized
request. They are not local inventory, account, project or policy fingerprints.
Request handle maps stay local and are destroyed after the request expires or
finishes. Identical local input receives unrelated handles in another request.

## Status semantics

Authentication, entitlement and service availability are independent. A user
can be signed out while all Free features continue to work. “Not configured”
means this public build has no real provider; it does not mean offline, locked
or payment required.

Only a fresh, validated and evidence-backed Pro grant can expose a Pro feature.
Checking, signed-out, not-configured, expired, stale, offline, unavailable and
error states all fail to the complete Free safety feature set. A server must
also enforce paid access; visible GPL client checks are UX, not a security
boundary.

## Data minimization

Project requests may contain only request-local handles, rating, coarse card
classification, location/tradability, duplicate state, local cost and closed
eligibility facts. Project demand contains random project/requirement handles,
priority and known closed requirements. Smart Route requests contain only the
duplicate candidates and verified move/storage facts needed for routing.

Hard-protected and active-squad cards are omitted rather than tagged. The
contracts exclude owned `itemId`, persistent or stable hashes, EA definition /
resource / asset / player IDs, player and project names, free-text intent, EA
set/challenge IDs, routes and raw capability evidence.

Before any live transport is added, the public client must add purpose-specific
disclosure and consent receipts naming recipients, data categories, retention
class and policy version. Changed recipients/categories/retention invalidate a
receipt. Optimization consent must not be bundled with analytics, diagnostics,
training or marketing consent.

## Compatibility and FC27

Remote compatibility data can disable a capability, reduce confidence, shorten
validity or cap an existing local limit. It cannot introduce a capability,
increase a limit, enable an unimplemented recipe or declare unobserved EA
behavior available.

```text
effective capability = locally implemented
                     ∩ locally observed
                     ∩ not remotely downgraded
```

FC27 remains unverified regardless of service metadata until local fixtures and
live evidence establish its semantics.

## Future live-transport gate

Adding a live provider is a separate milestone. It requires a fixed reviewed
HTTPS origin/path and minimum MV3 host permission, service-worker ownership,
`credentials: "omit"`, no redirects, JSON content-type enforcement, bounded
stream reading, deadline/abort behavior, token isolation in worker memory or
`chrome.storage.session`, response replay protection, privacy/store disclosure,
and an end-to-end local safety revalidation test. No caller-supplied URL is
permitted.

The concrete private Global Project Optimizer design and its unfulfilled launch
gates are recorded in `docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md`.
