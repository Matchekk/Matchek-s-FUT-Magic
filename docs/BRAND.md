# FUT Magic brand identity

> **Smarter plans. Better results.**

This document is the canonical production-use guide for FUT Magic brand
assets. The original concept board is visual direction, not shipped artwork.
The production system refines its strategy, movement, and spark themes into
scalable original geometry.

## Brand signature

The compact symbol has three primary parts:

1. an open, forward-leaning frame for cards and planning;
2. one rising trajectory for progress and routing;
3. one four-point spark for the moment a useful plan resolves.

The 48/128 app-icon master adds one highly simplified football node on the
trajectory: a circle, central pentagon, and five short seams. The 16/32 source
deliberately omits it because that detail collapses at toolbar size. Compact UI
symbols also stay identifiable by silhouette rather than by tiny decoration.

## Production assets

| Use | Asset |
| --- | --- |
| Compact product surfaces | `icons/brand/fut-magic-symbol.svg` |
| Brand recognition | `icons/brand/fut-magic-wordmark.svg` |
| Onboarding and marketing | `icons/brand/fut-magic-lockup.svg` |
| Single-color reproduction | `icons/brand/fut-magic-monochrome.svg` |
| Chrome 48/128 source | `icons/fut-magic-master.svg` |
| Chrome 16/32 source | `icons/fut-magic-small.svg` |
| Chrome runtime icons | `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` |

The geometric wordmark is path-based, so it does not depend on a bundled or
proprietary typeface. The tagline in the horizontal lockup uses the platform
system stack and remains secondary to the fixed wordmark.

`src/brand/tokens.css` is the canonical runtime token source. It defines
semantic colors, spacing, radii, type, shadows, motion, layers, target sizing,
and accessible reduced-motion/transparency fallbacks. Product components use
the `--fm-*` roles instead of introducing new raw values.

## Color and restraint

The asset palette uses the product's semantic values:

```text
Deep Navy       #0B1020  app-icon field
Elevated Blue   #1E2B4D  quiet edge and separation
Electric Cyan   #00E6FF  frame and active intelligence
Aqua / Mint     #26FFC2  trajectory and progress
Cool Gray       #A7B2C9  supporting copy
Primary Light   #E6EDF5  FUT and monochrome mark
```

Violet is intentionally absent from the standard mark. It remains available
for rare FUT Magic Pro emphasis in product UI. Do not add gradients, bloom, or
multiple sparks to ordinary placements.

## Placement rules

- Use the full wordmark or lockup where recognition matters: onboarding,
  account, About, Pro explanation, and store artwork.
- Use the compact symbol in headers, the mini HUD, contextual EA controls, and
  other narrow surfaces.
- Keep clear space around the symbol equal to roughly one trajectory
  stroke-width. Never place it directly against a container edge.
- Do not repeat the full wordmark inside every screen.
- Do not recolor the standard mark to match EA or another provider.
- Do not use EA, FC, Ultimate Team, Apple, player, club, provider, or copied
  card imagery as part of the FUT Magic identity.

## Small-size behavior

The 16 px and 32 px Chrome icons use a separately drawn compact source with no
interior border, football node, or secondary detail. At 48 px and 128 px, the
standard source adds a quiet elevated-blue edge and simplified football cue.
Both retain the same frame, trajectory, and single-spark silhouette.

Generate all PNGs with `npm run build:icons`; do not resize a PNG by hand. The
repository verifier checks the declared dimensions and manifest references.

## Interaction character

When the symbol participates in a loading or success transition, motion should
follow the trajectory and settle into the spark once. It must respond
immediately, remain interruptible, and fall back to a short opacity change for
`prefers-reduced-motion`. The mark is never a continuously animated wallpaper.

This applies the Apple Design principles of purpose, spatial consistency,
legibility, and restraint without imitating an Apple product or using Apple
assets.
