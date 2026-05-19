export type PlanKey = "free" | "starter" | "growth";
export type StoredPlanKey = PlanKey | "pro" | "business";
export type PlanResource =
  | "automations"
  | "courses"
  | "students"
  | "team_members"
  | "trainers";
export type ResourceLimit = number | "unlimited";

export type PlanDefinition = {
  description: string;
  displayName: string;
  key: PlanKey;
  limits: Record<PlanResource, ResourceLimit>;
  target: string;
};

export const planDefinitions: Record<PlanKey, PlanDefinition> = {
  free: {
    description: "Core workspace for validating CoachFort with a small team.",
    displayName: "Free",
    key: "free",
    limits: {
      automations: 1,
      courses: 2,
      students: 25,
      team_members: 2,
      trainers: 1,
    },
    target: "Solo coach starting out",
  },
  growth: {
    description: "Unlimited workspace foundation for serious coaching teams.",
    displayName: "Growth",
    key: "growth",
    limits: {
      automations: "unlimited",
      courses: "unlimited",
      students: "unlimited",
      team_members: "unlimited",
      trainers: "unlimited",
    },
    target: "Scaling academy or multi-program business",
  },
  starter: {
    description: "More room for a growing coaching business.",
    displayName: "Starter",
    key: "starter",
    limits: {
      automations: 10,
      courses: 20,
      students: 200,
      team_members: 10,
      trainers: 5,
    },
    target: "Active coach with a small team",
  },
};

export const planOrder: PlanKey[] = ["free", "starter", "growth"];

export const planResourceLabels: Record<PlanResource, string> = {
  automations: "Automations",
  courses: "Courses",
  students: "Students",
  team_members: "Team members",
  trainers: "Trainers",
};

export function normalizePlanKey(value: unknown): PlanKey {
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
