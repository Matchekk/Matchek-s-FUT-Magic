const STEP = Object.freeze({
  SOLVE: "SOLVE_SBC",
  SUBMIT: "SUBMIT_SBC",
  CLAIM: "CLAIM_REWARD",
  OPEN: "OPEN_REWARD_PACK",
  PICK: "HANDLE_PLAYER_PICK",
  RESOLVE: "RESOLVE_ITEMS",
});

const completed = (nodes, type) =>
  nodes.filter((node) => node?.step?.type === type && node?.status === "completed");

const ratingFlow = (entries, field) => {
  const counts = {};
  let cards = 0;
  let ratingPoints = 0;
  for (const entry of entries) {
    for (const item of entry?.result?.[field] ?? []) {
      const rating = Math.max(0, Math.trunc(Number(item?.rating) || 0));
      if (!rating) continue;
      counts[rating] = (counts[rating] || 0) + 1;
      cards += 1;
      ratingPoints += rating;
    }
  }
  return { cards, ratingPoints, byRating: counts };
};

/** Produces an allowlisted, credential-free per-run analytics record. */
export function summarizeRunAnalytics(run, { now = Date.now() } = {}) {
  const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
  const solves = completed(nodes, STEP.SOLVE);
  const submissions = completed(nodes, STEP.SUBMIT);
  const packs = completed(nodes, STEP.OPEN);
  const picks = completed(nodes, STEP.PICK);
  const resolutions = completed(nodes, STEP.RESOLVE);
  const startedAt = Number(run?.startedAt ?? 0) || null;
  const endedAt = Number(run?.completedAt ?? run?.stoppedAt ?? 0) || null;
  const durationEnd = endedAt ?? (startedAt ? Number(now) : null);
  const events = Array.isArray(run?.history)
    ? run.history
    : Array.isArray(run?.events)
      ? run.events
      : [];
  return Object.freeze({
    schemaVersion: 1,
    runId: run?.runId == null ? null : String(run.runId),
    status: run?.status == null ? null : String(run.status),
    mode: run?.mode == null ? null : String(run.mode),
    startedAt,
    endedAt,
    durationMs: startedAt && durationEnd ? Math.max(0, durationEnd - startedAt) : 0,
    iterations: Math.max(0, Number(run?.counters?.loopIterations) || 0),
    sbcsCompleted: submissions.length,
    rewardsClaimed: completed(nodes, STEP.CLAIM).length,
    packsOpened: packs.length,
    playerPicksCompleted: picks.length,
    cardsMovedToClub: resolutions.reduce(
      (sum, node) => sum + Number(node?.result?.movedToClub?.length || 0), 0,
    ),
    cardsMovedToStorage: resolutions.reduce(
      (sum, node) => sum + Number(node?.result?.movedToStorage?.length || 0), 0,
    ),
    duplicatesRecycled: resolutions.reduce(
      (sum, node) => sum + Number(node?.result?.movedToStorage?.length || 0), 0,
    ),
    protectedDecisions: solves.reduce(
      (sum, node) => sum + Number(node?.result?.protectedItemIds?.length || 0), 0,
    ),
    solverFailures: nodes.filter(
      (node) => node?.step?.type === STEP.SOLVE &&
        (node?.status === "failed" || Number(node?.attempt || 0) > 1),
    ).length,
    pauses: events.filter((event) =>
      ["RUN_PAUSED", "STEP_PAUSED", "STEP_GATED"].includes(event?.type),
    ).length,
    ratingFlow: {
      consumed: ratingFlow(solves, "selectedItems"),
      received: ratingFlow(packs, "receivedItems"),
    },
  });
}

export function exportRunAnalytics(run, options) {
  return JSON.stringify(summarizeRunAnalytics(run, options), null, 2);
}
