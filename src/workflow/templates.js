import { WorkflowStepType } from "./constants.js";
import { normalizeWorkflowDefinition } from "./definitions.js";

const step = (id, type, config = {}) => ({ id, type, config });
const rewardCycle = (prefix = "cycle") => [
  step(`${prefix}-solve`, WorkflowStepType.SOLVE_SBC, { target: { kind: "CURRENT_OPEN_SBC" } }),
  step(`${prefix}-submit`, WorkflowStepType.SUBMIT_SBC),
  step(`${prefix}-claim`, WorkflowStepType.CLAIM_REWARD),
  step(`${prefix}-open`, WorkflowStepType.OPEN_REWARD_PACK),
  step(`${prefix}-pick`, WorkflowStepType.HANDLE_PLAYER_PICK),
  step(`${prefix}-resolve`, WorkflowStepType.RESOLVE_ITEMS),
];

const loopTemplate = (id, name, body, iterations = 1) =>
  normalizeWorkflowDefinition({
    id,
    name,
    version: 1,
    metadata: { template: id, safetyModel: "fail-closed" },
    steps: [step(`${id}-loop`, WorkflowStepType.LOOP, { maxIterations: iterations, body })],
  });

export const WORKFLOW_TEMPLATES = Object.freeze({
  SIMPLE_REPEATABLE_SBC: loopTemplate(
    "simple-repeatable-sbc",
    "Simple Repeatable SBC",
    rewardCycle("repeatable"),
  ),
  REWARD_PACK_LOOP: loopTemplate(
    "reward-pack-loop",
    "Reward Pack Loop",
    rewardCycle("reward"),
  ),
  PLAYER_PICK_GRIND: loopTemplate(
    "player-pick-grind",
    "Player Pick Grind",
    rewardCycle("pick-grind"),
  ),
  DAILY_UPGRADE_CHAIN: loopTemplate(
    "daily-upgrade-chain",
    "Daily Upgrade Chain",
    [
      ...rewardCycle("daily-a"),
      step("daily-chain-pause", WorkflowStepType.PAUSE, {
        reason: "Open the next stable-ID SBC target before continuing the chain.",
      }),
    ],
  ),
  TARGET_SBC_GRIND: loopTemplate(
    "target-sbc-grind",
    "Target SBC Grind",
    rewardCycle("target"),
  ),
});

export const listWorkflowTemplates = () =>
  Object.entries(WORKFLOW_TEMPLATES).map(([id, workflow]) => ({
    id,
    name: workflow.name,
    workflow: structuredClone(workflow),
  }));

export const getWorkflowTemplate = (id) => {
  const workflow = WORKFLOW_TEMPLATES[String(id)];
  if (!workflow) throw new TypeError(`Unknown workflow template: ${String(id)}`);
  return structuredClone(workflow);
};

export const importLegacySequence = (plan) => {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    throw new TypeError("A legacy Sequence plan is required");
  }
  const body = [];
  for (const [index, legacy] of plan.steps.filter((entry) => entry?.enabled !== false).entries()) {
    const target = legacy?.target || legacy;
    const setId = target?.setId == null ? null : String(target.setId);
    const challengeId = target?.challengeId == null
      ? null
      : String(target.challengeId);
    const legacyKind = String(target?.kind ?? "").trim().toLowerCase();
    const kind = legacyKind.includes("challenge") || (challengeId && !setId)
      ? "SPECIFIC_CHALLENGE"
      : legacyKind.includes("set") || setId
        ? "SPECIFIC_SET"
        : "CURRENT_OPEN_SBC";
    const solve = step(`legacy-${index + 1}-solve`, WorkflowStepType.SOLVE_SBC, {
      target: { kind, setId, challengeId },
      solverSettings: legacy?.settingsSnapshot || {},
    });
    const submit = step(`legacy-${index + 1}-submit`, WorkflowStepType.SUBMIT_SBC);
    const count = Math.max(1, Math.min(1000, Math.trunc(Number(legacy?.loopCount) || 1)));
    body.push(
      count === 1
        ? solve
        : step(`legacy-${index + 1}-loop`, WorkflowStepType.LOOP, {
            maxIterations: count,
            body: [solve, submit],
          }),
    );
    if (count === 1) body.push(submit);
  }
  if (!body.length) throw new TypeError("Legacy Sequence has no enabled steps");
  const planLoops = Math.max(
    1,
    Math.min(1000, Math.trunc(Number(plan?.policy?.planLoopCount) || 1)),
  );
  return normalizeWorkflowDefinition({
    id: `legacy-${String(plan.id ?? "sequence")}`,
    name: `Imported: ${String(plan.name ?? "Legacy Sequence")}`,
    version: 1,
    metadata: { source: "legacy-sequence", legacyPlanId: plan.id ?? null },
    steps:
      planLoops === 1
        ? body
        : [step("legacy-plan-loop", WorkflowStepType.LOOP, { maxIterations: planLoops, body })],
  });
};
