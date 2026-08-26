# FUT Magic brand assets

The production mark combines an angular strategy frame, a forward trajectory,
one four-point spark, and—only in the 48/128 master—a simplified football node.
It is original FUT Magic artwork and contains no EA, FIFA, FC, Ultimate Team,
club, player, Apple, or third-party marks.

## Sources

- `fut-magic-master.svg`: full app-icon artwork for 48 px and 128 px output.
- `fut-magic-small.svg`: optically simplified app-icon artwork for 16 px and
  32 px output.
- `brand/fut-magic-symbol.svg`: transparent compact symbol.
- `brand/fut-magic-wordmark.svg`: deterministic geometric wordmark.
- `brand/fut-magic-lockup.svg`: horizontal symbol, wordmark, and tagline.
- `brand/fut-magic-monochrome.svg`: one-color lockup for constrained contexts.

The four PNG files are purpose-rendered Chrome Manifest V3 assets. Regenerate
them deterministically with:

```bash
npm run build:icons
```

Do not derive new marks by raster-tracing the concept board. Keep the mark flat,
legible, and sparse; do not add extra sparks, detailed football artwork,
gradients, or third-party visual language. `grindpilot-master.svg` remains only
as product history and is not referenced by the manifest.

FUT Magic artwork is distributed under GPL-3.0-only.
