import * as cheerio from "cheerio";
import { CACHE_TTL, getCached } from "./cache.js";
import { fetchText } from "./http.js";
import { parseNumber, parsePercent, parseVolume, signedChange } from "../utils/parseNumber.js";
import type { MoverStock } from "../types/market.js";
import { logger } from "../utils/logger.js";

const PREMARKET_URL = "https://www.marketwatch.com/tools/screener/premarket";

function parseMoverTable(html: string, sectionTitle: string): MoverStock[] {
  const $ = cheerio.load(html);
  const movers: MoverStock[] = [];

  $("h2, h3, .heading, .element__heading").each((_, heading) => {
    const title = $(heading).text().trim().toLowerCase();
    if (!title.includes(sectionTitle.toLowerCase())) {
      return;
    }

    const table = $(heading).nextAll("table").first();
    table.find("tbody tr").each((__, row) => {
      const symbol = $(row).find("a[href*='/investing/stock/']").first().text().trim();
      if (!symbol) {
        return;
      }

      const cells = $(row).find("td");
      movers.push({
        symbol,
        name: $(row).find(".company-name, .table__cell--name").text().trim() || symbol,
        price: parseNumber($(cells).eq(1).text()) ?? parseNumber($(cells).eq(2).text()),
        change: signedChange($(cells).filter((_, cell) => $(cell).text().includes("%")).first().prev().text()),
        changePercent: parsePercent($(cells).filter((_, cell) => $(cell).text().includes("%")).first().text()),
        volume: parseVolume($(cells).last().text()),
      });
    });
  });

  // Fallback: generic table parsing when headings differ
  if (movers.length === 0) {
    $("table tbody tr").each((_, row) => {
      const link = $(row).find("a[href*='/investing/stock/']").first();
      const symbol = link.text().trim();
      if (!symbol || symbol.length > 6) {
        return;
      }

      const cells = $(row).find("td");
      if (cells.length < 3) {
        return;
      }

      movers.push({
        symbol,
        name: symbol,
        price: parseNumber($(cells).eq(1).text()),
        changePercent: parsePercent($(cells).eq(2).text()),
        change: signedChange($(cells).eq(2).text()),
        volume: parseVolume($(cells).eq(3).text()),
      });
    });
  }

  return movers;
}

function isBlockedResponse(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha-delivery.com") ||
    lower.includes("please enable js") ||
    lower.includes("geo.captcha") ||
    html.length < 2_000
  );
}

export async function fetchMarketWatchPremarket(limit: number): Promise<{
  leaders: MoverStock[];
  laggards: MoverStock[];
  mostActive: MoverStock[];
  warning?: string;
}> {
  return getCached(`marketwatch:premarket:${limit}`, CACHE_TTL.MARKET_DATA_MS, async () => {
    try {
      const html = await fetchText(PREMARKET_URL);
      if (isBlockedResponse(html)) {
        return {
          leaders: [],
          laggards: [],
          mostActive: [],
          warning: "MarketWatch blocked or returned incomplete data (captcha/JS wall)",
        };
      }

      const leaders = parseMoverTable(html, "gainer").slice(0, limit);
      const laggards = parseMoverTable(html, "loser").slice(0, limit);
      const mostActive = parseMoverTable(html, "active").slice(0, limit);

      if (leaders.length === 0 && laggards.length === 0 && mostActive.length === 0) {
        return {
          leaders: [],
          laggards: [],
          mostActive: [],
          warning: "MarketWatch premarket tables could not be parsed",
        };
      }

      return { leaders, laggards, mostActive };
    } catch (error) {
      logger.warn("MarketWatch premarket fetch failed", { error });
      return {
        leaders: [],
        laggards: [],
        mostActive: [],
        warning: `MarketWatch unavailable: ${String(error)}`,
      };
    }
  });
}

export function finvizMoversToPremarket(
  gainers: MoverStock[],
  losers: MoverStock[],
  active: MoverStock[],
  limit: number,
): {
  leaders: MoverStock[];
  laggards: MoverStock[];
  mostActive: MoverStock[];
} {
  return {
    leaders: gainers.slice(0, limit),
    laggards: losers.slice(0, limit),
    mostActive: active.slice(0, limit),
  };
}

export function snapshotToMover(stock: {
  symbol: string;
  name?: string;
  price?: number | null;
  changePercent?: number | null;
  volume?: number | null;
}): MoverStock {
  const changePercent = stock.changePercent ?? null;
  const price = stock.price ?? null;
  let change: number | null = null;
  if (price != null && changePercent != null) {
    change = Number(((price * changePercent) / 100).toFixed(4));
  }

  return {
    symbol: stock.symbol,
    name: stock.name ?? stock.symbol,
    price,
    volume: stock.volume ?? null,
    change,
    changePercent,
  };
}
