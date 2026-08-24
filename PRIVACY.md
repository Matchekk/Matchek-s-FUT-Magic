# Privacy

## Local processing

Squad solving and settings processing happen inside the browser extension. This
project does not ship the Auto-SBC FastAPI backend and does not write club data
to CSV files.

Preferences are stored in `chrome.storage.local`. The extension reads club,
storage, unassigned-player, SBC and formation data from the active EA Web App
session to perform the requested solve and automation flows.

## FUT.GG requests

When price or concept-player functionality is used, EA player definition IDs,
filters and pagination parameters can be sent to `https://www.fut.gg`. Requests
use `credentials: "omit"`; EA cookies and authentication tokens are not sent.
FUT.GG will still receive ordinary connection metadata such as IP address and
request time under its own privacy policy.

## Not collected by this project

There is no project-operated analytics endpoint, account system or telemetry
collector. No hard-coded API tokens or credentials are included.

## User control

Extension data can be removed through the browser's extension settings by
clearing site/extension data or uninstalling the extension.
