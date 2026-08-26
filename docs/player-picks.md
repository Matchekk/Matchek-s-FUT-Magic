# Player Picks

Player Picks are handled by the same persisted workflow as reward packs. The
default policy is `PAUSE_FOR_USER`; no card is selected unless a complete,
unambiguous offer set and stable pick identity can be read.

Supported policies are:

- `HIGHEST_RATING`
- `HIGHEST_VALUE` when every offer exposes a verified value
- `PREFER_NON_DUPLICATE`
- `PREFER_REQUIRED_SPECIAL`
- `CUSTOM_PRIORITY`, using an ordered list of typed criteria

Duplicate detection compares exact resource/card-version IDs with Club and
SBC Storage. Preferred-player matching uses the base-player ID, while preferred
resource matching remains version-specific. Required-special matching is
case-insensitive across card type, rarity name and explicit special groups.

Before selection, GrindPilot persists the pick identity, a deterministic offer
identity and the exact intended item/resource ID. It immediately re-reads the
pick before dispatch. After dispatch it requires both consumption of that pick
and observation of the selected owned item. A reload is reconciled as
`completed`, `not_applied` or `ambiguous`; ambiguous state always requires the
user and is never clicked again automatically.

If EA does not expose one of the known controller methods or the offers are
incomplete, capability health reports the limitation and the workflow pauses.
