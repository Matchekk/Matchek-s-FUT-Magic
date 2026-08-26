$ErrorActionPreference = "Stop"

# This recipe command is responsible for printing METRIC lines.
$global:LASTEXITCODE = 0
npm run benchmark:solver
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
