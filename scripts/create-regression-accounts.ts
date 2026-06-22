import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type RegressionRole = "owner" | "admin" | "staff" | "trainer" | "student";

type RegressionAccount = {
  email: string;
  fullName: string;
  phone: string;
  role: RegressionRole;
  department?: string;
  createStudentRecord?: boolean;
};

type SetupResult = {
  email: string;
  role: RegressionRole;
  authStatus: "created" | "reused";
  profileStatus: "upserted" | "skipped";
  membershipStatus: "created" | "updated" | "reused" | "skipped";
  portalLinkStatus: "created" | "updated" | "reused" | "skipped";
  studentStatus: "created" | "updated" | "reused" | "skipped";
};

type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string | null;
};

const TENANT_NAME = "CoachFort Regression Academy";
const TENANT_SLUG = "coachfort-regression";
const DEFAULT_PASSWORD = "CoachFort@Test#2026";

const requiredAccounts: RegressionAccount[] = [
  {
    email: "owner.regression@coachfort.demo",
    fullName: "Regression Owner",
    phone: "+910000000001",
    role: "owner",
  },
  {
    email: "admin.regression@coachfort.demo",
    fullName: "Regression Admin",
    phone: "+910000000002",
    role: "admin",
  },
  {
    email: "staff.regression@coachfort.demo",
    fullName: "Regression Staff",
    phone: "+910000000003",
    role: "staff",
  },
  {
    email: "trainer.regression@coachfort.demo",
    fullName: "Regression Trainer",
    phone: "+910000000004",
    role: "trainer",
  },
  {
    email: "student.regression@coachfort.demo",
    fullName: "Regression Student",
    phone: "+910000000005",
    role: "student",
    createStudentRecord: true,
  },
];

const optionalDepartmentAccounts: RegressionAccount[] = [
  {
    email: "finance.regression@coachfort.demo",
    fullName: "Regression Finance",
    phone: "+910000000006",
    role: "staff",
    department: "finance",
  },
  {
    email: "sales.regression@coachfort.demo",
    fullName: "Regression Sales",
    phone: "+910000000007",
    role: "staff",
    department: "sales",
  },
  {
    email: "support.regression@coachfort.demo",
    fullName: "Regression Support",
    phone: "+910000000008",
    role: "staff",
    department: "support",
  },
];

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function includeOptionalAccounts() {
  const value = process.env.REGRESSION_INCLUDE_OPTIONAL_ACCOUNTS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function getErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }
  return "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

function isOptionalSchemaError(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST200" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  const normalizedEmail = email.toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const foundUser = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (foundUser) {
      return foundUser;
    }

    if (data.users.length < perPage) {
      return null;
    }
  }

  throw new Error("Unable to find Auth user by email after scanning 50 pages.");
}

async function createOrUpdateAuthUser(
  supabase: SupabaseClient,
  account: RegressionAccount,
  password: string,
) {
  const userMetadata = {
    full_name: account.fullName,
    role: account.role,
    regression_test: true,
    ...(account.department ? { department: account.department } : {}),
  };

  const existingUser = await findAuthUserByEmail(supabase, account.email);

  if (existingUser) {
    const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        ...userMetadata,
      },
    });

    if (error) {
      throw error;
    }

    return { user: data.user as User, status: "reused" as const };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error(`Supabase did not return a user for ${account.email}.`);
  }

  return { user: data.user as User, status: "created" as const };
}

async function createOrUpdateTenant(
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
    const { data, error } = await supabase
      .from("tenants")
      .update({
        name: TENANT_NAME,
        owner_user_id: ownerUserId,
      })
      .eq("id", existingTenant.data.id)
      .select("id,name,slug,owner_user_id")
      .single<TenantRecord>();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      category: "coaching",
      owner_user_id: ownerUserId,
    })
    .select("id,name,slug,owner_user_id")
    .single<TenantRecord>();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertProfile(supabase: SupabaseClient, account: RegressionAccount, userId: string) {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      full_name: account.fullName,
      email: account.email,
      avatar_url: null,
    },
    { onConflict: "id" },
  );

  if (error) {
    if (isOptionalSchemaError(error)) {
      return "skipped" as const;
    }
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
    tenant_id: tenantId,
    user_id: userId,
    role,
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
    if (isOptionalSchemaError(existingStudent.error)) {
      return { id: null, status: "skipped" as const };
    }
    throw existingStudent.error;
  }

  const studentPayload = {
    tenant_id: tenantId,
    full_name: account.fullName,
    email: account.email,
    phone: account.phone,
    status: "active",
    source: "regression_test",
    notes: "Regression test student account created by scripts/create-regression-accounts.ts.",
    created_by: createdBy,
  };

  if (existingStudent.data) {
    const { error } = await supabase
      .from("students")
      .update(studentPayload)
      .eq("id", existingStudent.data.id);

    if (error) {
      if (isOptionalSchemaError(error)) {
        return { id: null, status: "skipped" as const };
      }
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
    if (isOptionalSchemaError(error)) {
      return { id: null, status: "skipped" as const };
    }
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
    if (isOptionalSchemaError(existingLink.error)) {
      return "skipped" as const;
    }
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
      if (isOptionalSchemaError(error)) {
        return "skipped" as const;
      }
      throw error;
    }

    return existingLink.data.status === "active" ? "reused" as const : "updated" as const;
  }

  const { error } = await params.supabase.from("student_portal_accounts").insert(payload);

  if (error) {
    if (isOptionalSchemaError(error)) {
      return "skipped" as const;
    }
    throw error;
  }

  return "created" as const;
}

function printSummary(tenant: TenantRecord, results: SetupResult[]) {
  console.log("");
  console.log("CoachFort regression account setup complete.");
  console.log(`Tenant: ${tenant.name}`);
  console.log(`Slug: ${tenant.slug}`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log("");
  console.log("Accounts:");

  for (const result of results) {
    console.log(
      `- ${result.email} | role=${result.role} | auth=${result.authStatus} | profile=${result.profileStatus} | membership=${result.membershipStatus} | student=${result.studentStatus} | portal_link=${result.portalLinkStatus}`,
    );
  }

  console.log("");
  console.log("No service role key or password was printed.");
}

async function main() {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const password = process.env.REGRESSION_TEST_PASSWORD?.trim() || DEFAULT_PASSWORD;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const accounts = includeOptionalAccounts()
    ? [...requiredAccounts, ...optionalDepartmentAccounts]
    : requiredAccounts;

  const ownerAccount = accounts.find((account) => account.role === "owner");
  if (!ownerAccount) {
    throw new Error("Owner regression account is required.");
  }

  const ownerAuth = await createOrUpdateAuthUser(supabase, ownerAccount, password);
  const tenant = await createOrUpdateTenant(supabase, ownerAuth.user.id);
  const results: SetupResult[] = [];

  for (const account of accounts) {
    const auth =
      account.email === ownerAccount.email
        ? ownerAuth
        : await createOrUpdateAuthUser(supabase, account, password);

    const profileStatus = await upsertProfile(supabase, account, auth.user.id);
    const membershipStatus = await upsertTenantMember(supabase, tenant.id, auth.user.id, account.role);
    const studentResult = await upsertStudentRecord(supabase, account, tenant.id, ownerAuth.user.id);
    const portalLinkStatus = await upsertStudentPortalAccount({
      account,
      linkedBy: ownerAuth.user.id,
      studentId: studentResult.id,
      supabase,
      tenantId: tenant.id,
      userId: auth.user.id,
    });

    results.push({
      email: account.email,
      role: account.role,
      authStatus: auth.status,
      profileStatus,
      membershipStatus,
      portalLinkStatus,
      studentStatus: studentResult.status,
    });
  }

  printSummary(tenant, results);
}

main().catch((error: unknown) => {
  console.error("Regression account setup failed.");
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
