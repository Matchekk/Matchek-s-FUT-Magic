# Live verification checklist

Use a low-value repeatable SBC and owned reward only. Do not test with a pack
purchase, market action or quicksell; GrindPilot has no authorized path for
those actions.

## Safe preflight

- Install the unpacked `2.2.0` build and reload the EA Web App.
- Confirm the Developer page reports Inventory, Current SBC and Solve as
  `AVAILABLE` or `UNVERIFIED`, with a concrete reason for every degraded item.
- Open a disposable repeatable SBC and synchronize Inventory.
- Create/import a Target Project and hard-protect at least one recognizable
  high-rated card.
- Run REVIEW first and inspect Solve Details. Confirm no protected item appears
  in the candidate squad.

## Controlled single iteration

- Switch to ASSISTED with one iteration and one pack maximum.
- Approve Submit only after checking the challenge ID and squad.
- Verify the completed challenge in EA and Target Project progress.
- Approve Reward Claim and verify exactly one positive owned-pack count delta.
- Approve opening only that correlated free owned pack.
- For a Player Pick, verify the displayed policy outcome; use
  `PAUSE_FOR_USER` if offers/capability are incomplete.
- Approve unassigned resolution and confirm normal cards reach Club while only
  eligible untradeable duplicates enter SBC Storage.
- Confirm no unresolved item, purchase dialog, market action or quicksell was
  triggered.

## Reload recovery

Repeat in a disposable environment while reloading once during each destructive
operation. The recovered run must say exactly one of: verified complete, proven
not applied (safe retry), or ambiguous (manual reconciliation). It must never
repeat an ambiguous operation.

## Release evidence

Record the extension version, date, Web App route, tested SBC/reward type and
the capability-health statuses. Mark only directly observed operations as live
verified; retain untested/destructive variants as unverified.
