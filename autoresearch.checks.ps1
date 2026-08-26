$ErrorActionPreference = "Stop"

# Add correctness checks here. Keep success output quiet and failures actionable.
$global:LASTEXITCODE = 0
node --test test/chemistry.test.js test/solver-constraint-coverage.test.js test/solver-policy-adapter.test.js test/solver-policy-fodder.test.js test/solver-policy-identity.test.js test/solver-policy-rating.test.js test/solver-policy-target-project.test.js test/solver-regressions.test.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
