const safePathOrigin = "https://coachfort.local";
const unsafeEncodedPathPattern = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i;
const unsafePathCharacterPattern = /[\\\u0000-\u001f\u007f]/;

export function getSafeInternalPath(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    unsafePathCharacterPattern.test(value) ||
    unsafeEncodedPathPattern.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, safePathOrigin);

    if (parsed.origin !== safePathOrigin || parsed.pathname.startsWith("//")) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
