# FUT Magic Global Project Optimizer execution plan

## Objective

Satisfy the program's conditional Global Project Optimizer milestone without
crossing the GPL/private-service boundary. No separate FUT Magic backend
workspace is available, so this milestone will turn the tested public contract
into a concrete private-service implementation, verification and deployment
plan rather than place a fake or proprietary optimizer in the extension.

## Current state

- The public client has exact `project_optimization.v1` request/response
  validators, request-local handles, entitlement/auth contracts and an injected
  transport-only provider.
- Project proposals are FC26-only, complete/partial/infeasible, bounded and
  locally revalidated for eligibility, identity, rating and special counts.
- No private repository, origin, credentials, account/billing system, provider
  agreement or deployment environment is present in the available workspace.
- The extension must remain fully useful as Free when signed out, offline or
  not configured.

## Decisions

- Do not implement a private optimizer, service endpoint or server simulation
  in this GPL extension repository.
- Specify a deterministic optimization model; an LLM must not allocate cards.
- Treat the published v1 wire protocol as the only integration boundary. The
  private service independently implements it and does not import GPL client
  modules unless a separately licensed protocol package is explicitly approved.
- Keep local protection, stale-state detection, proposal validation,
  explanation, Plan compilation, approval, execution and recovery authoritative.
- Require service-side entitlement enforcement independently of client UX.

## Work

- [x] Record the private service component/data/deployment architecture.
- [x] Specify the deterministic global optimization variables, hard
  constraints, lexicographic objectives and complete/partial/infeasible output.
- [x] Define service-side schema parity, authorization, entitlement, replay,
  deadlines, quotas, observability and sanitized error behavior.
- [x] Define privacy/consent/retention and provider-provenance launch gates.
- [x] Define contract, property, solver-oracle, load, failure and end-to-end
  verification matrices.
- [x] Define staged delivery, rollback, incident and compatibility procedures.
- [x] Cross-link public architecture/licensing/security/product documentation.
- [x] Re-run public release gates and close the conditional milestone.

## Acceptance

- A future private-team implementer can build the service without guessing
  request semantics, safety ownership, objective order or response status.
- The plan names concrete solver invariants, SLO/resource ceilings and failure
  behavior without claiming unmeasured production performance.
- Data collection is limited to the public DTO and gated by exact consent and
  retention policy; EA credentials and persistent owned-item IDs are forbidden.
- Deployment cannot enable FC27 or executable remote behavior.
- The public extension remains unchanged in manifest permissions/origins and
  contains no private backend code, secrets or fake premium availability.

## Evidence log

- Workspace inspection on 2026-08-26 found one FUT Magic public Git worktree
  (`main`) and no separate private backend workspace.
- Milestone 5 completed 276 unit/integration tests, browser integration, static
  checks, TypeScript, packaging and archive inspection.
- `docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md` now defines the independent service
  architecture, exact deterministic CP-SAT model, FC26 integer rating encoding,
  immutable v1 objective/status meanings, replay/quotas/failures, privacy and
  licensing gates, verification matrix, rollout/rollback and public integration
  work.
- Specialist reviews covered optimizer semantics, service/MV3 separation,
  testing/reliability and licensing/data provenance. No specialist claimed a
  backend implementation or production measurement.
- Public behavior remains covered by the unchanged 276/276 passing
  unit/integration suite from Milestone 5; Milestone 6 changed documentation
  only after that run.
- `npm run check`: passed repository verification and TypeScript.
- `npm run test:browser`: passed after rebuilding both runtime bundles.
- `npm run package`: produced a 145-file release archive before plan closure.
- The milestone is complete only under the program's explicit no-private-
  workspace branch. The service remains unimplemented and every launch gate in
  `docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md` remains open.
