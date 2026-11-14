import { connection } from "next/server";
import { filterCatalog, isAssetCategory, isEligibilityFilter } from "@/config/assets";
import { getClassifiedCatalog } from "@/lib/intents/catalog";
import { quoteSwap } from "@/lib/intents/swap";
import { getStableAssets } from "@/lib/radiri/catalog";
import { buildMatrix, compareRoutes } from "@/lib/radiri/engine";
import type { PairRef } from "@/lib/radiri/types";
import type { CatalogAsset } from "@/types/protocol";

const PROTOCOL_VERSION = "2025-06-18";

const PAIR_SCHEMA = {
  type: "object",
  properties: {
    symbol: { type: "string", description: "Stablecoin symbol, e.g. USDC" },
    chain: { type: "string", description: "1Click chain id, e.g. near, eth, arb, base, sol" },
  },
  required: ["symbol", "chain"],
  additionalProperties: false,
} as const;

const ASSET_REF_SCHEMA = {
  type: "object",
  description: "Either { assetId } (1Click asset id) or { symbol, chain } (e.g. PEPE on eth, AAPLon on bsc)",
  properties: {
    assetId: { type: "string", description: "1Click asset id, e.g. nep141:eth-0x6982...omft.near" },
    symbol: { type: "string", description: "Symbol, e.g. PEPE, $WIF, AAPLon, XAUT" },
    chain: { type: "string", description: "1Click chain id, e.g. eth, sol, base, bsc, near" },
  },
  additionalProperties: false,
} as const;

const TOOLS = [
  {
    name: "compare_routes",
    title: "Compare stablecoin routes",
    description:
      "Quote every known source (NEAR Intents 1Click, Rhea Smart Router) for one stablecoin pair and size. Returns ranked routes with cost in basis points, worst case, fees, ETA, plus verbatim failures and derived opportunities.",
    inputSchema: {
      type: "object",
      properties: {
        from: PAIR_SCHEMA,
        to: PAIR_SCHEMA,
        amount: { type: "number", description: "Human units of the from token, e.g. 100000" },
        slippageBps: { type: "integer", minimum: 0, maximum: 5000, description: "Slippage tolerance, default 50" },
      },
      required: ["from", "to", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "liquidity_matrix",
    title: "Stablecoin liquidity matrix",
    description:
      "Quote a sweep of stablecoin pairs at one size and return every best route, failure and opportunity (liquidity gaps, cross-chain spreads, source divergence).",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Human units per pair, e.g. 100000" },
        slippageBps: { type: "integer", minimum: 0, maximum: 5000 },
      },
      required: ["amount"],
      additionalProperties: false,
    },
  },
  {
    name: "list_stablecoins",
    title: "List stablecoins",
    description: "List every stablecoin Radiri can quote, with 1Click asset id, chain, decimals and USD price.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_assets",
    title: "List classified assets",
    description:
      "List the live NEAR Intents 1Click catalog (meme coins, Ondo tokenized stocks, stables, majors, RWAs) plus Radiri lending assets. Each asset has a category and independent eligibility flags: swap (live in 1Click), collateral and borrow (Radiri lending registry). Testnet test tokens are flagged isTestToken.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["meme", "stock", "stable", "major", "rwa", "other"] },
        eligible: { type: "string", enum: ["swap", "collateral", "borrow"] },
        query: { type: "string", description: "Case-insensitive symbol or name filter, e.g. PEPE or apple" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "quote_swap",
    title: "Quote a cross-chain swap (dry run)",
    description:
      "Indicative (dry) NEAR Intents 1Click quote for a cross-chain swap, e.g. a meme coin into a tokenized stock. Never returns a deposit address and never moves funds. Returns amount out, minimum out, USD values, fees and ETA, or 1Click's verbatim failure reason (e.g. 'No liquidity available').",
    inputSchema: {
      type: "object",
      properties: {
        from: ASSET_REF_SCHEMA,
        to: ASSET_REF_SCHEMA,
        amount: { type: "string", description: "Human units of the from asset as a decimal string, e.g. \"10000000\"" },
        slippageBps: { type: "integer", minimum: 0, maximum: 5000, description: "Slippage tolerance, default 100" },
      },
      required: ["from", "to", "amount"],
      additionalProperties: false,
    },
  },
];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function ok(id: RpcRequest["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: RpcRequest["id"], code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 200 });
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "compare_routes") {
    const from = args.from as PairRef | undefined;
    const to = args.to as PairRef | undefined;
    if (!from || !to) throw new Error("from and to are required, each { symbol, chain }");
    return compareRoutes({
      from,
      to,
      amount: Number(args.amount),
      slippageBps: args.slippageBps === undefined ? undefined : Number(args.slippageBps),
    });
  }

  if (name === "liquidity_matrix") {
    return buildMatrix({
      amount: Number(args.amount),
      slippageBps: args.slippageBps === undefined ? undefined : Number(args.slippageBps),
    });
  }

  if (name === "list_stablecoins") {
    const assets = await getStableAssets();
    return { count: assets.length, assets };
  }

  if (name === "list_assets") {
    const category = typeof args.category === "string" ? args.category : null;
    const eligible = typeof args.eligible === "string" ? args.eligible : null;
    if (category && !isAssetCategory(category)) throw new Error(`category must be one of meme, stock, stable, major, rwa, other`);
    if (eligible && !isEligibilityFilter(eligible)) throw new Error(`eligible must be one of swap, collateral, borrow`);
    const catalog = await getClassifiedCatalog();
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const assets = filterCatalog(catalog.assets, {
      category: category && isAssetCategory(category) ? category : null,
      eligible: eligible && isEligibilityFilter(eligible) ? eligible : null,
    }).filter(
      (asset) => !query || asset.symbol.toLowerCase().includes(query) || (asset.name ?? "").toLowerCase().includes(query),
    );
    return { count: assets.length, fetchedAt: catalog.fetchedAt, lending: catalog.lending, assets };
  }

  if (name === "quote_swap") {
    const catalog = await getClassifiedCatalog();
    const origin = resolveAssetRef(catalog.assets, args.from, "from");
    const destination = resolveAssetRef(catalog.assets, args.to, "to");
    if (typeof args.amount !== "string" && typeof args.amount !== "number") throw new Error("amount is required");
    // Dry only: this tool can never produce a deposit address.
    return quoteSwap({
      originAssetId: origin.id,
      destinationAssetId: destination.id,
      amount: String(args.amount),
      slippageBps: args.slippageBps === undefined ? 100 : Number(args.slippageBps),
      dry: true,
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function resolveAssetRef(assets: CatalogAsset[], ref: unknown, label: string): CatalogAsset {
  const value = (ref && typeof ref === "object" ? ref : {}) as { assetId?: unknown; symbol?: unknown; chain?: unknown };
  const swappable = assets.filter((asset) => asset.eligibility.swap);
  if (typeof value.assetId === "string" && value.assetId) {
    const match = swappable.find((asset) => asset.id === value.assetId);
    if (!match) throw new Error(`${label}: ${value.assetId} is not in the live 1Click catalog`);
    return match;
  }
  if (typeof value.symbol !== "string" || !value.symbol) throw new Error(`${label} needs { assetId } or { symbol, chain }`);
  const symbol = value.symbol.trim().toUpperCase();
  const chain = typeof value.chain === "string" ? value.chain.trim().toLowerCase() : "";
  const matches = swappable.filter((asset) => asset.symbol.toUpperCase() === symbol && (!chain || asset.chain === chain));
  if (matches.length === 0) throw new Error(`${label}: no ${value.symbol}${chain ? ` on ${chain}` : ""} in the live 1Click catalog`);
  if (matches.length > 1) {
    throw new Error(`${label}: ${value.symbol} is listed on ${matches.map((asset) => asset.chain).join(", ")}; pass chain`);
  }
  return matches[0];
}

export async function POST(request: Request) {
  await connection();

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return fail(null, -32700, "Parse error: body must be JSON-RPC 2.0");
  }

  const { id, method, params } = body;

  if (!method) return fail(id, -32600, "Invalid request: method is required");

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "radiri", version: "0.1.0" },
      instructions:
        "Radiri compares stablecoin swap routes on NEAR and quotes cross-chain swaps (meme coins, tokenized stocks) through NEAR Intents 1Click. Every quote here is a dry run from live sources: no deposit address, no funds move. Use list_assets to find asset ids, quote_swap for a cross-chain swap quote, compare_routes for stablecoin routes.",
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202 });
  }

  if (method === "ping") return ok(id, {});

  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    if (!name) return fail(id, -32602, "Invalid params: tool name is required");
    try {
      const result = await callTool(name, params?.arguments ?? {});
      return ok(id, toolResult(result));
    } catch (error) {
      return ok(id, toolResult({ error: error instanceof Error ? error.message : String(error) }, true));
    }
  }

  return fail(id, -32601, `Method not found: ${method}`);
}

export function GET() {
  return Response.json(
    { error: "This MCP endpoint accepts JSON-RPC 2.0 over POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
