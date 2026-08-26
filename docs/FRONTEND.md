# FUT Magic frontend

The native Side Panel is a Preact + TypeScript view. Core/domain code remains
framework-independent JavaScript during the migration.

## Boundary

```text
Side Panel → versioned request → service-worker tab broker
→ isolated ApplicationHost → bounded serializable AppViewModel
```

The panel must not receive raw inventory records, workflow handlers/nodes,
controller objects, DOM nodes, callbacks, or EA framework values. Commands are
exact, bounded schemas. Native read-only preview commands may request SBC,
duplicate-route, or Card protection plans; state-changing work still requires a
separate opaque-plan approval command when that product flow supports one.

## Shell

- Sticky header: compact production symbol + FUT Magic + text-labelled
  Ready/Limited/Needs attention state.
- Home: intervention, active run, current SBC/project, goal rows.
- Projects: readable progress and exact demand/stock counts; no invented
  optimizer coverage percentage.
- Club: duplicate count, Storage use, fodder bands, and a native Card protection
  entry whose count comes from the latest review rather than a previous solve.
  The duplicate preview also contains one flat, subordinate “Recommended next”
  region. It is suggestion-only, exposes no command, and never competes with
  the exact batch approval button.
- Card protection: one origin-aware detail route from Home, Club, and More;
  “Never use” exclusions, “Try to keep” reserves/preferences, bounded examples,
  provenance warnings, Refresh, and Advanced-only legacy editing.
- More: Card protection, Recipes, Activity, Settings, Advanced, About/Legal.
- Sticky bottom navigation: Home, Projects, Club, More.

The shared shell imports `src/brand/tokens.css`. It uses the original FUT Magic
symbol, a single coherent stroke-icon set, restrained cyan progress and
selection, 44px controls, type-led hierarchy, and flat rows for most actions.
The floating run HUD is the only product surface that uses subtle translucency;
reduced-transparency preferences make it opaque.

About/Legal links directly to the public source, GPL license, privacy notice,
and third-party notices, and states the no-warranty boundary. The shell reserves
enough bottom space for those links at narrow height instead of allowing the
fixed navigation to cover them. Diagnostics are an explicit local download:
there is no support upload, recipient, ticket creation, or server copy.

Pro-labelled rows are presentation-only while production providers are not
configured. They expose no sign-in, upgrade, purchase, billing, waitlist, or
provider-connect command, so a disabled affordance cannot accidentally become
an account or payment path.

Account, subscription price, Founder status, and purchase UI therefore remain
absent rather than fabricated. The unavailable Pro surface explains the
missing provider and keeps its label visually quiet. A real account or billing
surface requires separately configured services and verified commercial copy.

The Side Panel polls only while visible until a push port is implemented. The
EA-tab runtime remains the single executor and owns all approval/recovery state.
Router freshness changes are text-visible; stale advice is removed rather than
quietly retained. The region wraps at 300px/200% zoom and uses native disclosure
semantics without motion-dependent meaning.

Verified FC26 keeps the normal shell unchanged. Explicit FC27 or unknown
contexts add one compact semantic compatibility row above the current route.
It has no action, card treatment, Pro promotion, or future-date promise.
Planning controls are disabled with a written reason while read-only project
and Club context remains navigable. The row also wraps without horizontal
overflow at 300 CSS pixels and 200% zoom.

## Legacy migration

The legacy Shadow DOM panel has no default launcher. It is opened only through
the Side Panel’s Advanced area. Existing solve, workflow, project, protection,
profile, activity, and diagnostic capabilities remain intact.
