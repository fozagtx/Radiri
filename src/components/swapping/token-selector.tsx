"use client";

import { useMemo, useState } from "react";
import { Box, HStack, IconButton, Input, InputGroup, SegmentGroup, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Search } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { chainName } from "@/lib/intents/chains";
import type { CatalogAsset } from "@/types/protocol";

export type SwapCategory = "meme" | "stock";

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(3)}`;
}

/** Only meme coins and tokenized stocks are offered: this product swaps between those two. */
export function swappable(assets: CatalogAsset[]): CatalogAsset[] {
  return assets.filter((asset) => asset.category === "meme" || asset.category === "stock");
}

/** Full-card token list: search, meme / stock segments, logos with chain badges, live prices. */
export function TokenSelector({
  title,
  assets,
  initialCategory,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string;
  assets: CatalogAsset[];
  initialCategory: SwapCategory;
  selectedId: string | null;
  onSelect: (asset: CatalogAsset) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<SwapCategory>(initialCategory);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return swappable(assets)
      .filter((asset) => asset.category === category)
      .filter((asset) => !q || asset.symbol.toLowerCase().includes(q) || (asset.name ?? "").toLowerCase().includes(q) || chainName(asset.chain).toLowerCase().includes(q))
      .sort((a, b) => (b.priceUsd ? 1 : 0) - (a.priceUsd ? 1 : 0) || a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain));
  }, [assets, category, query]);

  return (
    <Stack gap="3" maxH="min(640px, 80vh)" className="radiri-rise">
      <HStack gap="2">
        <IconButton aria-label="Back to swap" variant="ghost" borderRadius="full" size="sm" onClick={onClose}>
          <ArrowLeft size={18} />
        </IconButton>
        <Text fontWeight="semibold" textStyle="md">
          {title}
        </Text>
      </HStack>
      <InputGroup startElement={<Search size={16} />}>
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker or network" size="lg" borderRadius="xl" />
      </InputGroup>
      <SegmentGroup.Root value={category} onValueChange={(details) => setCategory(details.value === "stock" ? "stock" : "meme")} size="md" w="full">
        <SegmentGroup.Indicator />
        <SegmentGroup.Items flex="1" justifyContent="center" items={[{ value: "meme", label: "Meme coins" }, { value: "stock", label: "Tokenized stocks" }]} />
      </SegmentGroup.Root>
      <Box overflowY="auto" mx="-1" flex="1">
        {rows.length === 0 ? (
          <Text py="6" textAlign="center" textStyle="sm" color="fg.muted">
            No match.
          </Text>
        ) : null}
        {rows.map((asset) => (
          <HStack
            key={asset.id}
            as="button"
            w="full"
            gap="3"
            px="3"
            py="2.5"
            borderRadius="xl"
            textAlign="left"
            bg={asset.id === selectedId ? "bg.muted" : "transparent"}
            _hover={{ bg: "bg.subtle" }}
            onClick={() => onSelect(asset)}
          >
            <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="lg" />
            <Stack gap="0" flex="1" minW="0">
              <Text fontWeight="semibold">{asset.symbol}</Text>
              <Text textStyle="xs" color="fg.muted" truncate>
                {asset.name && asset.name !== asset.symbol ? `${asset.name} · ` : ""}
                {chainName(asset.chain)}
              </Text>
            </Stack>
            <Text fontFamily="mono" textStyle="sm">
              {usd(asset.priceUsd) || "no price"}
            </Text>
          </HStack>
        ))}
      </Box>
    </Stack>
  );
}
