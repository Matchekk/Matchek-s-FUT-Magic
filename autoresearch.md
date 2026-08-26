# Autoresearch: Maximize Solve Squad quality

## Objective
Maximize Solve Squad quality

## Metrics
- Primary: solver_quality (unitless, higher is better)
- Secondary: none yet

## How to Run
`npm run benchmark:solver` prints `METRIC name=value` lines.

## Files in Scope
- TBD: add files after initial inspection

## Off Limits
- TBD: add off-limits files or behaviors if needed

## Constraints
- - Decision contract: solver_quality is treated as a quality-bearing score; faster runs should not be promoted when component evidence shows quality or correctness erosion.

## Decision Rules
- Keep when the primary metric improves or a baseline is needed and checks pass.
- Discard when the metric is equal or worse, unless the run only establishes the baseline.
- Log crashes and failed checks with a concrete rollback reason.
- Put next-step guidance in ASI so another Codex session can continue.

## Stop Conditions
- Stop when the target metric reaches the agreed threshold.
- For qualitative loops, stop when `quality_gap=0`, checks pass, and no high-impact open finding remains.
- Stop when maxIterations is reached or the user interrupts.

## Research Notes
- Source-backed facts, contradictions, and open questions go here or in linked scratchpad files.
- For deep research loops, link the scratchpad folder and summarize the current synthesis.

## What's Been Tried
- Baseline: pending

## Resume This Session

Use these commands to pick the loop back up without rediscovering state:

```bash
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs state --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs doctor --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style' --check-benchmark
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs next --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs log --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style' --from-last --status keep --description "Describe the kept change"
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs export --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
```
