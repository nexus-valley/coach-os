const DEFAULT_SESSION_TIMEZONE = "Asia/Kolkata";

type SessionTimingEvidence = {
  scheduled_start_at: string;
  status: "canceled" | "completed" | "scheduled";
};

export type OperationalSessionGroups<T extends SessionTimingEvidence> = {
  canceled: T[];
  completed: T[];
  pastDue: T[];
  upcoming: T[];
};

type WallClockParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function getWallClockParts(value: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);

  return {
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    month: part("month"),
    year: part("year"),
  };
}

function partsToUtc(parts: WallClockParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameWallClock(left: WallClockParts, right: WallClockParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function parseWallClock(value: string): WallClockParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("Enter a valid date and time.");
  }

  const parts = {
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    month: Number(match[2]),
    year: Number(match[1]),
  };
  const normalized = new Date(partsToUtc(parts));

  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute
  ) {
    throw new Error("Enter a valid date and time.");
  }

  return parts;
}

export function classifyOperationalSessions<T extends SessionTimingEvidence>(
  sessions: T[],
  now = Date.now(),
): OperationalSessionGroups<T> {
  const ascending = (left: T, right: T) =>
    new Date(left.scheduled_start_at).getTime() -
    new Date(right.scheduled_start_at).getTime();
  const descending = (left: T, right: T) => -ascending(left, right);

  return {
    canceled: sessions
      .filter((session) => session.status === "canceled")
      .sort(descending),
    completed: sessions
      .filter((session) => session.status === "completed")
      .sort(descending),
    pastDue: sessions
      .filter(
        (session) =>
          session.status === "scheduled" &&
          new Date(session.scheduled_start_at).getTime() < now,
      )
      .sort(descending),
    upcoming: sessions
      .filter(
        (session) =>
          session.status === "scheduled" &&
          new Date(session.scheduled_start_at).getTime() >= now,
      )
      .sort(ascending),
  };
}

export function normalizeSessionTimezone(value?: string | null) {
  const timeZone = value?.trim() || DEFAULT_SESSION_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new Error("Enter a valid IANA timezone, such as Asia/Kolkata.");
  }
}

export function formatSessionDateTime(
  value: string | null | undefined,
  timeZone?: string | null,
) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: normalizeSessionTimezone(timeZone),
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatSessionDateTimeLocal(
  value: string | null | undefined,
  timeZone?: string | null,
) {
  if (!value) {
    return "";
  }

  const parts = getWallClockParts(
    new Date(value),
    normalizeSessionTimezone(timeZone),
  );
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function sessionWallClockToIso(
  value: string | null | undefined,
  timeZone?: string | null,
) {
  if (!value) {
    return null;
  }

  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value);

    if (Number.isNaN(instant.getTime())) {
      throw new Error("Enter a valid date and time.");
    }

    return instant.toISOString();
  }

  const zone = normalizeSessionTimezone(timeZone);
  const target = parseWallClock(value);
  let candidate = partsToUtc(target);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = getWallClockParts(new Date(candidate), zone);
    const correction = partsToUtc(target) - partsToUtc(rendered);

    if (correction === 0) {
      break;
    }

    candidate += correction;
  }

  const matchingInstants = Array.from(
    { length: 17 },
    (_, index) => (index - 8) * 15 * 60 * 1000,
  )
    .map((offset) => candidate + offset)
    .filter((instant, index, values) => values.indexOf(instant) === index)
    .filter((instant) =>
      sameWallClock(getWallClockParts(new Date(instant), zone), target),
    );

  if (matchingInstants.length === 0) {
    throw new Error(
      "That local time does not exist in the selected timezone. Choose another time.",
    );
  }

  if (matchingInstants.length > 1) {
    throw new Error(
      "That local time occurs twice in the selected timezone. Choose another time.",
    );
  }

  return new Date(matchingInstants[0]).toISOString();
}

export function getDefaultSessionWallClock(
  hoursFromNow: number,
  timeZone = DEFAULT_SESSION_TIMEZONE,
) {
  const zone = normalizeSessionTimezone(timeZone);
  const current = getWallClockParts(new Date(), zone);
  const wallClock = new Date(partsToUtc({ ...current, minute: 0 }));
  wallClock.setUTCHours(wallClock.getUTCHours() + hoursFromNow);

  const target = {
    day: wallClock.getUTCDate(),
    hour: wallClock.getUTCHours(),
    minute: wallClock.getUTCMinutes(),
    month: wallClock.getUTCMonth() + 1,
    year: wallClock.getUTCFullYear(),
  };
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${target.year}-${pad(target.month)}-${pad(target.day)}T${pad(target.hour)}:${pad(target.minute)}`;
}
