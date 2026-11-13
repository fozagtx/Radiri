import { connection } from "next/server";
import { CONTRACT_ID } from "@/lib/config";
import { viewCall } from "@/lib/near";
import type { ApiError, OnchainSnapshot, RouteSource } from "@/lib/radiri/types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SOURCES: RouteSource[] = ["near-intents", "rhea"];

function failure(error: unknown, status = 502): Response {
  const body: ApiError = { error: error instanceof Error ? error.message : String(error) };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function readLimit(value: string | null): number {
  const limit = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function readSource(value: string | null): RouteSource | null {
  return value && SOURCES.includes(value as RouteSource) ? (value as RouteSource) : null;
}

export async function GET(request: Request) {
  // Reads chain state on every request; never prerender or cache it.
  await connection();

  if (!CONTRACT_ID) {
    return failure(
      new Error(
        "NEXT_PUBLIC_CONTRACT_ID is not set, so there is no snapshot contract to read. Deploy contract/ to testnet and set the id.",
      ),
      503,
    );
  }

  const search = new URL(request.url).searchParams;
  const pairIdParam = search.get("pairId");
  const source = readSource(search.get("source"));
  const limit = readLimit(search.get("limit"));

  try {
    if (pairIdParam && source) {
      const history = await viewCall<OnchainSnapshot[]>(CONTRACT_ID, "get_history", {
        pair_id: pairIdParam,
        source,
        limit,
      });
      return Response.json(history, { headers: { "Cache-Control": "no-store" } });
    }

    if (pairIdParam) {
      const latest = await viewCall<OnchainSnapshot | null>(CONTRACT_ID, "get_latest", {
        pair_id: pairIdParam,
        source: null,
      });
      const snapshots: OnchainSnapshot[] = latest ? [latest] : [];
      return Response.json(snapshots, { headers: { "Cache-Control": "no-store" } });
    }

    const fromIndexRaw = Number(search.get("fromIndex") ?? 0);
    const fromIndex = Number.isInteger(fromIndexRaw) && fromIndexRaw >= 0 ? fromIndexRaw : 0;
    const snapshots = await viewCall<OnchainSnapshot[]>(CONTRACT_ID, "get_all_latest", { from_index: fromIndex, limit });
    return Response.json(snapshots, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
