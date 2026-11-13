import type { MatrixCell, Opportunity, RouteFailure, RouteQuote, RouteSource } from "./types";

/** Any route above this cost is flagged as expensive. */
const EXPENSIVE_BPS = 25;
/** Same stable pair quoted through different chains must differ by this much to be a spread. */
const SPREAD_BPS = 20;
/** Two sources must disagree by this much on the same pair to be flagged. */
const DIVERGENCE_BPS = 10;

const SEVERITY_RANK: Record<Opportunity["severity"], number> = { high: 0, warn: 1, info: 2 };

const SOURCE_LABEL: Record<RouteSource, string> = {
  "near-intents": "NEAR Intents (1Click)",
  rhea: "Rhea Smart Router",
};

function sourceLabel(source: RouteSource): string {
  return SOURCE_LABEL[source] ?? source;
}

export function pairKey(from: { symbol: string; chain: string }, to: { symbol: string; chain: string }): string {
  return `${from.symbol}:${from.chain}>${to.symbol}:${to.chain}`;
}

function routeKey(route: RouteQuote): string {
  return pairKey(route.from, route.to);
}

function bps(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)} bps`;
}

function units(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function widest(group: RouteQuote[]): { cheapest: RouteQuote; priciest: RouteQuote; spread: number } | null {
  if (group.length < 2) return null;
  let cheapest = group[0];
  let priciest = group[0];
  for (const route of group) {
    if (route.costBps < cheapest.costBps) cheapest = route;
    if (route.costBps > priciest.costBps) priciest = route;
  }
  return { cheapest, priciest, spread: priciest.costBps - cheapest.costBps };
}

function sortAndDedupe(opportunities: Opportunity[]): Opportunity[] {
  const seen = new Set<string>();
  const unique = opportunities.filter((item) => {
    const key = `${item.kind}|${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Math.abs(b.metricBps ?? 0) - Math.abs(a.metricBps ?? 0),
  );
}

/**
 * Derives every flag Radiri shows from real quote data: which source has a
 * liquidity gap another source fills, which route is expensive, where the same
 * stable pair is cheaper on another chain, and where two sources disagree.
 */
export function deriveOpportunities(routes: RouteQuote[], failures: RouteFailure[]): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const routesByPair = groupBy(routes, routeKey);

  for (const failure of failures) {
    if (failure.kind !== "no-liquidity") continue;
    const filled = routesByPair.get(pairKey(failure.from, failure.to));
    if (!filled?.length) continue;
    const best = filled[0];
    opportunities.push({
      kind: "liquidity-gap",
      severity: "high",
      title: `${sourceLabel(failure.source)} has no route for ${failure.from.symbol} ${failure.from.chain} to ${failure.to.symbol} ${failure.to.chain}`,
      detail: `${sourceLabel(failure.source)} answered "${failure.reason}" for ${units(best.amountIn)} ${failure.from.symbol}. ${sourceLabel(
        best.source,
      )} fills the same pair at ${units(best.amountOut)} ${best.to.symbol} (${bps(best.costBps)}).`,
      from: { symbol: failure.from.symbol, chain: failure.from.chain },
      to: { symbol: failure.to.symbol, chain: failure.to.chain },
      metricBps: best.costBps,
    });
  }

  for (const route of routes) {
    if (route.costBps <= EXPENSIVE_BPS) continue;
    opportunities.push({
      kind: "expensive-route",
      severity: route.costBps >= 100 ? "high" : "warn",
      title: `${sourceLabel(route.source)} charges ${bps(route.costBps)} on ${route.from.symbol} ${route.from.chain} to ${route.to.symbol} ${route.to.chain}`,
      detail: `${units(route.amountIn)} ${route.from.symbol} yields ${units(route.amountOut)} ${route.to.symbol}; worst case at ${route.slippageBps} bps slippage is ${units(
        route.minAmountOut,
      )} ${route.to.symbol} (${bps(route.worstCaseCostBps)}).`,
      from: { symbol: route.from.symbol, chain: route.from.chain },
      to: { symbol: route.to.symbol, chain: route.to.chain },
      metricBps: route.costBps,
    });
  }

  const bySymbolPair = groupBy(routes, (route) => `${route.from.symbol}>${route.to.symbol}`);
  for (const group of bySymbolPair.values()) {
    if (new Set(group.map((route) => `${route.from.chain}>${route.to.chain}`)).size < 2) continue;
    const widestPair = widest(group);
    if (!widestPair || widestPair.spread < SPREAD_BPS) continue;
    const { cheapest, priciest, spread } = widestPair;
    opportunities.push({
      kind: "cross-chain-spread",
      severity: spread >= 50 ? "high" : "warn",
      title: `${cheapest.from.symbol} to ${cheapest.to.symbol} is ${bps(spread)} cheaper on ${cheapest.from.chain} than on ${priciest.from.chain}`,
      detail: `${cheapest.from.chain} to ${cheapest.to.chain} returns ${units(cheapest.amountOut)} ${cheapest.to.symbol} (${bps(
        cheapest.costBps,
      )}), while ${priciest.from.chain} to ${priciest.to.chain} returns ${units(priciest.amountOut)} ${priciest.to.symbol} (${bps(priciest.costBps)}).`,
      from: { symbol: priciest.from.symbol, chain: priciest.from.chain },
      to: { symbol: priciest.to.symbol, chain: priciest.to.chain },
      metricBps: spread,
    });
  }

  for (const group of routesByPair.values()) {
    if (new Set(group.map((route) => route.source)).size < 2) continue;
    const widestPair = widest(group);
    if (!widestPair || widestPair.spread < DIVERGENCE_BPS) continue;
    const { cheapest, priciest, spread } = widestPair;
    opportunities.push({
      kind: "source-divergence",
      severity: spread >= 25 ? "warn" : "info",
      title: `${sourceLabel(cheapest.source)} and ${sourceLabel(priciest.source)} differ by ${bps(spread)} on ${cheapest.from.symbol} ${cheapest.from.chain} to ${cheapest.to.symbol} ${cheapest.to.chain}`,
      detail: `${sourceLabel(cheapest.source)} returns ${units(cheapest.amountOut)} ${cheapest.to.symbol}, ${sourceLabel(
        priciest.source,
      )} returns ${units(priciest.amountOut)} ${priciest.to.symbol} for the same ${units(cheapest.amountIn)} ${cheapest.from.symbol}.`,
      from: { symbol: cheapest.from.symbol, chain: cheapest.from.chain },
      to: { symbol: cheapest.to.symbol, chain: cheapest.to.chain },
      metricBps: spread,
    });
  }

  return sortAndDedupe(opportunities);
}

/** Same derivation across every quoted cell of a matrix sweep. */
export function deriveMatrixOpportunities(cells: MatrixCell[]): Opportunity[] {
  const routes: RouteQuote[] = [];
  const failures: RouteFailure[] = [];
  for (const cell of cells) {
    if (cell.best) routes.push(cell.best);
    for (const failure of cell.failures) failures.push(failure);
  }
  return deriveOpportunities(routes, failures);
}
