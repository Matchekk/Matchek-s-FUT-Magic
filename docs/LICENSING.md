# Licensing and data provenance

This is engineering guidance, not legal advice.

The extension is a modified AutoPilot-SBC derivative and remains
GPL-3.0-only. New Side Panel/client code shipped in the same extension is part
of that public client. Charging is compatible with GPL distribution, but client
logic must not be treated as a proprietary secret.

Private Pro computation requires a genuinely separate repository, build,
deployment, and HTTPS data protocol. It must not import copied GPL client
implementation modules or receive EA sessions. Cloud output is a bounded plan
proposal which the GPL client validates and compiles locally.

The public GPL side owns and publishes provider interfaces, exact schemas,
validators, limits/errors, random-handle mapping, local recipe implementations,
local compatibility/safety checks, proposal-to-preview compilation, transport
adapter source and deterministic contract fixtures. The private side may own
proprietary optimization/search, billing/customer systems, provider ingestion,
service enforcement, secrets, abuse controls and infrastructure. It should
implement the published wire protocol independently rather than import GPL
client modules.

If a single canonical schema package is ever shared by public and private
builds, its copyright owners must explicitly authorize an appropriate separate
license. Until that legal/product choice is made, this repository is the public
protocol publication, not a private-server dependency.

Preserve `THIRD_PARTY_NOTICES.md`, license history, exact upstream commits, and
the Auto-SBC MIT notice. Each binary/store release needs immutable corresponding
source including build scripts, lockfile, build instructions, and exact tag.

FUT.GG currently has no documented commercial permission in this repository.
It is hard-disabled and has no host permission in the current build. Any future
provider path requires written authorization plus consent and hardened response
validation. EA automation/extension terms
and the FUT Magic name also require an owner/legal go/no-go. A disclaimer is not
authorization.

The About surface must include the GPL/no-warranty/source/notices/privacy links,
modified-derivative disclosure, and the EA non-affiliation statement.

`docs/PRO_CONTRACTS.md` is the canonical engineering data-flow boundary. A live
service also requires immutable corresponding-source archives/tags for every
distributed extension artifact and a reviewed commercial-data provenance
registry.

`docs/PROJECT_OPTIMIZER_SERVICE_PLAN.md` records the recommended independent
private implementation and the owner/legal/provenance gates that remain open.

`docs/COMMERCIAL_READINESS.md` is the canonical owner/evidence/status matrix.
It links the current official EA, Stormstrike/FUT.GG, and Chrome Web Store
policies that an owner/counsel must review before launch.

Evolution planning currently uses synthetic redacted fixtures only. A future
live catalog must have a field-level provenance registry, freshness evidence,
and a documented right to use every definition, eligibility rule,
transformation, price, and display asset. No EA credential/session, stable
owned-card identifier, raw account payload, card art, logo, or provider secret
may enter the planner or cross a service boundary. FUT.GG has no documented
Evolution-data permission here and must not be scraped or described as a
licensed source.
