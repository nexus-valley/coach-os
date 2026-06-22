import { getCurrentTenant } from "@/src/lib/tenant";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentStudentPortalContext } from "@/src/lib/studentPortalAuth";

export async function signInWithPassword(email: string, password: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const [tenant, studentPortalContext] = await Promise.all([
    getCurrentTenant().catch(() => null),
    getCurrentStudentPortalContext().catch(() => null),
  ]);

  return {
    studentPortalAccount: studentPortalContext?.account ?? null,
    tenant,
  };
}

export async function signUpWithPassword(params: {
  email: string;
  fullName: string;
  password: string;
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
      },
    },
  });

  if (error) {
    throw error;
  }

  if (data.user) {
    await supabase.from("profiles").upsert({
      email: params.email,
      full_name: params.fullName,
      id: data.user.id,
    });
  }

  return data.user;
}

function getSafeInternalRedirectPath(path?: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/app";
  }

  return path;
}

export async function signInWithGoogle(redirectPath = "/app") {
  if (typeof window === "undefined") {
    throw new Error("Google login is only available in the browser.");
  }

  const supabase = getSupabaseClient();
  const safeRedirectPath = getSafeInternalRedirectPath(redirectPath);
  const redirectTo = `${window.location.origin}${safeRedirectPath}`;

  // Google consent screen app name/domain is configured in Google Cloud OAuth
  // consent screen and Supabase Auth settings.
  // Demo OAuth redirect uses window.location.origin so production custom
  // domains do not fall back to a Vercel preview URL.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signInWithGoogleForDemo() {
  if (typeof window === "undefined") {
    throw new Error("Google login is only available in the browser.");
  }

  // Demo OAuth redirect uses window.location.origin so production custom
  // domains do not fall back to a Vercel preview URL.
  const redirectTo = `${window.location.origin}/app?demo=1`;
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw error;
  }
}

export async function requireClientSession() {
  const supabase = getSupabaseClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return session;
}
