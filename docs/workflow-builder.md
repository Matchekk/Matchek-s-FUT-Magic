# Workflow Builder

The builder edits ordered, typed workflow definitions rather than executable
scripts. Steps can be added, deleted, moved and duplicated; `LOOP` and
`CONDITIONAL` steps expose their nested branches. Every step carries a timeout,
bounded retry policy and explicit failure behavior.

Production templates:

1. Simple Repeatable SBC
2. Reward Pack Loop
3. Player Pick Grind
4. Daily Upgrade Chain
5. Target SBC Grind

Templates intentionally use `CURRENT_OPEN_SBC`. A manually configured
`SPECIFIC_SET` or `SPECIFIC_CHALLENGE` target is matched against stable EA IDs.
If controller-level navigation is unavailable, GrindPilot asks the user to open
that target and then verifies the ID; it does not click through changing labels
or positional DOM selectors.

Legacy AutoPilot Sequence plans can be read and imported. Set/challenge IDs,
loop counts and solver-setting snapshots are preserved in a new typed workflow.
The original legacy plan remains untouched.

AUTO approval is bound to the normalized workflow hash. Editing the builder
therefore invalidates a previous approval and requires a new run summary.
