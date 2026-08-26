# Commercial readiness
This is the launch-control record for the public FUT Magic client. It is an
engineering checklist, not legal advice or a claim that a commercial service
exists. No publication or purchase is authorized by this document.

Status vocabulary:

- `READY`: implemented and evidenced locally for the public client.
- `CANDIDATE`: technically prepared but still needs operator or live review.
- `BLOCKED`: must not launch until the named owner supplies the evidence.
- `NOT CONFIGURED`: intentionally absent from this release.

## Launch gate matrix

| Gate | Owner | Evidence | Status | Required closure |
|---|---|---|---|---|
| Free local product | Engineering | Unit/integration/browser suites; literal Free runtime; no account dependency | READY | Preserve signed-out/offline safety and recovery in every release. |
| Cloud auth | Product + identity owner | Exact token-free client snapshots and fail-safe resolver only | NOT CONFIGURED | Select an operator/origin and reviewed identity flow; prove token isolation, revocation, expiry, offline behavior, and account recovery. |
| Subscription entitlement | Product + billing owner | Exact bounded entitlement contract; future/stale evidence fails to Free | NOT CONFIGURED | Implement server-enforced issuer, signed evidence, anti-replay, cancellation, refunds, taxes, grace periods, restoration, and incident rollback. UI gating is not security. |
| Account lifecycle | Product + privacy owner | No account model or account mutation is shipped | BLOCKED | Define account export, deletion, sign-out/revocation, retention, recovery, age/region rules, and verified operator contact before adding UI. |
| Billing or purchase | Product + finance/legal | No processor, webhook, checkout, SKU, price, or purchase command exists | NOT CONFIGURED | Select processor and merchant; approve consumer terms, taxes, refunds, cancellation, fraud, webhook and reconciliation tests. Do not advertise Pro as purchasable first. |
| Pro UX | Product + engineering | Pro rows remain disabled with `command: null`; no sign-in/upgrade/purchase language | READY | Connect only after auth, entitlement, service, privacy, support, and legal gates are independently ready. |
| EA authorization, automation, and name | Product owner + counsel | Unofficial disclaimer; current public client interacts with the EA Web App | BLOCKED | Obtain written authorization or a documented counsel/owner go/no-go covering automation, commercial use, runtime content, and FUT Magic/Ultimate Team naming. The [EA User Agreement](https://www.ea.com/legal/user-agreement?isLocalized=true) and [EA content policy](https://help.ea.com/en/articles/security-and-rules/ea-content-policy/) require review; a disclaimer is not authorization. |
| FUT.GG data | Product owner + provider counsel | Provider is hard-disabled; no host permission or CSP connection; terms do not grant automated commercial use | BLOCKED | Keep disabled or obtain a written license covering automation, commercial use, caching, derived output, attribution, availability, and redistribution. Review [Stormstrike terms](https://stormstrike.gg/terms). |
| Evolution data | Product + data owner | Synthetic tests and not-configured metadata provider only | NOT CONFIGURED | Approve lawful field-level provenance, freshness, eligibility/transform adapters, price source, and local revalidation. |
| Privacy and consent | Privacy owner + counsel | Local policy and no telemetry; diagnostics are manual/local; remote provider disabled | CANDIDATE | Name controller/contact/effective date, host reviewed policy publicly, complete regional review and Store declarations, and add purpose-specific consent before any future transmission. |
| Diagnostics and Support | Support owner + security | Opt-in Developer Mode and bounded local download; no uploader or support service | CANDIDATE | Select a public support/security channel, operator, SLA/escalation and deletion handling. Keep preview/share user-controlled and separate from product analytics or marketing consent. |
| Compatibility service | Security + backend owner | Exact downgrade-only contract; no transport | NOT CONFIGURED | Add fixed service-worker transport, authenticated signatures/key rotation, monotonic anti-rollback state, expiry/replay tests and emergency revocation. |
| Chrome Web Store package | Release owner | Root-manifest `-cws.zip`, scoped permissions, local CSP, separate source archive and candidate provenance JSON | CANDIDATE | Complete loaded-extension live QA, publisher verification, listing/reviewer fields, approved privacy/support URLs and compliant media. Follow [Chrome preparation](https://developer.chrome.com/docs/webstore/prepare), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [image requirements](https://developer.chrome.com/docs/webstore/images). |
| Exact corresponding source | Release owner | Source archive includes tests, lockfile, build scripts, licenses and notices; candidate manifest records hashes | BLOCKED | Commit the exact tree, create and publish an immutable version tag/source archive, rebuild from it, record commit and hashes, and publish corresponding source with the binary. |
| Third-party notices | Release owner + counsel | Pinned upstream commits, GPL/MIT texts and Preact notice are packaged | CANDIDATE | Reconfirm the exact dependency inventory and provenance at the clean tagged release. |
| Publication | Product owner | No store/account/deployment mutation was performed | BLOCKED | Explicit human authorization is required only after every applicable gate above is closed. |

## Public-client account boundary

The public client may eventually request sign-in, sign-out and bounded
entitlement evidence, but it must never store a password or receive a billing
credential. A future account surface must expose export, deletion, revocation,
subscription state and recovery using operator-owned URLs and policies. None of
those commands exist today, so the UI must not simulate them.

The server must never receive EA passwords, cookies, authorization/session
tokens, raw account payloads, controller objects, DOM, persistent owned-item
IDs, stable account-derived hashes, or unredacted diagnostic exports.

## Support workflow

The current safe workflow is entirely local:

1. The user explicitly enables Developer Mode.
2. The user captures bounded capability evidence.
3. The user downloads a local diagnostic JSON file.
4. The user reviews it and chooses whether and where to share it.
5. FUT Magic performs no automatic upload and has no recipient or retention
   after download.

A future support service needs a named operator and channel, a separate consent
receipt, a closed upload schema, expiry/deletion rules, incident escalation,
and security-report handling. Diagnostics consent must not cover analytics,
model training, marketing, or account profiling.

## Chrome Web Store dossier

Draft single purpose:

> FUT Magic helps users plan and run bounded, explainable Ultimate Team SBC and
> inventory workflows locally, with card protection, explicit approval, result
> verification, and recovery.

Permission justification:

- `storage`: local settings, projects, workflow recovery, and bounded activity.
- `scripting`: install the allowlisted MAIN-world EA controller bridge.
- `sidePanel`: provide the native goal-first product surface.
- EA Web App host patterns: observe and operate only the supported EA Web App
  routes requested by the user.

Store disclosure must say:

- unofficial and not endorsed by or affiliated with EA or its licensors;
- FC26 destructive planning only; FC27 remains observe-only;
- no FUT Magic account, subscription, billing, cloud optimizer, telemetry,
  live Evolution catalog, or enabled external price/player provider;
- local EA Web App inventory/SBC/workflow data is processed for the user-facing
  feature and stored locally as described in `PRIVACY.md`;
- diagnostics are opt-in local downloads and are never automatically uploaded.

Still missing and therefore blocking submission: operator/publisher identity,
hosted privacy URL, support/security URL, category/language/regions, reviewer
instructions, compliant 1280×800 or 640×400 screenshots, a 440×280 promotional
image, and loaded-extension/live-account verification.

## Artifact contract

`npm run package` creates:

- `fut-magic-<version>-cws.zip`: root `manifest.json` and runtime/legal files;
- `fut-magic-<version>-source.zip`: full public corresponding-source candidate,
  including tests and build inputs;
- `fut-magic-<version>-release.json`: artifact SHA-256 values, source revision,
  clean-tree flag, and `candidate`/`release` status.

A dirty tree always produces `candidate`. Release status is evidence only after
the exact commit/tag, independent extraction/load test, and explicit human
publication authorization.
