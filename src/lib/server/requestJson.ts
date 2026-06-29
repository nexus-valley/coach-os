export class InvalidJsonPayloadError extends Error {
  constructor() {
    super("Invalid JSON payload.");
    this.name = "InvalidJsonPayloadError";
  }
}

export async function parseJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new InvalidJsonPayloadError();
  }
}
