import { connection } from "next/server";
import { compareRoutes } from "@/lib/radiri/engine";
import type { ApiError, CompareRequest, CompareResponse, PairRef } from "@/lib/radiri/types";

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 502;
}

function failure(error: unknown): Response {
  const body: ApiError = { error: error instanceof Error ? error.message : String(error) };
  return Response.json(body, { status: statusOf(error) });
}

function parsePair(value: string | null): PairRef | null {
  if (!value) return null;
  const [symbol, chain] = value.split(":");
  if (!symbol?.trim() || !chain?.trim()) return null;
  return { symbol: symbol.trim(), chain: chain.trim() };
}

function pairFrom(search: URLSearchParams, prefix: "from" | "to"): PairRef | null {
  const compact = parsePair(search.get(prefix));
  if (compact) return compact;
  const symbol = search.get(`${prefix}Symbol`);
  const chain = search.get(`${prefix}Chain`);
  return symbol?.trim() && chain?.trim() ? { symbol: symbol.trim(), chain: chain.trim() } : null;
}

export async function POST(request: Request) {
  let body: CompareRequest;
  try {
    body = (await request.json()) as CompareRequest;
  } catch (error) {
    return Response.json(
      { error: `Request body must be JSON: ${error instanceof Error ? error.message : String(error)}` } satisfies ApiError,
      { status: 400 },
    );
  }

  try {
    const result: CompareResponse = await compareRoutes(body);
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}

/** Convenience GET: /api/compare?from=USDC:near&to=USDT:near&amount=10000&slippageBps=50 */
export async function GET(request: Request) {
  await connection();

  const search = new URL(request.url).searchParams;
  const from = pairFrom(search, "from");
  const to = pairFrom(search, "to");
  if (!from || !to) {
    return Response.json({ error: "from and to are required, e.g. from=USDC:near&to=USDT:near" } satisfies ApiError, {
      status: 400,
    });
  }

  const amount = Number(search.get("amount") ?? "10000");
  const slippageRaw = search.get("slippageBps");
  const slippageBps = slippageRaw === null ? undefined : Number(slippageRaw);

  try {
    const result = await compareRoutes({ from, to, amount, slippageBps });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
