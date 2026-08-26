import { cloneAndFreeze } from "./immutable.js";

export const ProductPlan = Object.freeze({ FREE: "free", PRO: "pro" });
export const Feature = Object.freeze({
  PRODUCT_SHELL: "product_shell",
  SBC_PROJECTS: "sbc_projects",
  LOCAL_RECIPES: "local_recipes",
  ADVANCED_TOOLS: "advanced_tools",
  EVOLUTION_PLANNING: "evolution_planning",
  CLUB_OPTIMIZATION: "club_optimization",
  PROJECT_OPTIMIZATION: "project_optimization",
  SMART_ROUTING: "smart_routing",
  CLOUD_RECIPES: "cloud_recipes",
});

const FREE_FEATURES = new Set([Feature.PRODUCT_SHELL, Feature.SBC_PROJECTS, Feature.LOCAL_RECIPES, Feature.ADVANCED_TOOLS]);
const PRO_FEATURES = new Set([
  ...FREE_FEATURES,
  Feature.EVOLUTION_PLANNING,
  Feature.CLUB_OPTIMIZATION,
  Feature.PROJECT_OPTIMIZATION,
  Feature.SMART_ROUTING,
  Feature.CLOUD_RECIPES,
]);

export class EntitlementService {
  constructor({ plan = ProductPlan.FREE } = {}) {
    if (!Object.values(ProductPlan).includes(plan)) throw new TypeError(`Unknown product plan: ${plan}`);
    this.plan = plan;
  }

  check(feature) {
    if (!Object.values(Feature).includes(feature)) throw new TypeError(`Unknown feature: ${feature}`);
    const entitled = (this.plan === ProductPlan.PRO ? PRO_FEATURES : FREE_FEATURES).has(feature);
    return cloneAndFreeze({ entitled, feature, plan: this.plan, requiredPlan: entitled ? this.plan : ProductPlan.PRO });
  }
}
