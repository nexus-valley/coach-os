export function safePercent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }

  return Math.round((numerator / denominator) * 100);
}

export function roundMetric(value: number, precision = 1) {
  const multiplier = 10 ** precision;

  return Math.round(value * multiplier) / multiplier;
}

export function average(values: Array<number | null | undefined>) {
  const numericValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  if (numericValues.length === 0) {
    return null;
  }

  return roundMetric(
    numericValues.reduce((total, value) => total + value, 0) / numericValues.length,
  );
}

export function sumBy<T>(items: T[], getValue: (item: T) => number) {
  return items.reduce((total, item) => total + getValue(item), 0);
}

export function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item) ?? "Unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export function getStartDateForRange(
  dateRange: "all_time" | "last_30_days" | "last_7_days" | "this_month",
) {
  const now = new Date();

  if (dateRange === "all_time") {
    return null;
  }

  if (dateRange === "this_month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  const start = new Date(now);
  start.setDate(now.getDate() - (dateRange === "last_7_days" ? 7 : 30));

  return start.toISOString();
}
