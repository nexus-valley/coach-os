import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type RegressionRole = "owner" | "admin" | "staff" | "trainer" | "student";

type RegressionAccountDefinition = {
  createStudentRecord?: boolean;
  emailEnv: string;
  fullName: string;
  passwordEnv: string;
  phone: string;
  role: RegressionRole;
};

type RegressionAccount = RegressionAccountDefinition & {
  email: string;
  password: string;
};

type SetupResult = {
  email: string;
  role: RegressionRole;
  authStatus: "created" | "reused";
  profileStatus: "upserted";
  membershipStatus: "created" | "updated" | "reused" | "skipped";
  portalLinkStatus: "created" | "updated" | "reused" | "skipped";
  studentStatus: "created" | "updated" | "skipped";
};

type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string | null;
};

const LOCAL_PROVISIONING_FLAG =
  "COACHFORT_ALLOW_LOCAL_REGRESSION_PROVISIONING";
const TENANT_NAME = "CoachFort Regression Coaching";
const TENANT_SLUG = "coachfort-regression";
const localSupabaseHosts = new Set(["127.0.0.1", "localhost", "::1"]);

const requiredAccountDefinitions: RegressionAccountDefinition[] = [
  {
    emailEnv: "COACHFORT_OWNER_EMAIL",
    fullName: "Regression Owner",
    passwordEnv: "COACHFORT_OWNER_PASSWORD",
    phone: "+910000000001",
    role: "owner",
  },
  {
    emailEnv: "COACHFORT_ADMIN_EMAIL",
    fullName: "Regression Admin",
    passwordEnv: "COACHFORT_ADMIN_PASSWORD",
    phone: "+910000000002",
    role: "admin",
  },
  {
    emailEnv: "COACHFORT_STAFF_EMAIL",
    fullName: "Regression Staff",
    passwordEnv: "COACHFORT_STAFF_PASSWORD",
    phone: "+910000000003",
    role: "staff",
  },
  {
    emailEnv: "COACHFORT_TRAINER_EMAIL",
    fullName: "Regression Trainer",
    passwordEnv: "COACHFORT_TRAINER_PASSWORD",
    phone: "+910000000004",
    role: "trainer",
  },
  {
    createStudentRecord: true,
    emailEnv: "COACHFORT_STUDENT_EMAIL",
    fullName: "Regression Student",
    passwordEnv: "COACHFORT_STUDENT_PASSWORD",
    phone: "+910000000005",
    role: "student",
  },
];

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function assertLocalProvisioningAllowed(supabaseUrl: string) {
  if (
    process.env[LOCAL_PROVISIONING_FLAG]?.trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      `${LOCAL_PROVISIONING_FLAG}=true is required for local provisioning.`,
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid local-development URL.");
  }

  if (
    parsedUrl.protocol !== "http:" ||
    !localSupabaseHosts.has(parsedUrl.hostname) ||
    !parsedUrl.port
  ) {
    throw new Error(
      "Regression provisioning is restricted to an explicit local Supabase URL.",
    );
  }

  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV
  ) {
    throw new Error("Regression provisioning is disabled in hosted environments.");
  }
}

function loadRequiredAccounts() {
  const accounts = requiredAccountDefinitions.map((definition) => ({
    ...definition,
    email: getRequiredEnv(definition.emailEnv).toLowerCase(),
    password: getRequiredEnv(definition.passwordEnv),
  }));
  const emails = new Set(accounts.map((account) => account.email));
  const passwords = new Set(accounts.map((account) => account.password));

  if (emails.size !== accounts.length) {
    throw new Error("Each local regression role must use a distinct email.");
  }

  if (passwords.size !== accounts.length) {
    throw new Error("Each local regression role must use a distinct password.");
  }

  return accounts;
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "<masked-identifier>";
  }

  return `${localPart.slice(0, 1)}***@${domain}`;
}

function maskUuid(value: string) {
  return value.length > 12
    ? `${value.slice(0, 8)}-...-${value.slice(-4)}`
    : "<masked-id>";
}

function sanitizeDiagnosticMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);

  return message
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "<masked-email>",
    )
    .replace(
      /\b(password|authorization|cookie|access_token|refresh_token|service_role)\s*[:=]\s*\S+/gi,
      "$1=<redacted>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<masked-id>",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\b/g, "<redacted-token>")
    .slice(0, 500);
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const foundUser = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail,
    );

    if (foundUser) {
      return foundUser;
    }

    if (data.users.length < perPage) {
      return null;
    }
  }

  throw new Error("Unable to finish the local Auth user lookup.");
}

async function createAuthUser(
  supabase: SupabaseClient,
  account: RegressionAccount,
) {
  const existingUser = await findAuthUserByEmail(supabase, account.email);

  if (existingUser) {
    return { user: existingUser, status: "reused" as const };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
      regression_test: true,
      role: account.role,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error(`Local ${account.role} Auth user was not returned.`);
  }

  return { user: data.user as User, status: "created" as const };
}

async function getOrCreateLocalTenant(
  supabase: SupabaseClient,
  ownerUserId: string,
): Promise<TenantRecord> {
  const existingTenant = await supabase
    .from("tenants")
    .select("id,name,slug,owner_user_id")
    .eq("slug", TENANT_SLUG)
    .maybeSingle<TenantRecord>();

  if (existingTenant.error) {
    throw existingTenant.error;
  }

  if (existingTenant.data) {
    if (existingTenant.data.owner_user_id !== ownerUserId) {
      throw new Error(
        "The existing local regression tenant belongs to a different owner.",
      );
    }

    return existingTenant.data;
  }

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      category: "coaching",
      name: TENANT_NAME,
      owner_user_id: ownerUserId,
      slug: TENANT_SLUG,
    })
    .select("id,name,slug,owner_user_id")
    .single<TenantRecord>();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertProfile(
  supabase: SupabaseClient,
  account: RegressionAccount,
  userId: string,
) {
  const { error } = await supabase.from("profiles").upsert(
    {
      avatar_url: null,
      email: account.email,
      full_name: account.fullName,
      id: userId,
    },
    { onConflict: "id" },
  );

  if (error) {
    throw error;
  }

  return "upserted" as const;
}

async function upsertTenantMember(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  role: RegressionRole,
) {
  if (role === "student") {
    return "skipped" as const;
  }

  const existingMember = await supabase
    .from("tenant_members")
    .select("id,role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; role: string }>();

  if (existingMember.error) {
    throw existingMember.error;
  }

  if (existingMember.data) {
    if (existingMember.data.role === role) {
      return "reused" as const;
    }

    const { error } = await supabase
      .from("tenant_members")
      .update({ role })
      .eq("id", existingMember.data.id);

    if (error) {
      throw error;
    }

    return "updated" as const;
  }

  const { error } = await supabase.from("tenant_members").insert({
    role,
    tenant_id: tenantId,
    user_id: userId,
  });

  if (error) {
    throw error;
  }

  return "created" as const;
}

async function upsertStudentRecord(
  supabase: SupabaseClient,
  account: RegressionAccount,
  tenantId: string,
  createdBy: string,
) {
  if (!account.createStudentRecord) {
    return { id: null, status: "skipped" as const };
  }

  const existingStudent = await supabase
    .from("students")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("email", account.email)
    .maybeSingle<{ id: string; status: string }>();

  if (existingStudent.error) {
    throw existingStudent.error;
  }

  const studentPayload = {
    created_by: createdBy,
    email: account.email,
    full_name: account.fullName,
    notes: "Local regression student created by the approved development utility.",
    phone: account.phone,
    source: "regression_test",
    status: "active",
    tenant_id: tenantId,
  };

  if (existingStudent.data) {
    const { error } = await supabase
      .from("students")
      .update(studentPayload)
      .eq("id", existingStudent.data.id);

    if (error) {
      throw error;
    }

    return { id: existingStudent.data.id, status: "updated" as const };
  }

  const { data, error } = await supabase
    .from("students")
    .insert(studentPayload)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return { id: data.id, status: "created" as const };
}

async function upsertStudentPortalAccount(params: {
  account: RegressionAccount;
  linkedBy: string;
  studentId: string | null;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  if (!params.studentId || !params.account.createStudentRecord) {
    return "skipped" as const;
  }

  const existingLink = await params.supabase
    .from("student_portal_accounts")
    .select("id,status")
    .eq("tenant_id", params.tenantId)
    .eq("student_id", params.studentId)
    .maybeSingle<{ id: string; status: string }>();

  if (existingLink.error) {
    throw existingLink.error;
  }

  const payload = {
    email: params.account.email,
    linked_by: params.linkedBy,
    metadata_json: { regression_test: true },
    status: "active",
    student_id: params.studentId,
    tenant_id: params.tenantId,
    user_id: params.userId,
  };

  if (existingLink.data) {
    const { error } = await params.supabase
      .from("student_portal_accounts")
      .update(payload)
      .eq("id", existingLink.data.id);

    if (error) {
      throw error;
    }

    return existingLink.data.status === "active"
      ? ("reused" as const)
      : ("updated" as const);
  }

  const { error } = await params.supabase
    .from("student_portal_accounts")
    .insert(payload);

  if (error) {
    throw error;
  }

  return "created" as const;
}

function printSummary(tenant: TenantRecord, results: SetupResult[]) {
  console.log("");
  console.log("Local CoachFort regression account setup complete.");
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Slug: ${tenant.slug}`);
  console.log(`Tenant ID: ${maskUuid(tenant.id)}`);
  console.log("");
  console.log("Accounts:");

  for (const result of results) {
    console.log(
      `- ${maskEmail(result.email)} | role=${result.role} | auth=${result.authStatus} | profile=${result.profileStatus} | membership=${result.membershipStatus} | student=${result.studentStatus} | portal_link=${result.portalLinkStatus}`,
    );
  }

  console.log("");
  console.log("No credential or service-role value was printed.");
}

async function main() {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");

  assertLocalProvisioningAllowed(supabaseUrl);

  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const accounts = loadRequiredAccounts();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const ownerAccount = accounts.find((account) => account.role === "owner");

  if (!ownerAccount) {
    throw new Error("A local owner regression account is required.");
  }

  const ownerAuth = await createAuthUser(supabase, ownerAccount);
  const tenant = await getOrCreateLocalTenant(supabase, ownerAuth.user.id);
  const results: SetupResult[] = [];

  for (const account of accounts) {
    const auth =
      account.role === "owner"
        ? ownerAuth
        : await createAuthUser(supabase, account);
    const profileStatus = await upsertProfile(
      supabase,
      account,
      auth.user.id,
    );
    const membershipStatus = await upsertTenantMember(
      supabase,
      tenant.id,
      auth.user.id,
      account.role,
    );
    const studentResult = await upsertStudentRecord(
      supabase,
      account,
      tenant.id,
      ownerAuth.user.id,
    );
    const portalLinkStatus = await upsertStudentPortalAccount({
      account,
      linkedBy: ownerAuth.user.id,
      studentId: studentResult.id,
      supabase,
      tenantId: tenant.id,
      userId: auth.user.id,
    });

    results.push({
      authStatus: auth.status,
      email: account.email,
      membershipStatus,
      portalLinkStatus,
      profileStatus,
      role: account.role,
      studentStatus: studentResult.status,
    });
  }

  printSummary(tenant, results);
}

main().catch((error: unknown) => {
  console.error("Local regression account setup failed.");
  console.error(sanitizeDiagnosticMessage(error));
  process.exitCode = 1;
});
