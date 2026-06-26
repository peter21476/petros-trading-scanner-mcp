import { CACHE_TTL, getCachedWithMeta } from "./cache.js";
import { safeFetchJson } from "./http.js";
import { withYahooThrottle } from "./yahooSpark.js";
import { classifyHeadline } from "../utils/newsAnalysis.js";
import type { TickerNewsArticle, TickerNewsResponse } from "../types/marketResearch.js";

interface FinnhubNewsItem {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  source?: string;
  summary?: string;
  url?: string;
}

interface YahooNewsItem {
  title?: string;
  publisher?: string;
  providerPublishTime?: number;
  link?: string;
}

function sentimentToScore(sentiment: "positive" | "negative" | "neutral"): number {
  if (sentiment === "positive") {
    return 1;
  }
  if (sentiment === "negative") {
    return -1;
  }
  return 0;
}

function oneSentenceSummary(headline: string, summary?: string): string {
  const text = (summary ?? headline).trim();
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

async function fetchFinnhubNews(
  symbol: string,
  limit: number,
): Promise<{ articles: TickerNewsArticle[]; warnings: string[] }> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    return { articles: [], warnings: [] };
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${token}`;
  const data = await safeFetchJson<FinnhubNewsItem[]>(url);
  if (!data?.length) {
    return { articles: [], warnings: [`Finnhub news unavailable for ${symbol}`] };
  }

  const articles = data.slice(0, limit).map((item) => {
    const headline = item.headline ?? "Untitled";
    const { sentiment } = classifyHeadline(headline);
    return {
      headline,
      source: item.source ?? "Finnhub",
      publishedAt: item.datetime
        ? new Date(item.datetime * 1000).toISOString()
        : new Date().toISOString(),
      url: item.url ?? "",
      sentiment,
      summary: oneSentenceSummary(headline, item.summary),
    };
  });

  return { articles, warnings: [] };
}

async function fetchYahooNews(
  symbol: string,
  limit: number,
): Promise<{ articles: TickerNewsArticle[]; warnings: string[] }> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${limit}`;
  const data = await withYahooThrottle(() =>
    safeFetchJson<{ news?: YahooNewsItem[] }>(url),
  );
  const items = data?.news ?? [];
  if (items.length === 0) {
    return { articles: [], warnings: [`Yahoo news unavailable for ${symbol}`] };
  }

  const articles = items.slice(0, limit).map((item) => {
    const headline = item.title ?? "Untitled";
    const { sentiment } = classifyHeadline(headline);
    return {
      headline,
      source: item.publisher ?? "Yahoo Finance",
      publishedAt: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      url: item.link ?? "",
      sentiment,
      summary: oneSentenceSummary(headline),
    };
  });

  return { articles, warnings: [] };
}

function averageSentiment(articles: TickerNewsArticle[]): number {
  if (articles.length === 0) {
    return 0;
  }
  const total = articles.reduce(
    (sum, article) => sum + sentimentToScore(article.sentiment),
    0,
  );
  return Number((total / articles.length).toFixed(3));
}

/**
 * Recent ticker news with per-article sentiment and summary.
 */
export async function getTickerNews(
  symbol: string,
  limit: number,
): Promise<TickerNewsResponse> {
  const upper = symbol.toUpperCase();
  const cappedLimit = Math.min(Math.max(limit, 1), 10);
  const key = `news:${upper}:${cappedLimit}`;

  const { data, fromCache, cachedAt } = await getCachedWithMeta(
    key,
    CACHE_TTL.MARKET_DATA_MS,
    async () => {
      const warnings: string[] = [];
      let source = "Yahoo Finance";
      let articles: TickerNewsArticle[] = [];

      const finnhub = await fetchFinnhubNews(upper, cappedLimit);
      warnings.push(...finnhub.warnings);
      if (finnhub.articles.length > 0) {
        articles = finnhub.articles;
        source = "Finnhub";
      } else {
        const yahoo = await fetchYahooNews(upper, cappedLimit);
        warnings.push(...yahoo.warnings);
        articles = yahoo.articles;
      }

      if (articles.length === 0) {
        warnings.push(`No news articles found for ${upper}`);
      }

      return {
        source,
        warnings,
        articles,
        sentimentScore: averageSentiment(articles),
      };
    },
  );

  return {
    timestamp: new Date().toISOString(),
    source: data.source,
    dataFreshness: fromCache ? "cached" : "fresh",
    warnings: data.warnings,
    cached: fromCache,
    cachedAt,
    symbol: upper,
    articles: data.articles,
    sentimentScore: data.sentimentScore,
  };
}
