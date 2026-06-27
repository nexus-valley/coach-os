import { getSupabaseClient } from "@/src/lib/supabaseClient";

export type DocumentType =
  | "cohort"
  | "compliance"
  | "course"
  | "general"
  | "internal"
  | "session"
  | "student";

export type DocumentUploadStatus =
  | "archived"
  | "metadata_only"
  | "pending_upload"
  | "uploaded";

export type DocumentVisibilityScope =
  | "linked_cohort"
  | "linked_course"
  | "linked_session"
  | "linked_student"
  | "linked_team"
  | "owner_admin"
  | "role_shared";

export type DocumentStatus = "active" | "archived";

export type DocumentRecord = {
  archived_at: string | null;
  category: string | null;
  created_at: string;
  description: string | null;
  document_type: DocumentType;
  external_url: string | null;
  file_mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  id: string;
  linked_cohort_id: string | null;
  linked_course_id: string | null;
  linked_session_id: string | null;
  linked_student_id: string | null;
  linked_team_user_id: string | null;
  staff_visible: boolean;
  status: DocumentStatus;
  student_visible: boolean;
  tenant_id: string;
  title: string;
  trainer_visible: boolean;
  updated_at: string;
  upload_status: DocumentUploadStatus;
  visibility_scope: DocumentVisibilityScope;
};

export type DocumentActivityLog = {
  action: string;
  actor_student_id: string | null;
  actor_user_id: string | null;
  created_at: string;
  id: string;
  metadata_json: Record<string, unknown>;
};

export type DocumentCenterSummary = {
  active_documents: number;
  archived_documents: number;
  cohort_documents: number;
  compliance_documents: number;
  course_documents: number;
  internal_documents: number;
  metadata_only_documents: number;
  session_documents: number;
  student_documents: number;
  student_visible_documents: number;
  total_documents: number;
};

export type DocumentCenterDashboard = {
  documents: DocumentRecord[];
  role: string | null;
  summary: DocumentCenterSummary;
};

export type DocumentDetail = {
  activity: DocumentActivityLog[];
  document: DocumentRecord;
};

export type DocumentInput = {
  category?: string | null;
  description?: string | null;
  documentType: DocumentType;
  externalUrl?: string | null;
  fileMimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  linkedCohortId?: string | null;
  linkedCourseId?: string | null;
  linkedSessionId?: string | null;
  linkedStudentId?: string | null;
  linkedTeamUserId?: string | null;
  metadataJson?: Record<string, unknown>;
  staffVisible?: boolean;
  status?: DocumentStatus;
  storageBucket?: string | null;
  storagePath?: string | null;
  studentVisible?: boolean;
  tenantId?: string;
  title: string;
  trainerVisible?: boolean;
  uploadStatus?: DocumentUploadStatus;
  visibilityScope: DocumentVisibilityScope;
};

export const documentTypes: DocumentType[] = [
  "student",
  "course",
  "cohort",
  "session",
  "internal",
  "compliance",
  "general",
];

export const documentUploadStatuses: DocumentUploadStatus[] = [
  "metadata_only",
  "pending_upload",
  "uploaded",
  "archived",
];

export const documentVisibilityScopes: DocumentVisibilityScope[] = [
  "owner_admin",
  "linked_student",
  "linked_course",
  "linked_cohort",
  "linked_session",
  "linked_team",
  "role_shared",
];

const emptySummary: DocumentCenterSummary = {
  active_documents: 0,
  archived_documents: 0,
  cohort_documents: 0,
  compliance_documents: 0,
  course_documents: 0,
  internal_documents: 0,
  metadata_only_documents: 0,
  session_documents: 0,
  student_documents: 0,
  student_visible_documents: 0,
  total_documents: 0,
};

function normalizeDashboard(data: unknown): DocumentCenterDashboard {
  const payload = (data ?? {}) as Partial<DocumentCenterDashboard>;

  return {
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    role: payload.role ?? null,
    summary: {
      ...emptySummary,
      ...(payload.summary ?? {}),
    },
  };
}

function normalizeDetail(data: unknown): DocumentDetail {
  const payload = data as Partial<DocumentDetail> | null;

  if (!payload?.document) {
    throw new Error("Document detail was not returned.");
  }

  return {
    activity: Array.isArray(payload.activity) ? payload.activity : [],
    document: payload.document,
  };
}

function normalizeStudentDocuments(data: unknown) {
  const payload = (data ?? {}) as { documents?: DocumentRecord[] };
  return Array.isArray(payload.documents) ? payload.documents : [];
}

export function formatDocumentLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDocumentDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDocumentFileSize(value: number | null | undefined) {
  if (!value) return "Not set";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function rpcPayload(input: DocumentInput) {
  return {
    p_category: input.category || null,
    p_description: input.description || null,
    p_document_type: input.documentType,
    p_external_url: input.externalUrl || null,
    p_file_mime_type: input.fileMimeType || null,
    p_file_name: input.fileName || null,
    p_file_size_bytes: input.fileSizeBytes ?? null,
    p_linked_cohort_id: input.linkedCohortId || null,
    p_linked_course_id: input.linkedCourseId || null,
    p_linked_session_id: input.linkedSessionId || null,
    p_linked_student_id: input.linkedStudentId || null,
    p_linked_team_user_id: input.linkedTeamUserId || null,
    p_metadata_json: input.metadataJson ?? {},
    p_staff_visible: input.staffVisible ?? false,
    p_storage_bucket: input.storageBucket || null,
    p_storage_path: input.storagePath || null,
    p_student_visible: input.studentVisible ?? false,
    p_title: input.title,
    p_trainer_visible: input.trainerVisible ?? false,
    p_upload_status: input.uploadStatus ?? "metadata_only",
    p_visibility_scope: input.visibilityScope,
  };
}

export async function getDocumentCenterDashboard(tenantId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_document_center_dashboard", {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  return normalizeDashboard(data);
}

export async function getDocumentDetail(documentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_document_detail", {
    p_document_id: documentId,
  });

  if (error) throw error;
  return normalizeDetail(data);
}

export async function createDocumentRecord(input: DocumentInput & { tenantId: string }) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_document_record", {
    p_tenant_id: input.tenantId,
    ...rpcPayload(input),
  });

  if (error) throw error;
  return data as string;
}

export async function updateDocumentRecord(
  documentId: string,
  input: DocumentInput,
) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("update_document_record", {
    p_document_id: documentId,
    p_status: input.status ?? "active",
    ...rpcPayload(input),
  });

  if (error) throw error;
  return data as string;
}

export async function archiveDocumentRecord(documentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("archive_document_record", {
    p_document_id: documentId,
  });

  if (error) throw error;
  return data as string;
}

export async function getStudentDocuments() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_documents");

  if (error) throw error;
  return normalizeStudentDocuments(data);
}

export async function getStudentDocumentDetail(documentId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_student_document_detail", {
    p_document_id: documentId,
  });

  if (error) throw error;
  return normalizeDetail({ document: (data as { document?: DocumentRecord })?.document });
}

export async function recordDocumentView(documentId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("record_document_view", {
    p_document_id: documentId,
  });

  if (error) throw error;
}
