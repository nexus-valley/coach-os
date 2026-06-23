import type {
  MobileBootstrap,
  MobileStudentHome,
  MobileTeamHome,
  MobileTrainerHome,
} from "@/src/lib/mobileTypes";

export type AssistantScope = "student" | "team";

export type AssistantProviderMode = "mock";

export type AssistantRequest = {
  conversationId?: string | null;
  message: string;
  scope: AssistantScope;
};

export type AssistantContext = {
  bootstrap: MobileBootstrap;
  context: Record<string, unknown>;
  contextSummary: Record<string, unknown>;
  mode: "student" | "team";
  role?: "admin" | "owner" | "staff" | "trainer";
  scope: AssistantScope;
  studentId?: string | null;
  tenantId: string;
};

export type AssistantHomePayload =
  | MobileStudentHome
  | MobileTeamHome
  | MobileTrainerHome;

export type AssistantProviderInput = {
  context: AssistantContext;
  message: string;
};

export type AssistantProviderResult = {
  provider: AssistantProviderMode;
  response: string;
  responseCharCount: number;
};

export type AssistantServiceResult = {
  contextSummary: Record<string, unknown>;
  conversationId: string | null;
  provider: AssistantProviderMode;
  reply: string;
  scope: AssistantScope;
};
