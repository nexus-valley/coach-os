"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import { PageHeader } from "@/src/components/ui/PageHeader";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { StatCard } from "@/src/components/ui/StatCard";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import { getCohortsForTenant } from "@/src/lib/cohorts";
import type { Course } from "@/src/lib/courses";
import { getCoursesForTenant } from "@/src/lib/courses";
import {
  archiveDocumentRecord,
  createDocumentRecord,
  documentTypes,
  documentUploadStatuses,
  formatDocumentDate,
  formatDocumentFileSize,
  formatDocumentLabel,
  getDocumentCenterDashboard,
  getDocumentDetail,
  updateDocumentRecord,
  type DocumentCenterDashboard,
  type DocumentDetail,
  type DocumentInput,
  type DocumentRecord,
  type DocumentStatus,
  type DocumentType,
  type DocumentUploadStatus,
  type DocumentVisibilityScope,
} from "@/src/lib/documentCenter";
import {
  getDocumentDownloadUrl,
  removeDocumentFile,
  uploadDocumentFile,
} from "@/src/lib/documentStorage";
import {
  featureListToMap,
  getTenantFeatureAccess,
  isFeatureEnabled,
  type FeatureAccessMap,
} from "@/src/lib/featureAccess";
import { canAccessDocuments } from "@/src/lib/permissions";
import type { TrainingSessionWithRelations } from "@/src/lib/sessions";
import { getSessionsForTenant } from "@/src/lib/sessions";
import type { Student } from "@/src/lib/students";
import { getStudentsForTenant } from "@/src/lib/students";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getTenantMembers, type TenantMemberWithProfile } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";

type ReferenceData = {
  cohorts: CohortWithCourse[];
  courses: Course[];
  sessions: TrainingSessionWithRelations[];
  students: Student[];
  teamMembers: TenantMemberWithProfile[];
};

type FormState = {
  category: string;
  description: string;
  documentType: DocumentType;
  externalUrl: string;
  fileMimeType: string;
  fileName: string;
  fileSizeBytes: string;
  linkedCohortId: string;
  linkedCourseId: string;
  linkedSessionId: string;
  linkedStudentId: string;
  linkedTeamUserId: string;
  staffVisible: boolean;
  status: DocumentStatus;
  studentVisible: boolean;
  title: string;
  trainerVisible: boolean;
  uploadStatus: DocumentUploadStatus;
  visibilityScope: DocumentVisibilityScope;
};

const defaultForm: FormState = {
  category: "",
  description: "",
  documentType: "student",
  externalUrl: "",
  fileMimeType: "",
  fileName: "",
  fileSizeBytes: "",
  linkedCohortId: "",
  linkedCourseId: "",
  linkedSessionId: "",
  linkedStudentId: "",
  linkedTeamUserId: "",
  staffVisible: false,
  status: "active",
  studentVisible: false,
  title: "",
  trainerVisible: false,
  uploadStatus: "metadata_only",
  visibilityScope: "linked_student",
};

const visibilityByType: Record<DocumentType, DocumentVisibilityScope[]> = {
  cohort: ["owner_admin", "linked_cohort"],
  compliance: ["owner_admin"],
  course: ["owner_admin", "linked_course"],
  general: ["owner_admin", "role_shared", "linked_team"],
  internal: ["owner_admin", "role_shared", "linked_team"],
  session: ["owner_admin", "linked_session"],
  student: ["owner_admin", "linked_student"],
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toForm(document: DocumentRecord): FormState {
  return {
    category: document.category ?? "",
    description: document.description ?? "",
    documentType: document.document_type,
    externalUrl: document.external_url ?? "",
    fileMimeType: document.file_mime_type ?? "",
    fileName: document.file_name ?? "",
    fileSizeBytes: document.file_size_bytes?.toString() ?? "",
    linkedCohortId: document.linked_cohort_id ?? "",
    linkedCourseId: document.linked_course_id ?? "",
    linkedSessionId: document.linked_session_id ?? "",
    linkedStudentId: document.linked_student_id ?? "",
    linkedTeamUserId: document.linked_team_user_id ?? "",
    staffVisible: document.staff_visible,
    status: document.status,
    studentVisible: document.student_visible,
    title: document.title,
    trainerVisible: document.trainer_visible,
    uploadStatus: document.upload_status,
    visibilityScope: document.visibility_scope,
  };
}

function formToInput(form: FormState): DocumentInput {
  return {
    category: form.category,
    description: form.description,
    documentType: form.documentType,
    externalUrl: form.externalUrl,
    fileMimeType: form.fileMimeType,
    fileName: form.fileName,
    fileSizeBytes: form.fileSizeBytes ? Number(form.fileSizeBytes) : null,
    linkedCohortId: form.linkedCohortId,
    linkedCourseId: form.linkedCourseId,
    linkedSessionId: form.linkedSessionId,
    linkedStudentId: form.linkedStudentId,
    linkedTeamUserId: form.linkedTeamUserId,
    staffVisible: form.staffVisible,
    status: form.status,
    studentVisible: form.studentVisible,
    title: form.title,
    trainerVisible: form.trainerVisible,
    uploadStatus: form.uploadStatus,
    visibilityScope: form.visibilityScope,
  };
}

function linkedSummary(document: DocumentRecord, references: ReferenceData) {
  if (document.linked_student_id) {
    return (
      references.students.find((item) => item.id === document.linked_student_id)
        ?.full_name ?? "Linked student"
    );
  }

  if (document.linked_course_id) {
    return (
      references.courses.find((item) => item.id === document.linked_course_id)
        ?.title ?? "Linked course"
    );
  }

  if (document.linked_cohort_id) {
    return (
      references.cohorts.find((item) => item.id === document.linked_cohort_id)
        ?.name ?? "Linked cohort"
    );
  }

  if (document.linked_session_id) {
    return (
      references.sessions.find((item) => item.id === document.linked_session_id)
        ?.title ?? "Linked session"
    );
  }

  if (document.linked_team_user_id) {
    const member = references.teamMembers.find(
      (item) => item.user_id === document.linked_team_user_id,
    );
    return member?.profile?.full_name ?? member?.profile?.email ?? "Linked team member";
  }

  return "No linked entity";
}

function statusTone(status: string): "danger" | "light" | "success" | "warning" {
  if (status === "active" || status === "uploaded") return "success";
  if (status === "archived") return "danger";
  if (status === "pending_upload") return "warning";
  return "light";
}

export function DocumentCenterPage() {
  const [actionError, setActionError] = useState("");
  const [dashboard, setDashboard] = useState<DocumentCenterDashboard | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [featureAccess, setFeatureAccess] = useState<FeatureAccessMap | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [references, setReferences] = useState<ReferenceData>({
    cohorts: [],
    courses: [],
    sessions: [],
    students: [],
    teamMembers: [],
  });
  const [role, setRole] = useState<MemberRole | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");
  const [success, setSuccess] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | DocumentType>("all");
  const [uploading, setUploading] = useState(false);

  const canManage = canAccessDocuments(role);
  const documentUploadsEnabled = isFeatureEnabled(
    featureAccess,
    "document_uploads",
  );

  async function loadData(nextSelectedId?: string | null) {
    setLoading(true);
    setActionError("");

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be logged in to view documents.");

      const tenant = await getCurrentTenant();
      if (!tenant) throw new Error("No tenant workspace is selected.");

      const currentRole = await getCurrentMemberRole(tenant.id, user.id);
      setRole(currentRole);
      setTenantId(tenant.id);

      if (!canAccessDocuments(currentRole)) {
        setDashboard(null);
        setDetail(null);
        return;
      }

      const [
        documentData,
        tenantStudents,
        tenantCourses,
        tenantCohorts,
        tenantSessions,
        tenantMembers,
        tenantFeatures,
      ] = await Promise.all([
        getDocumentCenterDashboard(tenant.id),
        getStudentsForTenant(tenant.id),
        getCoursesForTenant(tenant.id),
        getCohortsForTenant(tenant.id),
        getSessionsForTenant(tenant.id),
        getTenantMembers(tenant.id),
        getTenantFeatureAccess(tenant.id).catch(() => null),
      ]);

      setDashboard(documentData);
      setFeatureAccess(
        tenantFeatures ? featureListToMap(tenantFeatures.features) : null,
      );
      setReferences({
        cohorts: tenantCohorts,
        courses: tenantCourses,
        sessions: tenantSessions,
        students: tenantStudents,
        teamMembers: tenantMembers,
      });

      const candidateId =
        nextSelectedId ??
        selectedId ??
        documentData.documents.find((document) => document.status === "active")?.id ??
        documentData.documents[0]?.id ??
        null;

      setSelectedId(candidateId);

      if (candidateId) {
        const nextDetail = await getDocumentDetail(candidateId);
        setDetail(nextDetail);
      } else {
        setDetail(null);
      }
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load document center."));
      setDashboard(null);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return (dashboard?.documents ?? []).filter((document) => {
      const linked = linkedSummary(document, references).toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        document.title.toLowerCase().includes(normalizedSearch) ||
        (document.category ?? "").toLowerCase().includes(normalizedSearch) ||
        (document.file_name ?? "").toLowerCase().includes(normalizedSearch) ||
        linked.includes(normalizedSearch);
      const matchesType = typeFilter === "all" || document.document_type === typeFilter;
      const matchesStatus =
        statusFilter === "all" || document.status === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [dashboard?.documents, references, search, statusFilter, typeFilter]);

  function resetForm(documentType: DocumentType = "student") {
    setEditingId(null);
    setForm({
      ...defaultForm,
      documentType,
      visibilityScope:
        documentType === "student" ? "linked_student" : "owner_admin",
    });
  }

  function handleTypeChange(documentType: DocumentType) {
    const scopes = visibilityByType[documentType];
    setForm((current) => ({
      ...current,
      documentType,
      linkedCohortId: documentType === "cohort" ? current.linkedCohortId : "",
      linkedCourseId: documentType === "course" ? current.linkedCourseId : "",
      linkedSessionId: documentType === "session" ? current.linkedSessionId : "",
      linkedStudentId: documentType === "student" ? current.linkedStudentId : "",
      staffVisible:
        documentType === "internal" || documentType === "general"
          ? current.staffVisible
          : false,
      studentVisible:
        documentType === "internal" || documentType === "compliance"
          ? false
          : current.studentVisible,
      trainerVisible:
        documentType === "compliance" ? false : current.trainerVisible,
      visibilityScope: scopes.includes(current.visibilityScope)
        ? current.visibilityScope
        : scopes[0],
    }));
  }

  async function handleSelectDocument(documentId: string) {
    setSelectedId(documentId);
    setActionError("");

    try {
      const nextDetail = await getDocumentDetail(documentId);
      setDetail(nextDetail);
      setEditingId(null);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to load document detail."));
    }
  }

  function handleEdit(document: DocumentRecord) {
    setEditingId(document.id);
    setForm(toForm(document));
    setActionError("");
    setSuccess("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    setSuccess("");

    if (!tenantId) {
      setActionError("No tenant workspace is selected.");
      return;
    }

    try {
      const input = formToInput(form);
      const nextId = editingId
        ? await updateDocumentRecord(editingId, input)
        : await createDocumentRecord({ ...input, tenantId });

      setSuccess(editingId ? "Document metadata updated." : "Document record created.");
      setSelectedFile(null);
      resetForm(form.documentType);
      await loadData(nextId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to save document."));
    }
  }

  async function handleArchive(documentId: string) {
    setActionError("");
    setSuccess("");

    try {
      await archiveDocumentRecord(documentId);
      setSuccess("Document archived.");
      await loadData(documentId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to archive document."));
    }
  }

  async function handleUploadFile() {
    if (!detail?.document || !selectedFile) {
      setActionError("Choose a file to upload.");
      return;
    }

    setActionError("");
    setSuccess("");
    setUploading(true);

    try {
      await uploadDocumentFile(detail.document.id, selectedFile);
      setSelectedFile(null);
      setSuccess("Document file uploaded.");
      await loadData(detail.document.id);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to upload document file."));
    } finally {
      setUploading(false);
    }
  }

  async function handleOpenFile(documentId: string) {
    setActionError("");

    try {
      const result = await getDocumentDownloadUrl(documentId);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to open document file."));
    }
  }

  async function handleRemoveFile(documentId: string) {
    setActionError("");
    setSuccess("");
    setUploading(true);

    try {
      await removeDocumentFile(documentId);
      setSuccess("Document file removed.");
      await loadData(documentId);
    } catch (caught) {
      setActionError(getErrorMessage(caught, "Unable to remove document file."));
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card className="h-28 bg-white p-5" key={item}>
              <span className="sr-only">Loading document summary</span>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-5 h-8 w-16" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <Card className="p-8">
        <PageHeader
          eyebrow="Restricted"
          title="Documents"
          description="The Document Center is restricted to owners and admins in this foundation module. Student-facing documents are available through the student portal only when explicitly marked visible."
        />
      </Card>
    );
  }

  const summary = dashboard?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button onClick={() => resetForm()} type="button">
            New document
          </Button>
        }
        description="Manage document metadata, private files, linked entities, and role-based visibility. Uploaded files are stored in private storage and opened through short-lived signed URLs after authorization."
        eyebrow="Metadata-only foundation"
        title="Document Center"
      />

      {actionError ? <FeedbackAlert tone="error">{actionError}</FeedbackAlert> : null}
      {success ? <FeedbackAlert tone="success">{success}</FeedbackAlert> : null}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Total", summary?.total_documents ?? 0],
          ["Student docs", summary?.student_documents ?? 0],
          ["Course docs", summary?.course_documents ?? 0],
          ["Visible to students", summary?.student_visible_documents ?? 0],
          ["Internal", summary?.internal_documents ?? 0],
          ["Compliance", summary?.compliance_documents ?? 0],
          ["Metadata-only", summary?.metadata_only_documents ?? 0],
          ["Archived", summary?.archived_documents ?? 0],
        ].map(([label, value]) => (
          <StatCard key={label} label={label} value={value} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(460px,0.95fr)]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-semibold">
                Search
                <input
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title, category, file, linked entity"
                  value={search}
                />
              </label>
              <label className="text-sm font-semibold">
                Type
                <select
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                  onChange={(event) =>
                    setTypeFilter(event.target.value as "all" | DocumentType)
                  }
                  value={typeFilter}
                >
                  <option value="all">All types</option>
                  {documentTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatDocumentLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Status
                <select
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm outline-none focus:border-[#2ECBEA]"
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "all" | DocumentStatus)
                  }
                  value={statusFilter}
                >
                  <option value="all">All status</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
          </Card>

          {filteredDocuments.length === 0 ? (
            <EmptyState
              description="Create metadata records for student, course, cohort, session, internal, and compliance documents."
              icon="DOC"
              title="No documents found"
            />
          ) : (
            <div className="space-y-3">
              {filteredDocuments.map((document) => (
                <button
                  className={[
                    "w-full rounded-3xl border bg-white p-5 text-left shadow-sm transition hover:border-[#2ECBEA]",
                    selectedId === document.id
                      ? "border-[#2ECBEA] ring-2 ring-[#2ECBEA]/20"
                      : "border-[#D8E8F0]",
                  ].join(" ")}
                  key={document.id}
                  onClick={() => void handleSelectDocument(document.id)}
                  type="button"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">
                        {document.title}
                      </p>
                      <p className="mt-1 text-sm text-[#5D7185]">
                        {linkedSummary(document, references)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Badge tone="light">{formatDocumentLabel(document.document_type)}</Badge>
                      <Badge tone={statusTone(document.status)}>
                        {formatDocumentLabel(document.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#66788F]">
                    <span>{document.category ?? "No category"}</span>
                    <span>{document.file_name ?? "No file name"}</span>
                    <span>Updated {formatDocumentDate(document.updated_at)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {document.student_visible ? (
                      <Badge tone="success">Student visible</Badge>
                    ) : null}
                    {document.trainer_visible ? (
                      <Badge tone="trainer">Trainer visible</Badge>
                    ) : null}
                    {document.staff_visible ? (
                      <Badge tone="staff">Staff visible</Badge>
                    ) : null}
                    <Badge tone={statusTone(document.upload_status)}>
                      {formatDocumentLabel(document.upload_status)}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-xl font-semibold">
              {editingId ? "Edit document" : "Create document"}
            </h2>
            <p className="mt-1 text-sm text-[#5D7185]">
              Store document metadata and references only. Do not paste private
              file contents into notes or metadata.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">
                  Type
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) => handleTypeChange(event.target.value as DocumentType)}
                    value={form.documentType}
                  >
                    {documentTypes.map((type) => (
                      <option key={type} value={type}>
                        {formatDocumentLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Visibility scope
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        visibilityScope: event.target.value as DocumentVisibilityScope,
                      }))
                    }
                    value={form.visibilityScope}
                  >
                    {visibilityByType[form.documentType].map((scope) => (
                      <option key={scope} value={scope}>
                        {formatDocumentLabel(scope)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-semibold">
                Title
                <input
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  maxLength={180}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  required
                  value={form.title}
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">
                  Category
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={80}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    value={form.category}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Upload status
                  <select
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        uploadStatus: event.target.value as DocumentUploadStatus,
                      }))
                    }
                    value={form.uploadStatus}
                  >
                    {documentUploadStatuses.map((status) => (
                      <option key={status} value={status}>
                        {formatDocumentLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-semibold">
                Description
                <textarea
                  className="mt-2 min-h-24 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  maxLength={1000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  value={form.description}
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                {form.documentType === "student" ? (
                  <label className="text-sm font-semibold">
                    Linked student
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          linkedStudentId: event.target.value,
                        }))
                      }
                      required
                      value={form.linkedStudentId}
                    >
                      <option value="">Select student</option>
                      {references.students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.documentType === "course" ? (
                  <label className="text-sm font-semibold">
                    Linked course
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          linkedCourseId: event.target.value,
                        }))
                      }
                      required
                      value={form.linkedCourseId}
                    >
                      <option value="">Select course</option>
                      {references.courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.documentType === "cohort" ? (
                  <label className="text-sm font-semibold">
                    Linked cohort
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          linkedCohortId: event.target.value,
                        }))
                      }
                      required
                      value={form.linkedCohortId}
                    >
                      <option value="">Select cohort</option>
                      {references.cohorts.map((cohort) => (
                        <option key={cohort.id} value={cohort.id}>
                          {cohort.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.documentType === "session" ? (
                  <label className="text-sm font-semibold">
                    Linked session
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          linkedSessionId: event.target.value,
                        }))
                      }
                      required
                      value={form.linkedSessionId}
                    >
                      <option value="">Select session</option>
                      {references.sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.visibilityScope === "linked_team" ? (
                  <label className="text-sm font-semibold">
                    Linked team member
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          linkedTeamUserId: event.target.value,
                        }))
                      }
                      value={form.linkedTeamUserId}
                    >
                      <option value="">Select team member</option>
                      {references.teamMembers.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.profile?.full_name ?? member.profile?.email ?? member.role}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm font-semibold">
                  File name
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={240}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fileName: event.target.value,
                      }))
                    }
                    value={form.fileName}
                  />
                </label>
                <label className="text-sm font-semibold">
                  MIME type
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    maxLength={120}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fileMimeType: event.target.value,
                      }))
                    }
                    value={form.fileMimeType}
                  />
                </label>
                <label className="text-sm font-semibold">
                  File size bytes
                  <input
                    className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                    min="0"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fileSizeBytes: event.target.value,
                      }))
                    }
                    type="number"
                    value={form.fileSizeBytes}
                  />
                </label>
              </div>

              <label className="block text-sm font-semibold">
                External reference URL
                <input
                  className="mt-2 w-full rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm"
                  maxLength={1000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      externalUrl: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                  value={form.externalUrl}
                />
              </label>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm font-semibold">
                  <input
                    checked={form.studentVisible}
                    disabled={form.documentType === "internal" || form.documentType === "compliance"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        studentVisible: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Student visible
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm font-semibold">
                  <input
                    checked={form.trainerVisible}
                    disabled={form.documentType === "compliance"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        trainerVisible: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Trainer visible
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-[#D8E8F0] px-4 py-3 text-sm font-semibold">
                  <input
                    checked={form.staffVisible}
                    disabled={form.documentType === "compliance"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        staffVisible: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Staff visible
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="submit">
                  {editingId ? "Update document" : "Create document"}
                </Button>
                {editingId ? (
                  <Button onClick={() => resetForm()} type="button" variant="secondary">
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          {detail ? (
            <Card className="p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <h2 className="text-xl font-semibold">{detail.document.title}</h2>
                  <p className="mt-1 text-sm text-[#5D7185]">
                    {linkedSummary(detail.document, references)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => handleEdit(detail.document)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                  {detail.document.status !== "archived" ? (
                    <Button
                      onClick={() => void handleArchive(detail.document.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {[
                  ["Type", formatDocumentLabel(detail.document.document_type)],
                  ["Category", detail.document.category ?? "Not set"],
                  ["File", detail.document.file_name ?? "Not set"],
                  ["File size", formatDocumentFileSize(detail.document.file_size_bytes)],
                  ["Upload", formatDocumentLabel(detail.document.upload_status)],
                  ["Updated", formatDocumentDate(detail.document.updated_at)],
                ].map(([label, value]) => (
                  <div className="rounded-2xl bg-[#F3FAFD] p-4" key={label}>
                    <p className="text-xs font-semibold uppercase text-[#66788F]">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              {detail.document.external_url ? (
                <div className="mt-4 rounded-2xl border border-[#D8E8F0] p-4">
                  <p className="text-xs font-semibold uppercase text-[#66788F]">
                    Reference
                  </p>
                  <Button
                    className="mt-3"
                    href={detail.document.external_url}
                    size="sm"
                    variant="secondary"
                  >
                    Open reference
                  </Button>
                </div>
              ) : null}

              <div className="mt-4 rounded-2xl border border-[#D8E8F0] p-4">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#66788F]">
                      Private file
                    </p>
                    <p className="mt-2 text-sm text-[#425B76]">
                      Files are stored privately and opened only through
                      short-lived signed URLs. Raw storage paths are not shown.
                    </p>
                  </div>
                  {detail.document.upload_status === "uploaded" ? (
                    <Badge tone="success">Uploaded</Badge>
                  ) : (
                    <Badge tone="light">No file</Badge>
                  )}
                </div>

                {detail.document.upload_status === "uploaded" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      disabled={uploading}
                      onClick={() => void handleOpenFile(detail.document.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Open file
                    </Button>
                  </div>
                ) : null}

                {documentUploadsEnabled ? (
                  <div className="mt-4 space-y-4">
                    <label className="block text-sm font-semibold">
                      Upload or replace file
                      <input
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,application/pdf,image/png,image/jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="mt-2 block w-full rounded-2xl border border-[#D8E8F0] bg-white px-4 py-3 text-sm"
                        disabled={uploading || detail.document.status !== "active"}
                        onChange={(event) =>
                          setSelectedFile(event.target.files?.[0] ?? null)
                        }
                        type="file"
                      />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        disabled={
                          !selectedFile ||
                          uploading ||
                          detail.document.status !== "active"
                        }
                        onClick={() => void handleUploadFile()}
                        size="sm"
                        type="button"
                      >
                        {uploading ? "Uploading..." : "Upload file"}
                      </Button>
                      {detail.document.upload_status === "uploaded" ? (
                        <Button
                          disabled={uploading}
                          onClick={() => void handleRemoveFile(detail.document.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Remove file
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs text-[#66788F]">
                      Allowed: PDF, PNG, JPG, DOC, DOCX, XLS, XLSX. Max 10 MB.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-[#F3FAFD] p-4 text-sm text-[#425B76]">
                    Document uploads are not enabled for this workspace. Owners
                    and admins can enable the Document Uploads feature in Feature
                    Settings when the plan allows it.
                  </div>
                )}
              </div>

              <div className="mt-5">
                <h3 className="text-sm font-semibold uppercase text-[#66788F]">
                  Activity
                </h3>
                <div className="mt-3 space-y-3">
                  {detail.activity.length === 0 ? (
                    <p className="text-sm text-[#5D7185]">No activity yet.</p>
                  ) : (
                    detail.activity.map((activity) => (
                      <div
                        className="rounded-2xl border border-[#D8E8F0] p-4"
                        key={activity.id}
                      >
                        <p className="text-sm font-semibold">
                          {formatDocumentLabel(activity.action)}
                        </p>
                        <p className="mt-1 text-xs text-[#66788F]">
                          {formatDocumentDate(activity.created_at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
