import { connection } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { databaseState, getDb } from "@/lib/db";
import { getSwapStatusWithQuote } from "@/lib/intents/swap";

/**
 * Optional PostgreSQL index of swaps started from Radiri. INDEXING ONLY, never a source of truth.
 *
 * GET  /api/transactions[?depositAddress=][&address=][&limit=50]
 *   -> { enabled: false, reason } without DATABASE_URL
 *   -> { enabled: true, swaps: [...] }
 * POST /api/transactions  { depositAddress, depositMemo?, depositTxHash? }
 *   The server re-reads the swap from the 1Click status API and stores what 1Click reports (its signed
 *   quoteResponse and status), never amounts supplied by the client.
 *   -> { enabled: false, reason } | { enabled: true, swap }
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const RecordBody = z.object({
  depositAddress: z.string().trim().min(1).max(256),
  depositMemo: z.string().trim().max(256).nullish(),
  depositTxHash: z.string().trim().max(256).nullish(),
});

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  await connection();
  const state = databaseState();
  if (!state.enabled) return noStore(state);

  const search = new URL(request.url).searchParams;
  const depositAddress = search.get("depositAddress")?.trim() || undefined;
  const address = search.get("address")?.trim() || undefined;
  const limitRaw = Number(search.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const db = await getDb();
    if (!db) return noStore(databaseState());
    const swaps = await db.swapTransaction.findMany({
      where: {
        ...(depositAddress ? { depositAddress } : {}),
        ...(address ? { OR: [{ recipient: address }, { refundTo: address }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { events: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
    return noStore({ enabled: true, swaps });
  } catch (error) {
    return noStore({ enabled: true, error: `database read failed: ${message(error)}` }, 502);
  }
}

export async function POST(request: Request) {
  await connection();
  const state = databaseState();
  if (!state.enabled) return noStore(state);

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return noStore({ enabled: true, error: `request body must be JSON: ${message(error)}` }, 400);
  }
  const parsed = RecordBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return noStore({ enabled: true, error: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid body" }, 400);
  }
  const depositAddress = parsed.data.depositAddress;
  const depositMemo = parsed.data.depositMemo || "";
  const depositTxHash = parsed.data.depositTxHash || null;

  let confirmed: Awaited<ReturnType<typeof getSwapStatusWithQuote>>;
  try {
    confirmed = await getSwapStatusWithQuote(depositAddress, depositMemo || undefined);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return noStore({ enabled: true, error: `1Click does not confirm this swap: ${message(error)}` }, typeof status === "number" ? status : 502);
  }

  const quoteResponse = confirmed.raw.quoteResponse;
  const quoteRequest = quoteResponse?.quoteRequest;
  const quote = quoteResponse?.quote;
  if (!quoteRequest || !quote) {
    return noStore({ enabled: true, error: "1Click status carried no quoteResponse for this deposit address" }, 502);
  }
  const deadline = quoteRequest.deadline ? new Date(quoteRequest.deadline) : null;
  const status = confirmed.status.status;

  try {
    const db = await getDb();
    if (!db) return noStore(databaseState());
    const existing = await db.swapTransaction.findUnique({
      where: { depositAddress_depositMemo: { depositAddress, depositMemo } },
      select: { id: true, lastStatus: true, depositTxHash: true },
    });
    const data = {
      originAssetId: quoteRequest.originAsset,
      destinationAssetId: quoteRequest.destinationAsset,
      amountInBase: quote.amountIn,
      amountOutBase: quote.amountOut ?? null,
      minAmountOutBase: quote.minAmountOut ?? null,
      recipient: quoteRequest.recipient,
      refundTo: quoteRequest.refundTo,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      lastStatus: status,
      quoteResponse: quoteResponse as unknown as Prisma.InputJsonValue,
      correlationId: confirmed.raw.correlationId ?? null,
      ...(depositTxHash ? { depositTxHash } : {}),
    };
    const swap = await db.swapTransaction.upsert({
      where: { depositAddress_depositMemo: { depositAddress, depositMemo } },
      create: { depositAddress, depositMemo, ...data },
      update: data,
    });
    const events: Prisma.TransactionEventCreateManyInput[] = [];
    if (!existing || existing.lastStatus !== status) {
      events.push({ swapId: swap.id, kind: "status", status, payload: { updatedAt: confirmed.status.updatedAt } });
    }
    if (depositTxHash && existing?.depositTxHash !== depositTxHash) {
      events.push({ swapId: swap.id, kind: "deposit_submitted", txHash: depositTxHash });
    }
    if (events.length) await db.transactionEvent.createMany({ data: events });
    return noStore({ enabled: true, swap });
  } catch (error) {
    return noStore({ enabled: true, error: `database write failed: ${message(error)}` }, 502);
  }
}
