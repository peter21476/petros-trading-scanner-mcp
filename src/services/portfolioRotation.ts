import { isLeveragedEtf } from "./scoring.js";
import type {
  BestTradeCandidate,
  PortfolioRotationPlan,
  PortfolioSnapshot,
} from "../types/trading.js";

export function buildPortfolioRotationPlan(input: {
  portfolio: PortfolioSnapshot;
  results: BestTradeCandidate[];
  heldSymbols: Set<string>;
}): PortfolioRotationPlan {
  const buyingPower = input.portfolio.buyingPower ?? 0;
  const canBuyNow = buyingPower > 0;

  const heldCandidates = input.results.filter((r) =>
    input.heldSymbols.has(r.symbol),
  );
  const topNew = input.results.find(
    (r) => !input.heldSymbols.has(r.symbol) && r.suggestedAction === "buy_watch",
  );

  const weakestHeld = [...heldCandidates]
    .filter((c) => c.suggestedAction === "trim" || c.suggestedAction === "avoid")
    .sort((a, b) => a.convictionScore - b.convictionScore)[0];

  const positionsToAvoidAdding = input.results
    .filter(
      (r) =>
        input.heldSymbols.has(r.symbol) &&
        (r.suggestedAction === "avoid" ||
          r.suggestedAction === "trim" ||
          isLeveragedEtf(r.symbol)),
    )
    .map((r) => r.symbol);

  const positionsToConsiderSelling = weakestHeld ? [weakestHeld.symbol] : [];

  const rotationCandidates: PortfolioRotationPlan["rotationCandidates"] = [];
  if (weakestHeld && topNew && weakestHeld.convictionScore + 15 < topNew.convictionScore) {
    rotationCandidates.push({
      sellSymbol: weakestHeld.symbol,
      buySymbol: topNew.symbol,
      reason: `${topNew.symbol} has higher conviction (${topNew.convictionScore}) and ${isLeveragedEtf(weakestHeld.symbol) ? "lower leverage risk than" : "stronger setup than"} ${weakestHeld.symbol} (${weakestHeld.convictionScore})`,
    });
  }

  let bestAction: PortfolioRotationPlan["bestAction"] = "no_action";
  let summary = "Review top candidates and verify triggers before acting.";

  if (!canBuyNow) {
    bestAction = "hold_cash";
    summary =
      "No buying power available. Focus is hold/trim/sell decisions on current positions only.";
    if (rotationCandidates.length > 0) {
      bestAction = "rotate_to_best_candidate";
      summary += ` If rotating, ${weakestHeld?.symbol} is the weakest holding vs ${topNew?.symbol}.`;
    } else if (weakestHeld) {
      bestAction = "trim_weakest_position";
      summary += ` Weakest holding: ${weakestHeld.symbol}.`;
    } else {
      bestAction = "hold_current_positions";
    }
  } else if (topNew) {
    bestAction = "rotate_to_best_candidate";
    summary = `Buying power available. Top candidate: ${topNew.symbol} (${topNew.convictionScore}/100). Wait for entry trigger.`;
  }

  return {
    buyingPower,
    canBuyNow,
    positionsToConsiderSelling,
    positionsToAvoidAdding: [...new Set(positionsToAvoidAdding)],
    rotationCandidates,
    bestAction,
    summary,
  };
}
