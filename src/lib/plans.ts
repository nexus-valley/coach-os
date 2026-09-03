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
export type CommercialPlanFeatureStatus =
  | "addon"
  | "coming_soon"
  | "included"
  | "locked"
  | "platform_approval_required";
export type CommercialPlanFeatureKey =
  | "ai_assistant"
  | "api_integrations"
  | "approvals"
  | "assignments"
  | "attendance"
  | "audit_compliance"
  | "automations"
  | "backup_recovery"
  | "certificates"
  | "community_hub"
  | "courses"
  | "crm"
  | "dashboard"
  | "document_uploads"
  | "documents"
  | "finance"
  | "live_classes"
  | "marketing"
  | "messages"
  | "mobile_pwa"
  | "notifications"
  | "payment_gateway"
  | "reports"
  | "students"
  | "team_operations"
  | "website_builder"
  | "workflows"
  | "custom_branding";
export type CommercialPlanContract = {
  billing: {
    monthly: number | null;
    yearly: number | null;
  };
  code: "growth" | "premium" | "starter";
  features: Record<CommercialPlanFeatureKey, CommercialPlanFeatureStatus>;
  limits: {
    admins: number;
    aiRequestsMonthly: number;
    automationRunsMonthly: number;
    batches: number;
    cohorts: number;
    documentUploads: number;
    messagesMonthly: number;
    programs: number;
    staffTrainers: number;
    storageMb: number;
    students: number;
    teamMembers: number;
  };
  trialDays: number;
};
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
  commercialContract: CommercialPlanContract | null;
  key: PlanKey;
  limits: Record<PlanResource, ResourceLimit>;
  manualLimits: ManualPlanLimit[];
  target: string;
};

const sharedIncludedFeatures = {
  assignments: "included",
  attendance: "included",
  community_hub: "included",
  courses: "included",
  dashboard: "included",
  document_uploads: "included",
  documents: "included",
  finance: "included",
  messages: "included",
  mobile_pwa: "included",
  notifications: "included",
  reports: "included",
  students: "included",
} as const;

export const commercialPlanContracts = {
  enterprise: {
    billing: { monthly: null, yearly: null },
    code: "premium",
    features: {
      ...sharedIncludedFeatures,
      ai_assistant: "platform_approval_required",
      api_integrations: "included",
      approvals: "included",
      audit_compliance: "included",
      automations: "included",
      backup_recovery: "included",
      certificates: "included",
      crm: "included",
      custom_branding: "included",
      live_classes: "coming_soon",
      marketing: "included",
      payment_gateway: "coming_soon",
      team_operations: "included",
      website_builder: "included",
      workflows: "included",
    },
    limits: {
      admins: 15,
      aiRequestsMonthly: 10000,
      automationRunsMonthly: 25000,
      batches: 150,
      cohorts: 150,
      documentUploads: 50000,
      messagesMonthly: 100000,
      programs: 150,
      staffTrainers: 75,
      storageMb: 102400,
      students: 5000,
      teamMembers: 100,
    },
    trialDays: 14,
  },
  growth: {
    billing: { monthly: 5999, yearly: 59990 },
    code: "growth",
    features: {
      ...sharedIncludedFeatures,
      ai_assistant: "platform_approval_required",
      api_integrations: "locked",
      approvals: "included",
      audit_compliance: "included",
      automations: "included",
      backup_recovery: "included",
      certificates: "included",
      crm: "included",
      custom_branding: "addon",
      live_classes: "coming_soon",
      marketing: "included",
      payment_gateway: "coming_soon",
      team_operations: "included",
      website_builder: "addon",
      workflows: "included",
    },
    limits: {
      admins: 5,
      aiRequestsMonthly: 500,
      automationRunsMonthly: 5000,
      batches: 25,
      cohorts: 25,
      documentUploads: 10000,
      messagesMonthly: 25000,
      programs: 25,
      staffTrainers: 15,
      storageMb: 25600,
      students: 500,
      teamMembers: 20,
    },
    trialDays: 14,
  },
  starter: {
    billing: { monthly: 1499, yearly: 14990 },
    code: "starter",
    features: {
      ...sharedIncludedFeatures,
      ai_assistant: "locked",
      api_integrations: "locked",
      approvals: "locked",
      audit_compliance: "locked",
      automations: "locked",
      backup_recovery: "locked",
      certificates: "locked",
      crm: "locked",
      custom_branding: "locked",
      live_classes: "coming_soon",
      marketing: "locked",
      payment_gateway: "coming_soon",
      team_operations: "locked",
      website_builder: "locked",
      workflows: "locked",
    },
    limits: {
      admins: 2,
      aiRequestsMonthly: 0,
      automationRunsMonthly: 0,
      batches: 5,
      cohorts: 5,
      documentUploads: 500,
      messagesMonthly: 1000,
      programs: 5,
      staffTrainers: 3,
      storageMb: 2048,
      students: 100,
      teamMembers: 5,
    },
    trialDays: 14,
  },
} satisfies Record<"enterprise" | "growth" | "starter", CommercialPlanContract>;

const starterContract = commercialPlanContracts.starter;
const growthContract = commercialPlanContracts.growth;
const premiumContract = commercialPlanContracts.enterprise;

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
    billing: premiumContract.billing,
    commercialContract: premiumContract,
    description:
      "Contact-sales/custom plan. Premium activation is deferred until fixed pricing and plan mapping are approved.",
    displayName: "Premium",
    features: {
      ...allFeatures,
      live_classes: false,
    },
    key: "enterprise",
    limits: {
      automations: premiumContract.limits.automationRunsMonthly,
      courses: premiumContract.limits.programs,
      students: premiumContract.limits.students,
      team_members: premiumContract.limits.teamMembers,
      trainers: premiumContract.limits.staffTrainers,
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
    commercialContract: null,
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
      automations: starterContract.limits.automationRunsMonthly,
      courses: starterContract.limits.programs,
      students: starterContract.limits.students,
      team_members: starterContract.limits.teamMembers,
      trainers: starterContract.limits.staffTrainers,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "2 GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "Coming soon",
      },
      { label: "Owner/admin seats", value: "2" },
      { label: "Staff/Trainer seats", value: "3" },
      { label: "Total team members", value: "5" },
    ],
    target: "Solo coach starting out",
  },
  growth: {
    billing: growthContract.billing,
    commercialContract: growthContract,
    description: "Main paid plan for growing coaching teams and businesses.",
    displayName: "Growth",
    features: {
      ...allFeatures,
      branded_portal: false,
      live_classes: false,
    },
    key: "growth",
    limits: {
      automations: growthContract.limits.automationRunsMonthly,
      courses: growthContract.limits.programs,
      students: growthContract.limits.students,
      team_members: growthContract.limits.teamMembers,
      trainers: growthContract.limits.staffTrainers,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "25 GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "Coming soon",
      },
      {
        label: "Owner/admin seats",
        value: "5",
      },
      { label: "Staff/Trainer seats", value: "15" },
      { label: "Total team members", value: "20" },
    ],
    target: "Scaling coaching or multi-program business",
  },
  starter: {
    billing: starterContract.billing,
    commercialContract: starterContract,
    description: "Paid launch plan for small coaching teams and businesses.",
    displayName: "Starter",
    features: {
      ...allFeatures,
      automations: false,
      branded_portal: false,
      certificates: false,
      live_classes: false,
    },
    key: "starter",
    limits: {
      automations: starterContract.limits.automationRunsMonthly,
      courses: starterContract.limits.programs,
      students: starterContract.limits.students,
      team_members: starterContract.limits.teamMembers,
      trainers: starterContract.limits.staffTrainers,
    },
    manualLimits: [
      {
        label: "Storage",
        value: "2 GB",
        note: "Founder-monitored during soft launch.",
      },
      {
        label: "Live classes",
        value: "Coming soon",
      },
      { label: "Owner/admin seats", value: "2" },
      { label: "Staff/Trainer seats", value: "3" },
      { label: "Total team members", value: "5" },
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

export const publicPricingPlanOrder: PlanKey[] = [
  "starter",
  "growth",
  "enterprise",
];

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

export function formatInrAmount(amount: number) {
  return `INR ${amount.toLocaleString("en-IN")}`;
}

export function formatInrAmountMinor(amountMinor: number) {
  return formatInrAmount(amountMinor / 100);
}

export function getPlanBillingAmount(
  plan: StoredPlanKey | PlanKey | unknown,
  billingCycle: BillingCycle,
) {
  return getPlanDefinition(plan).billing[billingCycle];
}

export function getPlanAmountMinor(
  plan: StoredPlanKey | PlanKey | unknown,
  billingCycle: BillingCycle,
) {
  const amount = getPlanBillingAmount(plan, billingCycle);

  return amount === null ? null : amount * 100;
}

export function getPlanDisplayPrice(
  plan: StoredPlanKey | PlanKey | unknown,
  billingCycle: BillingCycle,
) {
  const amount = getPlanBillingAmount(plan, billingCycle);

  if (amount === null) {
    return "Contact Sales";
  }

  if (amount === 0) {
    return "Free";
  }

  return `${formatInrAmount(amount)} / ${
    billingCycle === "monthly" ? "month" : "year"
  }`;
}

export function getPlanLimitSummary(plan: StoredPlanKey | PlanKey | unknown) {
  const limits = getPlanDefinition(plan).limits;

  return `up to ${formatResourceLimit(limits.students)} students and ${formatResourceLimit(
    limits.courses,
  )} active programs`;
}

export function getPublicStartingPrice() {
  const amount = getPlanBillingAmount("starter", "monthly");

  return amount === null ? "Contact us" : formatInrAmount(amount);
}

export function getPublicPlanCards() {
  return publicPricingPlanOrder.map((plan) => {
    const definition = getPlanDefinition(plan);

    return {
      description: definition.description,
      key: plan,
      limitSummary: isPremiumPlanKey(plan)
        ? "Custom scope and activation review"
        : getPlanLimitSummary(plan),
      monthly: getPlanDisplayPrice(plan, "monthly"),
      name: definition.displayName,
      yearly: getPlanDisplayPrice(plan, "yearly"),
    };
  });
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
