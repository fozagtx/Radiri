import { connection } from "next/server";
import { isAssetCategory, isEligibilityFilter, filterCatalog } from "@/config/assets";
import { getClassifiedCatalog } from "@/lib/intents/catalog";
import type { CatalogAsset } from "@/types/protocol";

/**
 * GET /api/assets[?category=meme|stock|stable|major|rwa|other][&eligible=swap|collateral|borrow]
 * -> { assets: CatalogAsset[]; fetchedAt: string; lending: { source, contractId, error? } }
 *
 * Live 1Click catalog (incl. Ondo tokenized stocks) classified by category, plus the lending registry's
 * assets. Eligibility flags are independent: swap = live in 1Click, collateral/borrow = lending registry.
 */
export async function GET(request: Request) {
  // Live upstream data: request-time rendering, never prerendered.
  await connection();

  const search = new URL(request.url).searchParams;
  const category = search.get("category");
  const eligible = search.get("eligible");
  if (category && !isAssetCategory(category)) {
    return Response.json(
      { error: `category must be one of meme, stock, stable, major, rwa, other; got "${category}"` },
      { status: 400 },
    );
  }
  if (eligible && !isEligibilityFilter(eligible)) {
    return Response.json({ error: `eligible must be one of swap, collateral, borrow; got "${eligible}"` }, { status: 400 });
  }

  try {
    const catalog = await getClassifiedCatalog();
    const assets: CatalogAsset[] = filterCatalog(catalog.assets, {
      category: category && isAssetCategory(category) ? category : null,
      eligible: eligible && isEligibilityFilter(eligible) ? eligible : null,
    });
    return Response.json(
      { assets, fetchedAt: catalog.fetchedAt, lending: catalog.lending },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: `asset catalog unavailable: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
