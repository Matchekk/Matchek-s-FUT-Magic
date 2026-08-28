# Pack correlation

`EarnedPackTracker` binds a claimed reward to one exact owned-pack delta and to
the originating workflow operation. It accepts only one newly owned unit:

- one new pack row with count one; or
- exactly plus one in one homogeneous existing stack.

No delta, plus two, multiple positive IDs, duplicated rows, contradictory
explicit IDs, purchasable packs and malformed counts are ambiguous and pause.
`PackService` resolves the persisted binding against the current owned-pack
inventory before opening. Name similarity is never sufficient.

After a verified open, inventory is refreshed and the shared RoutingEngine
creates read-only post-pack Unassigned advice. Actual moves still pass through
an approved WorkflowEngine step, OperationScheduler and Activity Guard.

Recovery requires both a one-unit pack decrease and newly observed item IDs.
Any mixed post-state is ambiguous; timeout is never success.
