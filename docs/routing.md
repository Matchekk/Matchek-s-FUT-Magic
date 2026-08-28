# Routing

FUT Magic has one pure, closed routing domain under `src/routing/`. It turns a
complete normalized inventory generation into read-only advice. It never calls
EA, never quicksells and never authorizes a workflow.

## Inputs and result

`RoutingEngine.plan()` consumes a versioned `RoutingRuleset`,
`DuplicateRelations`, hard-protection analysis, verified recipe candidates and
the canonical Activity Guard state. Rules are bounded, exact-key JSON data and
are ordered by priority and stable rule ID. Every decision contains one owned
`itemId`, a destination, effect, closed reason code and explanation.

Supported destinations are Club, SBC Storage, Transfer List, active recipe,
keep Unassigned and ask the user. Unknown tradeability, missing move/storage
evidence, protection, missing recipe evidence or a non-normal Activity Guard
downgrades the decision. Automatic quicksell is intentionally not representable.

## Integration

- Unassigned/Clear duplicates builds a shared routing plan beside its existing
  exact compatibility preview.
- Pack opening refreshes inventory and records `postPackRoutingPlan` using the
  same engine.
- `RoutingValidator` invalidates stale inventory or ruleset fingerprints.

Execution remains a separate approved WorkflowEngine plan. Routing advice must
be previewed and rebound to current evidence before any EA mutation.
