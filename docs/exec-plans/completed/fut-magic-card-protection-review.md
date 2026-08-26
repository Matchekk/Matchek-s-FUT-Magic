# FUT Magic native Card protection review

## Goal

Replace the Free product shell's legacy “Optimize my fodder” detour with one
honest native, read-only Card protection journey. The review must reuse
`FodderPolicy` and active Target Project inputs, distinguish hard exclusions
from soft conservation preferences, and never imply global optimization.

## Safety boundary

- The plan kind is `PROTECTION_REVIEW_V1` with `steps: []`.
- The only required EA capability is current inventory read.
- There is no approve command, solver call, workflow run, item move, SBC submit,
  pack action, market action, or quicksell path.
- Missing flag provenance is shown as unverified. Unknown evidence is never
  rendered as a verified zero or as “safe to use.”
- Full inputs are analyzed or the review blocks; display examples alone may be
  bounded.

## Work

- [x] Preserve provenance for policy-relevant inventory flags.
- [x] Add a deterministic read-only application review and fingerprints.
- [x] Integrate refresh/compile state and a bounded panel command.
- [x] Shape a public view model without owned-card, player, or resource IDs.
- [x] Add one native Card protection route from Home, Club, and More.
- [x] Keep advanced raw controls available through the legacy panel.
- [x] Add unit, messaging, runtime, browser, narrow-width, zoom, and visual QA.
- [x] Update product, frontend, reliability, changelog, and quality docs.
- [x] Rebuild generated artifacts and verify the release archive.

## Acceptance

- Home says “Protect my cards”; “Optimize my fodder” is absent.
- Home, Club, and More reach the same native review.
- Hard exclusion counts come from a fresh full inventory snapshot and unique
  owned-item identities; overlapping reason groups remain explicit.
- Rating/special reserves and local-search preferences say “try to keep” or
  “use first,” never “protected.”
- Missing favourite/locked/tradability/special/active-squad evidence produces a
  visible unverified state and suppresses any eligible/safe count.
- Active and incomplete Target Projects contribute; unknown imported
  requirements are reported and never inferred.
- The public model and UI expose no raw IDs or internal reason codes.
- No review command can execute or approve a plan.

## Evidence log

- `npm test`: 219 passed, 0 failed.
- `npm run test:browser`: passed, including the native journey, 300 px,
  keyboard focus, and 200% zoom checks.
- `npm run check`: passed (repository verification + TypeScript).
- `npm run package`: passed; deterministic archive contains 130 files.
- Visual review:
  `output/visual-review/fut-magic-card-protection-review.png`.
- Independent UI review: no P0/P1 blockers after correcting unverified-zero
  copy, overlap explanation, and complete bounded signal presentation.
