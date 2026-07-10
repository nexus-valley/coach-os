export type PlanKey = "enterprise" | "free" | "growth" | "starter";
export type StoredPlanKey = PlanKey | "pro" | "business";
export type PlanResource =
  | "automations"
  | "courses"
  | "students"
  | "team_members"
  | "trainers";
export type ResourceLimit = number | "unlimited";
export type BillingCycle = "monthly" | "yearly";
export type FeatureKey =
  | "assignments"
  | "attendance"
  | "automations"
  | "branded_portal"
  | "certificates"
  | "cohorts"
  | "courses"
  | "live_classes"
  | "messages"
  | "reports"
  | "students"
  | "trainers";

export type PlanDefinition = {
  billing: {
    monthly: number | null;
    yearly: number | null;
  };
  description: string;
  displayName: string;
  features: Record<FeatureKey, boolean>;
  key: PlanKey;
  limits: Record<PlanResource, ResourceLimit>;
  target: string;
};

const allFeatures: Record<FeatureKey, boolean> = {
  assignments: true,
  attendance: true,
  automations: true,
  branded_portal: true,
  certificates: true,
  cohorts: true,
  courses: true,
  live_classes: false,
  messages: true,
  reports: true,
  students: true,
  trainers: true,
};

export const planDefinitions: Record<PlanKey, PlanDefinition> = {
  enterprise: {
    billing: {
      monthly: null,
      yearly: null,
    },
    description:
      "Contact-sales plan for multi-branch academies and high-scale needs.",
    displayName: "Premium",
    features: {
      ...allFeatures,
      live_classes: false,
    },
    key: "enterprise",
    limits: {
      automations: 25000,
      courses: 150,
      students: 5000,
      team_members: 100,
      trainers: 75,
    },
    target: "Large academy or multi-location institute",
  },
  free: {
    billing: {
      monthly: 0,
      yearly: 0,
    },
    description:
      "Legacy preview fallback. Public paid packaging starts with Starter.",
    displayName: "Starter preview",
    features: {
      ...allFeatures,
      automations: false,
      branded_portal: false,
      live_classes: false,
      reports: false,
    },
    key: "free",
    limits: {
      automations: 0,
      courses: 5,
      students: 100,
      team_members: 5,
      trainers: 3,
    },
    target: "Solo coach starting out",
  },
  growth: {
    billing: {
      monthly: 5999,
      yearly: 59990,
    },
    description: "Main paid plan for growing coaching teams and institutes.",
    displayName: "Growth",
    features: {
      ...allFeatures,
      live_classes: false,
    },
    key: "growth",
    limits: {
      automations: 5000,
      courses: 25,
      students: 500,
      team_members: 20,
      trainers: 15,
    },
    target: "Scaling academy or multi-program business",
  },
  starter: {
    billing: {
      monthly: 1499,
      yearly: 14990,
    },
    description: "Paid launch plan for small coaching centers and teams.",
    displayName: "Starter",
    features: {
      ...allFeatures,
      automations: false,
      branded_portal: false,
      live_classes: false,
    },
    key: "starter",
    limits: {
      automations: 0,
      courses: 5,
      students: 100,
      team_members: 5,
      trainers: 3,
    },
    target: "Active coach with a small team",
  },
};

export const planOrder: PlanKey[] = ["starter", "growth", "enterprise"];

export const planResourceLabels: Record<PlanResource, string> = {
  automations: "Automations",
  courses: "Courses",
  students: "Students",
  team_members: "Team members",
  trainers: "Trainers",
};

export function normalizePlanKey(value: unknown): PlanKey {
  if (value === "enterprise" || value === "premium") {
    return "enterprise";
  }

  if (value === "starter") {
    return "starter";
  }

  if (value === "growth" || value === "pro" || value === "business") {
    return "growth";
  }

  return "free";
}

export function getStoredPlanForPlanKey(plan: PlanKey) {
  return plan === "growth" ? "business" : plan;
}

export function getPlanDefinition(plan: StoredPlanKey | PlanKey | unknown) {
  return planDefinitions[normalizePlanKey(plan)];
}

export function getPlanLimits(plan: StoredPlanKey | PlanKey | unknown) {
  return getPlanDefinition(plan).limits;
}

export function getPlanDisplayName(plan: StoredPlanKey | PlanKey | unknown) {
  return getPlanDefinition(plan).displayName;
}

export function formatResourceLimit(limit: ResourceLimit) {
  return limit === "unlimited" ? "Unlimited" : limit.toLocaleString();
}

export function isWithinLimit(used: number, limit: ResourceLimit) {
  return limit === "unlimited" || used < limit;
}

export function getAvailablePlans() {
  return planOrder.map((plan) => planDefinitions[plan]);
}

export function getCurrentPlan(plan: StoredPlanKey | PlanKey | unknown) {
  return getPlanDefinition(plan);
}

export function getFeatureAccess(
  plan: StoredPlanKey | PlanKey | unknown,
  feature: FeatureKey,
) {
  return getPlanDefinition(plan).features[feature] ?? false;
}

export function canUseFeature(
  plan: StoredPlanKey | PlanKey | unknown,
  feature: FeatureKey,
  featureFlags: Record<string, unknown> = {},
) {
  const override = featureFlags[feature];

  if (typeof override === "boolean") {
    return override;
  }

  return getFeatureAccess(plan, feature);
}

export function getPlanUpgradeRecommendation(
  usage: Partial<Record<PlanResource, number>>,
  plan: StoredPlanKey | PlanKey | unknown,
) {
  const currentPlan = normalizePlanKey(plan);
  const currentIndex = planOrder.indexOf(currentPlan);
  const definition = getPlanDefinition(currentPlan);
  const nearLimit = (Object.keys(definition.limits) as PlanResource[]).some(
    (resource) => {
      const limit = definition.limits[resource];
      const used = usage[resource] ?? 0;

      return limit !== "unlimited" && used >= limit * 0.8;
    },
  );

  if (!nearLimit || currentPlan === "enterprise") {
    return null;
  }

  const nextPlan = planOrder[Math.min(currentIndex + 1, planOrder.length - 1)];

  return {
    reason: "Workspace usage is nearing one or more current plan limits.",
    recommendedPlan: nextPlan,
    recommendedPlanName: getPlanDisplayName(nextPlan),
  };
}
