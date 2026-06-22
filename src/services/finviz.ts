import * as cheerio from "cheerio";
import { CACHE_TTL, getCached } from "./cache.js";
import { fetchText } from "./http.js";
import { parseNumber, parsePercent, parseVolume, signedChange } from "../utils/parseNumber.js";
import {
  emptyBreadth,
  emptyFutures,
  FUTURES_LABEL_MAP,
  type FinvizHomepageData,
  type HeadlineItem,
  type MarketBreadth,
  type SnapshotStock,
} from "../types/market.js";
import { logger } from "../utils/logger.js";

const FINVIZ_HOME_URL = "https://finviz.com/";

function extractPercentFromLabel(text: string): number | null {
  const match = text.match(/([\d.]+)%/);
  return match ? parseNumber(match[1]) : null;
}

function parseBreadthSection(html: string): MarketBreadth {
  const breadth = emptyBreadth();
  const $ = cheerio.load(html);

  const statsBlocks = $(".market-stats");
  statsBlocks.each((_, element) => {
    const boxover = $(element).attr("data-boxover-html") ?? "";
    const leftText = $(element).find(".market-stats_labels_left p").eq(1).text();
    const rightText = $(element).find(".market-stats_labels_right p").eq(1).text();

    if (boxover.includes("Advancing / Declining")) {
      breadth.advancingPercent = extractPercentFromLabel(leftText);
      breadth.decliningPercent = extractPercentFromLabel(rightText);
    } else if (boxover.includes("New High / New Low")) {
      breadth.newHighPercent = extractPercentFromLabel(leftText);
      breadth.newLowPercent = extractPercentFromLabel(rightText);
    } else if (boxover.includes("Above SMA50")) {
      breadth.aboveSma50Percent = extractPercentFromLabel(leftText);
      breadth.belowSma50Percent = extractPercentFromLabel(rightText);
    } else if (boxover.includes("Above SMA200")) {
      breadth.aboveSma200Percent = extractPercentFromLabel(leftText);
      breadth.belowSma200Percent = extractPercentFromLabel(rightText);
    }
  });

  return breadth;
}

function parseFuturesTable(html: string): FinvizHomepageData["futures"] {
  const futures = emptyFutures();
  const $ = cheerio.load(html);

  $('[data-gtm-section="futures"] table tr').each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) {
      return;
    }

    const label = $(cells[0]).text().trim().toLowerCase();
    const key = FUTURES_LABEL_MAP[label];
    if (!key) {
      return;
    }

    futures[key] = {
      last: parseNumber($(cells[1]).text()),
      change: signedChange($(cells[2]).text()),
      changePercent: parsePercent($(cells[3]).text()),
    };
  });

  // BTC is in forex/bonds section on Finviz homepage
  $('[data-gtm-section="forex_and_bonds"] table tr').each((_, row) => {
    const label = $(row).find("td").first().text().trim().toLowerCase();
    if (label !== "btc/usd") {
      return;
    }
    const cells = $(row).find("td");
    futures.bitcoin = {
      last: parseNumber($(cells[1]).text()),
      change: signedChange($(cells[2]).text()),
      changePercent: parsePercent($(cells[3]).text()),
    };
  });

  return futures;
}

function parseSignalRows(html: string, signalMatcher: (signal: string) => boolean): SnapshotStock[] {
  const $ = cheerio.load(html);
  const rows: SnapshotStock[] = [];

  $("#js-signals_1 tr, #js-signals_2 tr").each((_, row) => {
    const signal = $(row).find("td").last().text().trim();
    if (!signalMatcher(signal)) {
      return;
    }

    const symbol = $(row).find("a.tab-link").first().text().trim();
    if (!symbol) {
      return;
    }

    const cells = $(row).find("td");
    rows.push({
      symbol,
      name: $(row).attr("data-boxover-company") ?? undefined,
      price: parseNumber($(cells[1]).text()),
      changePercent: parsePercent($(cells[2]).text()),
      volume: parseVolume($(cells[3]).text()),
      signal,
    });
  });

  return rows;
}

function parseMajorNews(html: string): SnapshotStock[] {
  const $ = cheerio.load(html);
  const items: SnapshotStock[] = [];

  $('[data-gtm-section="major_news"] .hp_label-container').each((_, element) => {
    const symbol = $(element).find("a.tab-link").first().text().trim();
    const changeText = $(element).find(".hp_label").text().trim();
    if (!symbol) {
      return;
    }

    items.push({
      symbol,
      changePercent: parsePercent(changeText),
    });
  });

  return items;
}

function parseHeadlines(html: string): HeadlineItem[] {
  const $ = cheerio.load(html);
  const headlines: HeadlineItem[] = [];

  $('[data-gtm-section="headlines"] tr').each((_, row) => {
    const title = $(row).find("a.nn-tab-link").text().trim();
    if (!title) {
      return;
    }
    headlines.push({
      time: $(row).find(".nn-date").text().trim() || undefined,
      title,
      url: $(row).find("a.nn-tab-link").attr("href") ?? undefined,
    });
  });

  return headlines;
}

function parseMarketSummaryHeadline(html: string): string | undefined {
  const match = html.match(
    /id="why-stock-moving-init-data"[^>]*>(\{.*?\})<\/script>/s,
  );
  if (!match) {
    return undefined;
  }

  try {
    const data = JSON.parse(match[1]) as {
      whyMoving?: { headline?: string };
    };
    return data.whyMoving?.headline;
  } catch {
    return undefined;
  }
}

function parseHomepageHtml(html: string): FinvizHomepageData {
  return {
    futures: parseFuturesTable(html),
    breadth: parseBreadthSection(html),
    topGainers: parseSignalRows(html, (signal) =>
      signal.toLowerCase().includes("top gainers"),
    ),
    topLosers: parseSignalRows(html, (signal) =>
      signal.toLowerCase().includes("top losers"),
    ),
    newHighs: parseSignalRows(html, (signal) =>
      signal.toLowerCase().includes("new high"),
    ),
    unusualVolume: parseSignalRows(html, (signal) =>
      signal.toLowerCase().includes("unusual volume"),
    ),
    majorNews: parseMajorNews(html),
    headlines: parseHeadlines(html),
    marketSummaryHeadline: parseMarketSummaryHeadline(html),
  };
}

export async function fetchFinvizHomepage(): Promise<FinvizHomepageData> {
  return getCached("finviz:homepage", CACHE_TTL.MARKET_DATA_MS, async () => {
    const html = await fetchText(FINVIZ_HOME_URL);
    return parseHomepageHtml(html);
  });
}

interface FinvizEarningsItem {
  earningsDate: string;
  ticker: string;
  company: string;
}

interface FinvizEarningsApiResponse {
  items: FinvizEarningsItem[];
  page: number;
  pageSize: number;
  totalItemsCount: number;
  totalPages: number;
}

function mapEarningsTime(dateIso: string): "before_open" | "after_close" | "unknown" {
  const hour = Number.parseInt(dateIso.slice(11, 13), 10);
  if (Number.isNaN(hour)) {
    return "unknown";
  }
  if (hour < 12) {
    return "before_open";
  }
  if (hour >= 16) {
    return "after_close";
  }
  return "unknown";
}

function formatDateOnly(dateIso: string): string {
  return dateIso.slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function fetchFinvizEarnings(days: number): Promise<{
  earnings: Array<{
    date: string;
    time: "before_open" | "after_close" | "unknown";
    symbol: string;
    company: string;
  }>;
  warnings: string[];
}> {
  const cacheKey = `finviz:earnings:${days}`;
  return getCached(cacheKey, CACHE_TTL.MARKET_DATA_MS, async () => {
    const warnings: string[] = [];
    const earnings: Array<{
      date: string;
      time: "before_open" | "after_close" | "unknown";
      symbol: string;
      company: string;
    }> = [];

    const today = new Date();
    const endDate = addDays(today, days);
    const seen = new Set<string>();

    for (let offset = 0; offset <= days; offset += 1) {
      const dateFrom = formatDateParam(addDays(today, offset));
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const url = `https://finviz.com/api/calendar/earnings?dateFrom=${dateFrom}&page=${page}&sort=earningsDate`;
        try {
          const response = await fetchText(url, {
            headers: { Accept: "application/json" },
          });
          const data = JSON.parse(response) as FinvizEarningsApiResponse;
          totalPages = Math.max(data.totalPages, 1);

          for (const item of data.items) {
            const date = formatDateOnly(item.earningsDate);
            if (date > formatDateParam(endDate)) {
              continue;
            }
            const dedupeKey = `${item.ticker}:${date}`;
            if (seen.has(dedupeKey)) {
              continue;
            }
            seen.add(dedupeKey);
            earnings.push({
              date,
              time: mapEarningsTime(item.earningsDate),
              symbol: item.ticker,
              company: item.company,
            });
          }
        } catch (error) {
          warnings.push(`Finviz earnings fetch failed for ${dateFrom}: ${String(error)}`);
          logger.warn("Finviz earnings page failed", { dateFrom, page, error });
          break;
        }

        page += 1;
      }
    }

    earnings.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
    return { earnings, warnings };
  });
}

export async function safeFetchFinvizHomepage(): Promise<{
  data: FinvizHomepageData | null;
  warning?: string;
}> {
  try {
    const data = await fetchFinvizHomepage();
    return { data };
  } catch (error) {
    return {
      data: null,
      warning: `Finviz unavailable: ${String(error)}`,
    };
  }
}
