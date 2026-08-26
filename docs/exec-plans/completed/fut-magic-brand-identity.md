# FUT Magic brand identity execution plan

## Objective

Translate the approved FUT Magic concept board into a coherent production
design system across the extension without tracing raster artifacts, copying
EA/Apple/third-party branding, weakening runtime safety, or inventing live
commercial capabilities.

## Visual authority

- Deep navy `#0B1020`, navy surface `#121A2E`, elevated blue `#1E2B4D`.
- Electric cyan `#00E6FF`, aqua/mint `#26FFC2`, rare violet `#7B61FF`.
- Primary text `#E6EDF5`, secondary text `#A7B2C9`.
- Compact visual DNA: angular card frame, one trajectory curve, one restrained
  four-point spark, and football/strategy geometry that simplifies at small
  sizes.
- “FUT” remains light; “Magic” carries the accent; the product tagline is
  “Smarter plans. Better results.”

The concept board is a reference, not a shippable or traceable asset. Production
marks must be original deterministic SVG geometry and size-aware PNG renders.

## Apple-design decisions

- Safety, understanding, agency, and craft take priority over decorative
  spectacle.
- Controls respond immediately on press; route changes remain spatially
  consistent and interruptible.
- Typography and whitespace establish hierarchy before containers or color.
- Translucency belongs only to floating HUD/navigation layers and has a solid
  reduced-transparency fallback.
- Reduced motion uses short cross-fades with no looping glow, bounce, or
  trajectory animation.

## Work

- [x] Audit existing customer-facing branding, surfaces, assets, screenshots,
  and technical migration identifiers.
- [x] Create canonical color, type, spacing, radius, shadow, motion, and layer
  tokens.
- [x] Create original primary wordmark, horizontal lockup, compact symbol,
  monochrome mark, and size-specific extension icons.
- [x] Migrate Side Panel shared components and all represented product states.
- [x] Migrate the mini HUD and contextual EA actions.
- [x] Add representative visual fixtures for product, status, HUD, and EA
  integration states at narrow/normal/wide sizes and reduced preferences.
- [x] Run independent design and accessibility critiques against rendered
  screenshots, then implement justified fixes.
- [x] Reconcile manifest, README, design/frontend docs, changelog, tests, and
  package content.
- [x] Run unit, browser, check, package, visual, accessibility, and asset gates.

## Acceptance

- FUT Magic remains the only customer-facing primary brand; legacy GrindPilot
  names remain only where compatibility or historical attribution requires.
- Identity remains recognizable without repeatedly displaying the wordmark.
- Cyan/aqua is purposeful, violet is rare, and surfaces do not devolve into
  neon borders, glass everywhere, bento cards, or generic SaaS styling.
- Logos and icons remain legible at 16, 32, 48, and 128 pixels without relying
  on microscopic football detail.
- Focus, keyboard order, target sizes, contrast, screen-reader labels,
  reduced-motion, reduced-transparency, increased-contrast, and 200% zoom are
  mechanically or visually reviewed.
- Generated store runtime excludes the concept board, unused design-source
  artifacts, obsolete customer-facing icons, remote fonts, and copied marks.
- Existing permissions, URLs, storage keys, domain safety, approvals, recovery,
  and fail-to-Free boundaries remain unchanged.

## Evidence log

- Canonical production sources: `src/brand/tokens.css`, `docs/BRAND.md`, four
  brand SVGs, separate 16/32 and 48/128 app-icon masters, and exact PNG sizes.
- Side Panel, HUD, EA contextual actions, and the Advanced/Legacy shell consume
  the FUT Magic navy/cyan hierarchy with 500/600/700 system typography,
  44-pixel controls, restrained Pro violet, reduced preferences, and forced
  colors support.
- The local browser harness captured 31 representative images under
  `output/visual-review/` across 300/380/520-pixel widths, 200% zoom, normal /
  elevated / paused Activity Guard, HUD run states, EA actions, empty/error/
  unavailable states, keyboard focus, and reduced preferences. Documentary
  full-page captures temporarily neutralize fixed chrome so screenshots do not
  encode overlap artifacts.
- Independent design review reported no remaining P0 issues and no AI-slop
  pattern. Its justified P1 fixes were applied: explicit HUD panel actions,
  semantic contextual icons, compact pack sizing, clean capture behavior, and
  a simplified football cue only in the 48/128 icon master.
- Independent accessibility re-audit reported no remaining P0/P1 barriers.
  It verified semantic progress, focus restoration, live regions, label/table
  associations, keyboard import, disabled reasons, forced colors, reduced
  motion/transparency, target size, and status meaning beyond color.
- `npm test`: 383/383 passed.
- `npm run test:browser`: passed.
- `npm run check`: passed (`Verified FUT Magic 2.3.0`; TypeScript clean).
- `npm run package`: passed; produced a 23-file CWS candidate, 237-file
  corresponding-source archive, and hashed provenance record. The CWS archive
  contains only the four runtime PNG icons—not concept art, vector masters, or
  design-source files.
- Release-candidate artifacts: `dist/fut-magic-2.3.0-cws.zip`,
  `dist/fut-magic-2.3.0-source.zip`, and
  `dist/fut-magic-2.3.0-release.json`.

Manual NVDA/JAWS/VoiceOver, Windows High Contrast, real EA DOM, and native
unpacked-extension checks remain release QA coverage limits rather than known
product defects. Publishing and commercial account/billing configuration remain
separate launch work and were not fabricated by this branding migration.
