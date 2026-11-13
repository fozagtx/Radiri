import { connection } from "next/server";
import { buildMatrix } from "@/lib/radiri/engine";
import type { ApiError, MatrixResponse, PairRef } from "@/lib/radiri/types";

interface MatrixBody {
  amount?: number;
  slippageBps?: number;
  pairs?: { from: PairRef; to: PairRef }[];
  concurrency?: number;
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 502;
}

function failure(error: unknown): Response {
  const body: ApiError = { error: error instanceof Error ? error.message : String(error) };
  return Response.json(body, { status: statusOf(error) });
}

export async function POST(request: Request) {
  let body: MatrixBody;
  try {
    body = (await request.json()) as MatrixBody;
  } catch (error) {
    return Response.json(
      { error: `Request body must be JSON: ${error instanceof Error ? error.message : String(error)}` } satisfies ApiError,
      { status: 400 },
    );
  }

  try {
    const result: MatrixResponse = await buildMatrix({
      amount: Number(body.amount),
      slippageBps: body.slippageBps === undefined ? undefined : Number(body.slippageBps),
      pairs: body.pairs,
      concurrency: body.concurrency,
    });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}

/** Convenience GET: /api/matrix?amount=10000&slippageBps=50 */
export async function GET(request: Request) {
  await connection();

  const search = new URL(request.url).searchParams;
  const amount = Number(search.get("amount") ?? "10000");
  const slippageRaw = search.get("slippageBps");
  const slippageBps = slippageRaw === null ? undefined : Number(slippageRaw);

  try {
    const result = await buildMatrix({ amount, slippageBps });
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
