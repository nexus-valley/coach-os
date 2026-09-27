import { Upload, type HttpRequest, type HttpResponse, type HttpStack } from "tus-js-client";

import { isNativeVideoUploadCapabilityUrl } from "@/src/lib/monitoring";

export type NativeVideoTusErrorCategory =
  | "native_video_tus_expired"
  | "native_video_tus_network_error"
  | "native_video_tus_rejected";

export type NativeVideoTusTransport = {
  start(): void;
  stop(): Promise<void>;
};

type TusUploadLike = {
  abort(shouldTerminate?: boolean): Promise<void>;
  start(): void;
};

type TusUploadConstructor = new (file: File, options: ConstructorParameters<typeof Upload>[1]) => TusUploadLike;
type NativeVideoTusFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const nativeVideoTusChunkSizeBytes = 20_971_520;

const nonPersistentUrlStorage = {
  async addUpload() {
    throw new Error("native_video_tus_persistence_disabled");
  },
  async findAllUploads() {
    return [];
  },
  async findUploadsByFingerprint() {
    return [];
  },
  async removeUpload() {},
};

class NativeVideoTusRedirectError extends Error {
  constructor() {
    super("native_video_tus_redirect_rejected");
    this.name = "NativeVideoTusRedirectError";
  }
}

class NativeVideoTusFetchResponse implements HttpResponse {
  constructor(
    private readonly response: Response,
    private readonly body: string,
  ) {}

  getStatus() {
    return this.response.status;
  }

  getHeader(header: string) {
    return this.response.headers.get(header) ?? undefined;
  }

  getBody() {
    return this.body;
  }

  getUnderlyingObject() {
    return this.response;
  }
}

function requestBodySize(body: unknown) {
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  return null;
}

class NativeVideoTusFetchRequest implements HttpRequest {
  private readonly abortController = new AbortController();
  private readonly headers = new Headers();
  private progressHandler: ((bytesSent: number) => void) | null = null;

  constructor(
    private readonly method: string,
    private readonly url: string,
    private readonly fetchImpl: NativeVideoTusFetch,
  ) {}

  getMethod() {
    return this.method;
  }

  getURL() {
    return this.url;
  }

  setHeader(header: string, value: string) {
    this.headers.set(header, value);
  }

  getHeader(header: string) {
    return this.headers.get(header) ?? undefined;
  }

  setProgressHandler(handler: (bytesSent: number) => void) {
    this.progressHandler = handler;
  }

  async send(body: unknown = null) {
    if (!isNativeVideoUploadCapabilityUrl(this.url)) {
      throw new Error("native_video_tus_capability_invalid");
    }

    const response = await this.fetchImpl(this.url, {
      body: body === null ? undefined : (body as BodyInit),
      credentials: "omit",
      headers: this.headers,
      method: this.method,
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: this.abortController.signal,
    });

    if (response.redirected || response.url !== this.url) {
      throw new NativeVideoTusRedirectError();
    }

    const bodySize = requestBodySize(body);
    if (bodySize !== null) this.progressHandler?.(bodySize);
    return new NativeVideoTusFetchResponse(response, await response.text());
  }

  async abort() {
    this.abortController.abort();
  }

  getUnderlyingObject() {
    return this.abortController;
  }
}

class NativeVideoTusFetchStack implements HttpStack {
  constructor(private readonly fetchImpl: NativeVideoTusFetch) {}

  createRequest(method: string, url: string) {
    if (!isNativeVideoUploadCapabilityUrl(url)) {
      throw new Error("native_video_tus_capability_invalid");
    }
    return new NativeVideoTusFetchRequest(method, url, this.fetchImpl);
  }

  getName() {
    return "NativeVideoTusFetchStack";
  }
}

export function createNativeVideoTusHttpStack(
  fetchImpl: NativeVideoTusFetch = fetch,
): HttpStack {
  return new NativeVideoTusFetchStack(fetchImpl);
}

function responseStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const response = (error as { originalResponse?: { getStatus?: () => number } | null }).originalResponse;
  return typeof response?.getStatus === "function" ? response.getStatus() : null;
}

function isRedirectError(error: unknown) {
  if (error instanceof NativeVideoTusRedirectError) return true;
  if (!error || typeof error !== "object") return false;
  return (error as { causingError?: unknown }).causingError instanceof NativeVideoTusRedirectError;
}

export function shouldRetryNativeVideoTusError(error: unknown) {
  if (isRedirectError(error)) return false;
  const status = responseStatus(error);
  return (
    status === null ||
    status === 408 ||
    status === 409 ||
    status === 423 ||
    status === 429 ||
    status >= 500
  );
}

export function classifyNativeVideoTusError(error: unknown): NativeVideoTusErrorCategory {
  if (isRedirectError(error)) return "native_video_tus_rejected";
  const status = responseStatus(error);
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    return "native_video_tus_expired";
  }
  if (status !== null && status >= 400 && status < 500 && !shouldRetryNativeVideoTusError(error)) {
    return "native_video_tus_rejected";
  }
  return "native_video_tus_network_error";
}

export function createNativeVideoTusUpload(
  input: {
    file: File;
    onError(category: NativeVideoTusErrorCategory): void;
    onProgress(bytesUploaded: number, bytesTotal: number): void;
    onSuccess(): void;
    uploadUrl: string;
  },
  dependencies: {
    UploadClass?: TusUploadConstructor;
    fetchImpl?: NativeVideoTusFetch;
  } = {},
): NativeVideoTusTransport {
  if (!isNativeVideoUploadCapabilityUrl(input.uploadUrl)) {
    throw new Error("native_video_tus_capability_invalid");
  }

  const UploadClass = dependencies.UploadClass ?? Upload;
  const upload = new UploadClass(input.file, {
    addRequestId: false,
    chunkSize: nativeVideoTusChunkSizeBytes,
    headers: {},
    httpStack: createNativeVideoTusHttpStack(dependencies.fetchImpl),
    metadata: {},
    onBeforeRequest(request) {
      if (!isNativeVideoUploadCapabilityUrl(request.getURL())) {
        throw new Error("native_video_tus_capability_invalid");
      }
    },
    onError(error) {
      input.onError(classifyNativeVideoTusError(error));
    },
    onProgress: input.onProgress,
    onShouldRetry(error) {
      return shouldRetryNativeVideoTusError(error);
    },
    onSuccess: input.onSuccess,
    parallelUploads: 1,
    removeFingerprintOnSuccess: true,
    retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
    storeFingerprintForResuming: false,
    uploadUrl: input.uploadUrl,
    urlStorage: nonPersistentUrlStorage,
  });

  return {
    start() {
      upload.start();
    },
    async stop() {
      await upload.abort(false);
    },
  };
}
