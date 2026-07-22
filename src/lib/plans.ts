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
export type ManualPlanLimit = {
  label: string;
  note?: string;
  value: string;
};
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
  manualLimits: ManualPlanLimit[];
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
  live_classes: true,
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
      "Contact-sales/custom plan. Premium activation is deferred until fixed pricing and plan mapping are approved.",
    displayName: "Premium",
    features: {
      ...allFeatures,
    },
    key: "enterprise",
    limits: {
      automations: 25000,
      courses: 150,
      students: 5000,
      team_members: 100,
      trainers: 75,
    },
    manualLimits: [
      {
        label: "Premium activation",
        value: "Blocked",
        note: "Future founder-reviewed plan only.",
      },
      {
        label: "Custom domain",
        value: "Future add-on",
        note: "Not included by default.",
      },
    ],
    target: "Future custom plan after founder review",
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
      team_members: 2,
      trainers: 1,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "5GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "20/month",
        note: "Founder-monitored during soft launch.",
      },
      { label: "Owner/admin seats", value: "1" },
      { label: "Trainer seats", value: "1" },
    ],
    target: "Solo coach starting out",
  },
  growth: {
    billing: {
      monthly: 5999,
      yearly: 59990,
    },
    description: "Main paid plan for growing coaching teams and businesses.",
    displayName: "Growth",
    features: {
      ...allFeatures,
    },
    key: "growth",
    limits: {
      automations: 5000,
      courses: 25,
      students: 1000,
      team_members: 15,
      trainers: 10,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "50GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "100/month",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Team users",
        value: "5",
        note: "Non-trainer seats are founder-monitored; automatic team-seat counting includes all roles.",
      },
      { label: "Trainer seats", value: "10" },
    ],
    target: "Scaling coaching or multi-program business",
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
    },
    key: "starter",
    limits: {
      automations: 0,
      courses: 5,
      students: 100,
      team_members: 2,
      trainers: 1,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "5GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "20/month",
        note: "Founder-monitored during soft launch.",
      },
      { label: "Owner/admin seats", value: "1" },
      { label: "Trainer seats", value: "1" },
    ],
    target: "Active coach with a small team",
  },
};

export const planOrder: PlanKey[] = ["starter", "growth"];

export const planResourceLabels: Record<PlanResource, string> = {
  automations: "Automations",
  courses: "Active programs",
  students: "Students",
  team_members: "Total team seats",
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

export function isPremiumPlanKey(value: unknown) {
  return normalizePlanKey(value) === "enterprise";
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

  if (!nearLimit || currentPlan === "enterprise" || currentIndex < 0) {
    return null;
  }

  const nextPlan = planOrder[currentIndex + 1];

  if (!nextPlan) {
    return null;
  }

  return {
    reason: "Workspace usage is nearing one or more current plan limits.",
    recommendedPlan: nextPlan,
    recommendedPlanName: getPlanDisplayName(nextPlan),
  };
}
