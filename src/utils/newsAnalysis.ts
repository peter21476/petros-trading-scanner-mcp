export type NewsImpact = "high" | "medium" | "low";
export type NewsSentiment = "positive" | "negative" | "neutral";

const HIGH_IMPACT_KEYWORDS = [
  "war",
  "iran",
  "fed",
  "rate cut",
  "rate hike",
  "inflation",
  "recession",
  "earnings",
  "oil",
  "opec",
  "tariff",
  "sanction",
  "default",
  "bankruptcy",
  "merger",
  "acquisition",
  "billion",
  "crisis",
  "shutdown",
  "cpi",
  "jobs report",
  "geopolit",
  "strait",
  "nuclear",
];

const MEDIUM_IMPACT_KEYWORDS = [
  "futures",
  "premarket",
  "market",
  "stocks",
  "nasdaq",
  "s&p",
  "semiconductor",
  "chip",
  "sector",
  "guidance",
  "forecast",
  "upgrade",
  "downgrade",
  "volume",
  "rebalance",
];

const NEGATIVE_KEYWORDS = [
  "slip",
  "fall",
  "drop",
  "lower",
  "weak",
  "threat",
  "tension",
  "concern",
  "miss",
  "cut",
  "downgrade",
  "decline",
  "loss",
  "bearish",
  "selloff",
  "retreat",
  "negative",
  "bad",
  "risk",
  "warning",
];

const POSITIVE_KEYWORDS = [
  "rise",
  "climb",
  "gain",
  "strong",
  "beat",
  "upgrade",
  "rally",
  "surge",
  "jump",
  "bullish",
  "record",
  "outperform",
  "positive",
  "good",
  "rebound",
  "soar",
];

export function classifyHeadline(
  headline: string,
  finvizSentiment?: string | null,
): { impact: NewsImpact; sentiment: NewsSentiment } {
  const lower = headline.toLowerCase();

  let impact: NewsImpact = "low";
  if (HIGH_IMPACT_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    impact = "high";
  } else if (MEDIUM_IMPACT_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    impact = "medium";
  }

  if (finvizSentiment === "bad") {
    return { impact, sentiment: "negative" };
  }
  if (finvizSentiment === "good") {
    return { impact, sentiment: "positive" };
  }

  const negativeHits = NEGATIVE_KEYWORDS.filter((keyword) => lower.includes(keyword)).length;
  const positiveHits = POSITIVE_KEYWORDS.filter((keyword) => lower.includes(keyword)).length;

  if (negativeHits > positiveHits) {
    return { impact, sentiment: "negative" };
  }
  if (positiveHits > negativeHits) {
    return { impact, sentiment: "positive" };
  }

  return { impact, sentiment: "neutral" };
}

export function enrichHeadline(
  headline: string,
  options?: {
    finvizSentiment?: string | null;
    time?: string;
    url?: string;
    source?: string;
  },
): {
  headline: string;
  impact: NewsImpact;
  sentiment: NewsSentiment;
  time?: string;
  url?: string;
  source?: string;
} {
  const { impact, sentiment } = classifyHeadline(headline, options?.finvizSentiment);
  return {
    headline,
    impact,
    sentiment,
    time: options?.time,
    url: options?.url,
    source: options?.source,
  };
}
