# Privacy

FUT Magic is an unofficial independent product. The native Side Panel and
in-tab HUD consume bounded local view models from the active EA Web App tab.
They do not introduce an account, cloud planner, telemetry endpoint, or remote
analytics collector in this release.

## Local processing

Squad solving and settings processing happen inside the browser extension. This
project does not ship the Auto-SBC FastAPI backend and does not write club data
to CSV files.

Preferences are stored in `chrome.storage.local`. The extension reads club,
storage, unassigned-player, SBC and formation data from the active EA Web App
session to perform the requested solve and automation flows.

Local extension storage may contain versioned settings, profiles, projects,
bounded activity history, an active workflow/recovery checkpoint, and developer
snapshots when Developer Mode is explicitly enabled. Player/item identifiers
needed for an active local workflow remain inside the browser. This release
does not sync those records to a FUT Magic service.

Existing `grindpilot.*` storage keys are preserved to avoid deleting projects,
profiles, settings, activity, or workflow recovery state during the FUT Magic
brand migration.

## External player and price data

The inherited FUT.GG adapter is hard-disabled in this release. The extension
has no FUT.GG host permission and its extension-page policy permits no remote
connection. Price/concept-player requests therefore return “provider not
configured” and transmit nothing. Re-enabling any external provider requires a
documented right to use it, strict response validation, prominent disclosure,
and purpose-specific consent.

## Not collected by this project

There is no project-operated analytics endpoint, account system or telemetry
collector. No hard-coded API tokens or credentials are included.

## Diagnostics and support export

Developer Mode is off by default. If the user enables it, FUT Magic can retain
bounded local capability snapshots, route/network metadata and activity needed
to diagnose compatibility. Request/response bodies, headers, query strings and
credential-like values are excluded or redacted.

“Export diagnostics” downloads a JSON file locally. FUT Magic does not upload
it, choose a recipient, or retain a server copy. The user controls whether to
review or share that file. There is no project-operated support service in this
release, and diagnostics consent does not cover analytics, model training,
marketing, or account profiling.

This version also removes the inherited EA-origin player/league/nation metadata
caches on first load and keeps replacement lookup data in memory only. It does
not delete unrelated EA site data. A non-sensitive Developer Mode preference
may remain in EA-origin local/session storage until Developer Mode is disabled
or site data is cleared.

## Future FUT Magic Pro contracts

This source release includes schemas and deterministic local test providers for
future Project Optimization, Smart Route, recipe availability and compatibility
services. They do not transmit data. No FUT Magic service origin, sign-in,
subscription or purchase path is configured.

The contracts are designed to omit protected cards, EA cookies/credentials,
persistent owned-item IDs, stable account-derived hashes, card/player/project
names, EA set/challenge IDs and raw routes. Permitted planning facts use random
handles that exist only for one request. Cloud responses would be proposals
that are revalidated and compiled locally.

Before a live Pro provider can be enabled, FUT Magic must present a
purpose-specific disclosure of recipients, data categories and retention, and
record revocable consent for that exact policy version. Optimization consent
will not cover diagnostics, analytics, model training or marketing.

## User control

Extension data can be removed through the browser's extension settings by
clearing extension data or uninstalling the extension. EA-site data can be
cleared separately in browser site settings. Diagnostic files already
downloaded are ordinary local files and must be deleted by the user.

Before Store or commercial publication, the product owner must name the data
controller and contact, approve an effective date/change process, publish this
policy at a stable public URL, and verify the Store data-use declarations. Those
operator details are not invented in this source candidate.
