# FUT Magic design

The production direction is **deep navy + electric cyan**: calm, precise,
sporting, and lightly magical. It translates the approved brand board into an
original software identity; it does not trace the board or imitate EA, Apple,
or any third-party game interface. Asset construction and mark-usage rules are
canonical in [BRAND.md](BRAND.md).

## Principles

- One obvious next action; progressive disclosure for power/developer tools.
- Immediate press feedback and interruptible, spatially consistent motion.
- Translucency only for truly floating chrome such as the run HUD.
- Hierarchy through type, spacing, and separators—not endless cards or glow.
- Status always combines text/icon/shape with color.

## Canonical tokens

```text
bg-primary      #0B1020     bg-secondary   #121A2E
bg-elevated     #1E2B4D     text-primary   #E6EDF5
text-secondary  #A7B2C9     accent-primary #00E6FF
accent-secondary#26FFC2     accent-violet  #7B61FF
positive        #26FFC2     warning         #FFCA67
destructive     #FF7185     focus           #6AEEFF
```

`src/brand/tokens.css` is the source of truth for semantic colors, spacing,
radii, typography, shadows, motion, layers, controls, and floating materials.
Components consume roles instead of introducing nearby hex values. Spacing
uses a 4px base. Radii stay within 8/12/16px; the HUD alone uses the largest
surface radius. Type uses system fonts with the controlled 400/500/600/700
weight scale; no proprietary font is bundled.

Cyan denotes a primary action, selection, progress, or active FUT Magic
context. Aqua is a supporting accent and positive state. Violet is rare and
reserved for Pro or exceptional optimization. The four-point spark appears in
the identity or a resolved brand moment, not as a repeated list bullet.

## Accessibility and motion

- 2px visible focus ring with 2px offset.
- Controls and icon buttons expose a minimum 44px target.
- Full keyboard operation and `aria-current` navigation.
- Route changes focus the new screen heading.
- Support 200% text without horizontal scrolling from 320–600px.
- Reduced motion uses short cross-fades; reduced transparency uses opaque
  surfaces; increased contrast strengthens borders and focus.
- No decorative loops, shimmer, ambient pulse, rainbow gradients, or repeated
  spark wallpaper.

Apple-design guidance shaped immediate response, spatial consistency,
restraint, reduced-motion behavior, and the rule that delight emerges from
purpose, agency, responsibility, familiarity, flexibility, simplicity, and
craft rather than decoration.

The Router recommendation follows that restraint: it is a flat typographic
section below the real batch approval, separated by one rule. It has no nested
card, badge, disabled control or decorative icon. Action, reason, suggestion-
only boundary, freshness and optional native evidence disclosure remain legible
without color at narrow width and 200% zoom.

FC27 uses a flat compatibility row, not a feature card or upsell. “Detected”
describes version observation only; “Observe only” separately describes
planning availability. Unknown versions use “Planning off.” Both states are
written explicitly and never depend on color alone.

Evolution keeps one unavailable Home row rather than showing synthetic fixture
results as a consumer demo. Its explanation is “Live Evolution data is not
available in this build.” There is no upgrade, connect, sign-in, waitlist, or
activation control until the underlying product journey is real.

The About/Legal surface uses ordinary wrapping text links for Source, License,
Privacy, and Third-party notices plus a concise no-warranty statement. It does
not turn legal or support context into promotional cards. Extra shell bottom
space keeps the complete legal block above the fixed navigation at short
viewport heights. Diagnostics use the plain description “local support
export”; there is no visual suggestion that a file is uploaded or that a
support case is created.
