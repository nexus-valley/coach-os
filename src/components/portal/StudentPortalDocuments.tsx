"use client";

import { useEffect, useState } from "react";

import {
  PortalEmptyState,
  PortalError,
  PortalLoadingCard,
} from "@/src/components/portal/StudentPortalShared";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  formatDocumentDate,
  formatDocumentFileSize,
  formatDocumentLabel,
  getStudentDocumentDetail,
  getStudentDocuments,
  recordDocumentView,
  type DocumentRecord,
} from "@/src/lib/documentCenter";
import { getDocumentDownloadUrl } from "@/src/lib/documentStorage";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function typeTone(type: string): "light" | "success" | "trainer" | "warning" {
  if (type === "student") return "success";
  if (type === "course" || type === "cohort") return "trainer";
  if (type === "session") return "warning";
  return "light";
}

export function StudentPortalDocuments({
  context,
}: {
  context: StudentPortalContext;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    async function loadDocuments() {
      setLoading(true);
      setError("");

      try {
        const rows = await getStudentDocuments();
        if (active) {
          setDocuments(rows);
          setSelectedDocument(rows[0] ?? null);
        }
      } catch (caught) {
        if (active) {
          setError(getErrorMessage(caught, "Unable to load documents."));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDocuments();

    return () => {
      active = false;
    };
  }, [context.student.id]);

  async function handleSelect(documentId: string) {
    setError("");

    try {
      const detail = await getStudentDocumentDetail(documentId);
      setSelectedDocument(detail.document);
      await recordDocumentView(documentId);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to open document."));
    }
  }

  async function handleOpenFile(documentId: string) {
    setError("");

    try {
      const result = await getDocumentDownloadUrl(documentId);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to open document file."));
    }
  }

  if (loading) return <PortalLoadingCard label="Loading documents" />;
  if (error) return <PortalError message={error} />;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-normal">Documents</h1>
      <p className="mt-2 text-sm text-[#425B76]">
        Your institute can share student, course, cohort, and session document
        references here. Uploads and online document submission are not enabled
        yet.
      </p>

      {documents.length === 0 ? (
        <div className="mt-6">
          <PortalEmptyState>No documents have been shared with you yet.</PortalEmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
          <div className="space-y-3">
            {documents.map((document) => (
              <button
                className={[
                  "w-full rounded-3xl border bg-white p-5 text-left shadow-sm transition hover:border-[#2ECBEA]",
                  selectedDocument?.id === document.id
                    ? "border-[#2ECBEA] ring-2 ring-[#2ECBEA]/20"
                    : "border-[#D8E8F0]",
                ].join(" ")}
                key={document.id}
                onClick={() => void handleSelect(document.id)}
                type="button"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">
                      {document.title}
                    </p>
                    <p className="mt-1 text-sm text-[#425B76]">
                      {document.category ?? "Shared document"}
                    </p>
                  </div>
                  <Badge tone={typeTone(document.document_type)}>
                    {formatDocumentLabel(document.document_type)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#66788F]">
                  <span>{document.file_name ?? "Reference"}</span>
                  <span>Updated {formatDocumentDate(document.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>

          <Card className="border-[#D8E8F0] bg-white p-5">
            {selectedDocument ? (
              <>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {selectedDocument.title}
                    </h2>
                    <p className="mt-1 text-sm text-[#425B76]">
                      {selectedDocument.description ?? "No description provided."}
                    </p>
                  </div>
                  <Badge tone={typeTone(selectedDocument.document_type)}>
                    {formatDocumentLabel(selectedDocument.document_type)}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Category", selectedDocument.category ?? "Not set"],
                    ["File name", selectedDocument.file_name ?? "Not set"],
                    [
                      "File size",
                      formatDocumentFileSize(selectedDocument.file_size_bytes),
                    ],
                    ["Updated", formatDocumentDate(selectedDocument.updated_at)],
                  ].map(([label, value]) => (
                    <div className="rounded-2xl bg-[#F3FAFD] p-4" key={label}>
                      <p className="text-xs font-semibold uppercase text-[#66788F]">
                        {label}
                      </p>
                      <p className="mt-2 text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>

                {selectedDocument.external_url ? (
                  <div className="mt-5 rounded-2xl border border-[#D8E8F0] p-4">
                    <p className="text-sm text-[#425B76]">
                      This is a document reference link shared by your institute.
                    </p>
                    <Button
                      className="mt-4"
                      href={selectedDocument.external_url}
                      size="sm"
                      variant="secondary"
                    >
                      Open reference
                    </Button>
                  </div>
                ) : (
                  null
                )}

                {selectedDocument.upload_status === "uploaded" ? (
                  <div className="mt-5 rounded-2xl border border-[#D8E8F0] p-4">
                    <p className="text-sm text-[#425B76]">
                      This file opens through a short-lived secure link.
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => void handleOpenFile(selectedDocument.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Open file
                    </Button>
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl border border-[#D8E8F0] p-4 text-sm text-[#425B76]">
                    No downloadable file is attached yet.
                  </p>
                )}
              </>
            ) : (
              <PortalEmptyState>Select a document to view details.</PortalEmptyState>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
