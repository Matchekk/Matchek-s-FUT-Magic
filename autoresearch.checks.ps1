$ErrorActionPreference = "Stop"

# Add correctness checks here. Keep success output quiet and failures actionable.
$global:LASTEXITCODE = 0
node --test \
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
