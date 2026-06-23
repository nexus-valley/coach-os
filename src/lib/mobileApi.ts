import { getSupabaseClient } from "@/src/lib/supabaseClient";
import type {
  MobileBootstrap,
  MobileNotificationsResponse,
  MobileOfflineManifest,
  MobileStudentHome,
  MobileTeamHome,
  MobileTrainerHome,
} from "@/src/lib/mobileTypes";

async function callMobileRpc<T>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(name, params);

  if (error) {
    throw error;
  }

  return data as T;
}

export function getMobileBootstrap() {
  return callMobileRpc<MobileBootstrap>("get_mobile_bootstrap");
}

export function getMobileStudentHome() {
  return callMobileRpc<MobileStudentHome>("get_mobile_student_home");
}

export function getMobileTrainerHome() {
  return callMobileRpc<MobileTrainerHome>("get_mobile_trainer_home");
}

export function getMobileTeamHome() {
  return callMobileRpc<MobileTeamHome>("get_mobile_team_home");
}

export function getMobileNotifications(limit = 25, offset = 0) {
  return callMobileRpc<MobileNotificationsResponse>("get_mobile_notifications", {
    p_limit: limit,
    p_offset: offset,
  });
}

export function getMobileOfflineManifest() {
  return callMobileRpc<MobileOfflineManifest>("get_mobile_offline_manifest");
}
