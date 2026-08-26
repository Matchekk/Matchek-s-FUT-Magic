# FUT Magic Product Shell — completed

## Outcome

FUT Magic is now the customer-facing product shell. Chrome declares a native
Side Panel with Home, Projects, Club, and More; active workflows have a compact
HUD; contextual EA-page actions open FUT Magic; the existing panel remains
available only through Advanced/Legacy Tools. Destructive semantics and every
`grindpilot.*` storage key remain unchanged.

## Decisions retained

1. The isolated EA-tab runtime remains the only executor and lease owner.
2. The Side Panel receives bounded view models and allowlisted commands.
3. Preact + TypeScript is local to the new Side Panel.
4. Graphite/mineral-jade tokens, native list rows, system typography, and one
   elevated current-work surface define the visual language.
5. Project counts show exact known demand and exact-rating stock only; no fake
   optimizer coverage or risk score is displayed.
6. FUT Magic Pro goals remain visible but disabled with explicit
   not-implemented explanations.

## Acceptance evidence

- Baseline: 175/175 tests, browser/check/package green at `cf031d4`.
- Final Product Shell suite: 180/180 tests before the architecture slice.
- Strict verifier and TypeScript `--noEmit`: pass.
- Browser flow: EA actions, Advanced migration path, Home, Projects, project
  detail, Club, More, expanded HUD, compact HUD: pass.
- 300px minimum-width and keyboard activation: pass without horizontal
  overflow.
- Visual artifacts: `output/visual-review/` (ignored from packages/source).
- Independent Apple-design review: accepted after renaming the dominant
  project CTA from an implementation label to “Continue project.”
- Package: `dist/fut-magic-2.3.0.zip`, 112 files before the architecture slice;
  local Side Panel bundles, complete extension source/build scripts, GPL and
  Preact MIT notice included; visual output excluded.

## Constraints and follow-up debt

- Native Chrome Side Panel chrome and live EA collision behavior still require
  manual loaded-extension/live-account verification; the automated test loads
  the compiled page and extension bridge contract over a local harness.
- Replace visibility polling with a versioned reconnecting state port.
- Replace provisional Home glyphs with a consistent final icon family.
- Live EA/provider/name/legal approval remains a commercial launch gate.
- The HUD can collapse in normal state and auto-expands for caution/recovery;
  live EA placement still needs validation.
