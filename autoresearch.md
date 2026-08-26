# Autoresearch: Maximize Solve Squad quality

## Objective
Maximize Solve Squad quality

## Metrics
- Primary: solver_quality (unitless, higher is better)
- Secondary: solved_rate, oracle quality, elapsed_ms

## How to Run
`npm run benchmark:solver` prints `METRIC name=value` lines.

## Files in Scope
- `solver/`, the production solver adapter, and solver regression tests

## Off Limits
- The protected benchmark `scripts/solver-quality-benchmark.mjs`
- Active-squad, protected-card, required-item, and duplicate-footballer safety rules

## Constraints
- - Decision contract: solver_quality is treated as a quality-bearing score; faster runs should not be promoted when component evidence shows quality or correctness erosion.

## Decision Rules
- Keep when the primary metric improves or a baseline is needed and checks pass.
- Discard when the metric is equal or worse, unless the run only establishes the baseline.
- Log crashes and failed checks with a concrete rollback reason.
- Put next-step guidance in ASI so another Codex session can continue.

## Stop Conditions
- Stop when all oracle cases reach zero regret, solve coverage remains 100%, and full checks pass.
- For qualitative loops, stop when `quality_gap=0`, checks pass, and no high-impact open finding remains.
- Stop when maxIterations is reached or the user interrupts.

## Research Notes
- Three clean repeat runs after chemistry optimization kept 5/5 solves, 100 quality, and zero regret in every exhaustive oracle case.
- Repeat solver_quality values: 98.715442, 98.794190, 98.811254 (median 98.794190); residual variation is benchmark runtime noise.
- The 1,600-card stress fixture solves safely in about 73-100 ms and remains below its 2,200-evaluation ceiling.

## What's Been Tried
- Baseline: 67.290088 with 5/5 solves but conservation regret in all four oracle cases.
- Kept: policy-aware bounded single/pair refinement, 98.772900 official score and zero oracle regret.
- Extended: chemistry-preserving refinement with identity pruning, full 177/177 tests, browser harness, structural checks, and package build passing.

## Resume This Session

Use these commands to pick the loop back up without rediscovering state:

```bash
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs state --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs doctor --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style' --check-benchmark
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs next --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs log --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style' --from-last --status keep --description "Describe the kept change"
node C:\Users\m.scherner\.codex\plugins\cache\TheGreenCedar\codex-autoresearch\2.7.2\scripts\autoresearch.mjs export --cwd 'D:\Daten\m.scherner\Eigene Dateien\ChatGPT\AutoSBC Matchek Style'
```

## Run Ledger

<!-- AUTORESEARCH_RUN_LEDGER:START -->
- Run 1 checks_failed: Baseline benchmark measured, generated checks wrapper had invalid quoting; metric=67.178552; best=unknown; commit=7383e9e; Git: no scoped experiment changes to revert; preserved 0 unowned dirty path(s). cleanup=61953b99c013..
- Run 2 measure: Trusted baseline: five solver challenges, exhaustive conservation oracle, 33 focused checks; metric=67.290088; best=unknown.
- Run 3 keep: Optimize every solved rating squad against the full fodder conservation objective; metric=98.7729; best=98.7729; commit=50d7508; Git: committed 50d7508..
<!-- AUTORESEARCH_RUN_LEDGER:END -->
