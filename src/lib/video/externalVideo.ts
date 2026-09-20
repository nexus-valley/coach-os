const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const vimeoVideoIdPattern = /^\d{1,20}$/;

const approvedExternalVideoHosts = new Set([
  "player.vimeo.com",
  "vimeo.com",
  "www.vimeo.com",
  "www.youtube.com",
  "youtu.be",
  "youtube.com",
]);

export type ExternalVideoPresentation =
  | {
      embedUrl: string;
      kind: "embed";
      provider: "vimeo" | "youtube";
    }
  | {
      href: string;
      kind: "link";
      provider: "vimeo" | "youtube";
    }
  | {
      kind: "invalid";
    };

function isSafeApprovedUrl(url: URL, rawValue: string) {
  return (
    rawValue.length <= 1_000 &&
    !/[\s\u0000-\u001f\u007f]/.test(rawValue) &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    approvedExternalVideoHosts.has(url.hostname.toLowerCase())
  );
}

function pathParts(url: URL) {
  return url.pathname.split("/").filter(Boolean);
}

function youtubeVideoId(url: URL) {
  const host = url.hostname.toLowerCase();
  const parts = pathParts(url);

  if (host === "youtu.be" && parts.length === 1) {
    return youtubeVideoIdPattern.test(parts[0]) ? parts[0] : null;
  }

  if (host !== "youtube.com" && host !== "www.youtube.com") {
    return null;
  }

  if (url.pathname === "/watch") {
    const candidate = url.searchParams.get("v") ?? "";
    return youtubeVideoIdPattern.test(candidate) ? candidate : null;
  }

  if (
    parts.length === 2 &&
    (parts[0] === "embed" || parts[0] === "shorts") &&
    youtubeVideoIdPattern.test(parts[1])
  ) {
    return parts[1];
  }

  return null;
}

function vimeoVideoId(url: URL) {
  const host = url.hostname.toLowerCase();
  const parts = pathParts(url);

  if (
    (host === "vimeo.com" || host === "www.vimeo.com") &&
    parts.length === 1 &&
    vimeoVideoIdPattern.test(parts[0])
  ) {
    return parts[0];
  }

  if (
    host === "player.vimeo.com" &&
    parts.length === 2 &&
    parts[0] === "video" &&
    vimeoVideoIdPattern.test(parts[1])
  ) {
    return parts[1];
  }

  return null;
}

export function getExternalVideoPresentation(
  value: string,
): ExternalVideoPresentation {
  const normalized = value.trim();
  let url: URL;

  try {
    url = new URL(normalized);
  } catch {
    return { kind: "invalid" };
  }

  if (!isSafeApprovedUrl(url, normalized)) {
    return { kind: "invalid" };
  }

  const youtubeId = youtubeVideoId(url);
  if (youtubeId) {
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}`,
      kind: "embed",
      provider: "youtube",
    };
  }

  const vimeoId = vimeoVideoId(url);
  if (vimeoId) {
    return {
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
      kind: "embed",
      provider: "vimeo",
    };
  }

  const host = url.hostname.toLowerCase();
  return {
    href: url.toString(),
    kind: "link",
    provider: host.includes("youtube") || host === "youtu.be" ? "youtube" : "vimeo",
  };
}
