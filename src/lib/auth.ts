import { getCurrentTenant } from "@/src/lib/tenant";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export async function signInWithPassword(email: string, password: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  return getCurrentTenant();
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
