export type DataFreshness = "fresh" | "stale";

/** Max age before a quote or feed timestamp is considered stale (covers long weekends). */
export const DATA_FRESHNESS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function computeDataFreshness(input: {
  asOf?: string | null;
  isDelayed?: boolean;
  timestamp?: string | null;
}): DataFreshness {
  if (input.isDelayed && !input.asOf) {
    return "stale";
  }

  const reference = input.asOf ?? input.timestamp ?? null;
  if (!reference) {
    return "stale";
  }

  const ageMs = Date.now() - Date.parse(reference);
  if (Number.isNaN(ageMs)) {
    return "stale";
  }

  return ageMs <= DATA_FRESHNESS_MAX_AGE_MS ? "fresh" : "stale";
}

export function computeAggregateDataFreshness(
  values: Array<DataFreshness | undefined | null>,
): DataFreshness {
  if (values.length === 0) {
    return "stale";
  }
  return values.every((value) => value === "fresh") ? "fresh" : "stale";
}
