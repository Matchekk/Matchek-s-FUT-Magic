# FUT Magic commercial hardening execution plan

## Objective

Prepare the public GPL client and launch dossier for a future commercial FUT
Magic service without inventing cloud, billing, legal, provider, or store
readiness and without publishing or purchasing anything.

## Current state

- Free safety and local execution are complete and remain available offline.
- Exact public auth, entitlement, proposal, compatibility, and provider
  contracts exist, but production providers are explicitly not configured.
- No FUT Magic account system, subscription issuer, billing integration,
  private backend, support service, or production endpoint exists here.
- Privacy, security, licensing, diagnostics, packaging, and Chrome Web Store
  materials exist in partial form and require one final evidence-backed audit.

## Decisions

- This milestone hardens the public-client boundary and records operator gates;
  it does not deploy infrastructure, accept payment, create accounts, or publish
  a store listing.
- UI gating is product presentation, never entitlement security. Future private
  services must enforce entitlements independently.
- The server must never receive EA credentials, cookies, session tokens, raw
  account payloads, or persistent owned-card identifiers.
- Missing owner, counsel, provider, platform, or production evidence remains an
  explicit launch blocker rather than a simulated implementation.

## Work

- [x] Audit public auth, entitlement, account, Pro, and support boundaries.
- [x] Audit privacy, security, diagnostics, compatibility, permissions, and data retention.
- [x] Audit packaging, corresponding source, store metadata, and release provenance.
- [x] Add a canonical commercial-readiness matrix with owner/evidence/status gates.
- [x] Add or strengthen mechanical tests for permissions, provider defaults, secrets, and package contents.
- [x] Reconcile README, privacy, licensing, security, product, quality, and changelog claims.
- [x] Run full test, browser, check, package, archive, and secret-scan gates.

## Acceptance

- The complete Free product still works signed out and offline.
- Every production auth/entitlement/data provider remains explicitly not configured.
- The extension adds no broad host permission, remote code, credential storage,
  purchase action, account mutation, telemetry, or hidden support upload.
- Store/privacy/support claims match observable behavior and name every open gate.
- The store archive has its manifest at the root and contains no tests, docs,
  secrets, local output, dependency tree, or private-service implementation;
  a separate wrapped archive contains the corresponding public source.
- No publication, purchase, deployment, or external account change occurs.

## Evidence log

- `npm test`: 374 tests passed, 0 failed, including the 20-cycle destructive
  reload scenario.
- `npm run test:browser`: passed after rebuilding the runtime; reviewed
  `output/visual-review/fut-magic-more.png` at its original resolution. All
  About/Legal destinations and the no-warranty text are visible above the
  fixed navigation.
- `npm run check`: manifest/runtime verification and TypeScript validation
  passed.
- `npm run package`: produced a 26-entry root-manifest CWS candidate and a
  226-entry wrapped corresponding-source archive; package-time entrypoint,
  non-runtime-content, and high-confidence secret checks passed.
- Both artifact SHA-256 values exactly matched
  `dist/fut-magic-2.3.0-release.json`. The record is intentionally
  `candidate` because the working tree is not an exact clean release tag.
- Mechanical regressions prove zero identity/commerce/OAuth permissions,
  exact EA Web App resource exposure, local-only CSP, disabled FUT.GG traffic,
  purged legacy EA-origin metadata caches, minimized diagnostics, command-free
  Pro affordances, and explicit launch blockers.
- The final gate matrix is `docs/COMMERCIAL_READINESS.md`. No publication,
  purchase, deployment, billing/account mutation, or external support action
  occurred.

## Follow-up debt

- Obtain written EA authorization and product-name/content approval.
- Contract and configure licensed data providers before enabling any network
  origin; perform a new privacy/security review when that happens.
- Implement production account, entitlement, billing, support, operator-contact,
  and hosted privacy workflows outside the public GPL client.
- Create an exact clean tag/source release, store media, listing disclosures,
  and complete native Chrome/EA release QA before publication.
