import { connection } from "next/server";
import { getStableAssets } from "@/lib/radiri/catalog";
import { buildMatrix, compareRoutes } from "@/lib/radiri/engine";
import type { PairRef } from "@/lib/radiri/types";

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

  throw new Error(`Unknown tool: ${name}`);
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
        "Radiri compares stablecoin swap routes on NEAR. Quotes are dry runs from live sources: NEAR Intents 1Click across chains and the Rhea Smart Router on NEAR.",
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
