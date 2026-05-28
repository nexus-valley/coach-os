export type OptionalQueryDiagnostics = {
  area?: string;
  helper: string;
  table?: string;
};

type SupabaseLikeError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
  name?: string;
};

function getErrorDetails(caught: unknown): SupabaseLikeError {
  if (caught instanceof Error) {
    return {
      message: caught.message,
      name: caught.name,
    };
  }

  if (caught && typeof caught === "object") {
    const error = caught as SupabaseLikeError;

    return {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message:
        typeof error.message === "string"
          ? error.message
          : "Non-Error object thrown.",
      name: error.name,
    };
  }

  return {
    message: String(caught),
  };
}

export function logOptionalQueryFailure(
  diagnostics: OptionalQueryDiagnostics,
  caught: unknown,
) {
  const error = getErrorDetails(caught);

  console.warn("[CoachFort optional query failed]", {
    area: diagnostics.area ?? "optional-read",
    code: error.code ?? null,
    details: error.details ?? null,
    helper: diagnostics.helper,
    hint: error.hint ?? null,
    message: error.message ?? null,
    name: error.name ?? null,
    table: diagnostics.table ?? null,
  });
}

export async function safeOptionalQuery<T>(
  diagnostics: OptionalQueryDiagnostics,
  loader: () => Promise<T>,
  fallback: T,
) {
  try {
    return await loader();
  } catch (caught) {
    logOptionalQueryFailure(diagnostics, caught);
    return fallback;
  }
}
