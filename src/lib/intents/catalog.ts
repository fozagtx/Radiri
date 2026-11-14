import "server-only";

import { buildCatalog, loadLendingRegistry, type LendingRegistry } from "@/config/assets";
import type { CatalogAsset } from "@/types/protocol";
import { getOneClickTokens } from "./tokens";

/** Classified catalog: live 1Click assets plus lending-registry assets, each with independent eligibility. */
export interface ClassifiedCatalog {
  assets: CatalogAsset[];
  fetchedAt: string;
  lending: Pick<LendingRegistry, "source" | "contractId" | "error">;
}

const REGISTRY_TTL_MS = 30_000;
let registryCache: { at: number; registry: LendingRegistry } | null = null;

async function getRegistry(): Promise<LendingRegistry> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) return registryCache.registry;
  const registry = await loadLendingRegistry();
  // Do not cache a failed contract read; retry on the next request.
  if (!registry.error) registryCache = { at: Date.now(), registry };
  return registry;
}

export async function getClassifiedCatalog(): Promise<ClassifiedCatalog> {
  const [{ tokens, fetchedAt }, registry] = await Promise.all([getOneClickTokens(), getRegistry()]);
  return {
    assets: buildCatalog(tokens, registry),
    fetchedAt,
    lending: {
      source: registry.source,
      contractId: registry.contractId,
      ...(registry.error ? { error: registry.error } : {}),
    },
  };
}

/** Swap-eligible asset by 1Click asset id (present in the live 1Click catalog right now). */
export async function findSwapAsset(assetId: string): Promise<CatalogAsset | null> {
  const { assets } = await getClassifiedCatalog();
  return assets.find((asset) => asset.id === assetId && asset.eligibility.swap) ?? null;
}
