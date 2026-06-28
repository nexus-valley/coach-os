import { getSupabaseClient } from "@/src/lib/supabaseClient";

type UploadResult = {
  documentId: string;
  fileMimeType: string;
  fileName: string;
  fileSizeBytes: number;
  uploadStatus: "uploaded";
};

type DownloadUrlResult = {
  expiresInSeconds: number;
  fileMimeType: string | null;
  fileName: string | null;
  signedUrl: string;
};

async function getAccessToken() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Authentication required.");
  }

  return data.session.access_token;
}

async function parseJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Document storage request failed.");
  }

  return payload as T;
}

export async function uploadDocumentFile(documentId: string, file: File) {
  const token = await getAccessToken();
  const body = new FormData();
  body.set("documentId", documentId);
  body.set("file", file);

  const response = await fetch("/api/documents/upload", {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "POST",
  });

  return parseJsonResponse<UploadResult>(response);
}

export async function getDocumentDownloadUrl(documentId: string) {
  const token = await getAccessToken();
  const response = await fetch("/api/documents/download-url", {
    body: JSON.stringify({ documentId }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<DownloadUrlResult>(response);
}

export async function removeDocumentFile(documentId: string) {
  const token = await getAccessToken();
  const response = await fetch("/api/documents/remove-file", {
    body: JSON.stringify({ documentId }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseJsonResponse<{ documentId: string; uploadStatus: "metadata_only" }>(
    response,
  );
}
