# Set Planner

The local Free planner is deliberately sequential and honest about its limits.
It uses the existing solver through `ExistingSolverCandidateGenerator`, reserves
exact owned instances in `ReservationLedger`, and validates every allocation
with `SolutionConflictValidator`.

## Invariants

- One owned `itemId` can appear in at most one challenge allocation.
- Concept references never substitute for an owned instance.
- Protected items, stale inventory/project generations and unknown hard
  requirements fail closed.
- Every later solve receives all earlier reservations as exclusions.
- A greedy dead end is `incomplete`, never a claim of global infeasibility.

The result is read-only (`canExecute: false`, `globallyOptimal: false`). There
is no customer-facing Entire Set approval/compiler surface in this milestone.
That future surface must revalidate project identity, generations and required
fingerprints before compiling each allocation to the existing WorkflowEngine.

## Pro boundary

Candidate interfaces and exact Project Optimization request/response contracts
live in the public GPL client. A production global optimizer, authenticated
transport and licensed datasets remain a separate private service. Returned
proposals still require local contract, protection and freshness validation.
