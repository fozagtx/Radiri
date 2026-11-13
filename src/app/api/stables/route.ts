import { connection } from "next/server";
import { getStableAssets } from "@/lib/radiri/catalog";
import type { ApiError, StableAsset } from "@/lib/radiri/types";

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 502;
}

export async function GET() {
  // Live upstream data: force request-time rendering. Next 16 replaced
  // `export const dynamic = "force-dynamic"` with `connection()`.
  await connection();

  try {
    const assets: StableAsset[] = await getStableAssets();
    const body: StableAsset[] = assets;
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const body: ApiError = { error: error instanceof Error ? error.message : String(error) };
    return Response.json(body, { status: statusOf(error), headers: { "Cache-Control": "no-store" } });
  }
}
