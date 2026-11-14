"use client";

import { HStack, RadioCard, SimpleGrid, Text } from "@chakra-ui/react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { referenceOf } from "@/components/shared/format";
import type { AssetView } from "@/types/protocol";

export interface PickerOption {
  asset: AssetView;
  /** Secondary line (balance, APR, liquidity ...). */
  detail: React.ReactNode;
  /** Why it cannot be chosen, if it cannot. */
  disabledReason?: string | null;
}

/** Chakra RadioCard group of assets. Disabled options stay visible with their reason. */
export function AssetPicker({ label, options, value, onChange }: { label: string; options: PickerOption[]; value: string | null; onChange: (tokenId: string) => void }) {
  if (options.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No assets in this category on the lending contract.
      </Text>
    );
  }
  return (
    <RadioCard.Root value={value} onValueChange={(details) => details.value && onChange(details.value)} size="sm" variant="surface" colorPalette="gray" aria-label={label}>
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="2">
        {options.map(({ asset, detail, disabledReason }) => {
          const reference = referenceOf(asset.config.token_id);
          return (
            <RadioCard.Item key={asset.config.token_id} value={asset.config.token_id} disabled={!!disabledReason} borderRadius="xl" title={disabledReason ?? undefined}>
              <RadioCard.ItemHiddenInput />
              <RadioCard.ItemControl alignItems="center" gap="3">
                <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size="md" />
                <RadioCard.ItemContent gap="0">
                  <HStack gap="1.5">
                    <RadioCard.ItemText fontWeight="semibold">{asset.config.symbol}</RadioCard.ItemText>
                    {reference ? (
                      <Text textStyle="xs" color="fg.muted">
                        {reference.symbol}
                      </Text>
                    ) : null}
                  </HStack>
                  <RadioCard.ItemDescription fontFamily="mono" textStyle="xs" truncate>
                    {disabledReason ?? detail}
                  </RadioCard.ItemDescription>
                </RadioCard.ItemContent>
                <RadioCard.ItemIndicator />
              </RadioCard.ItemControl>
            </RadioCard.Item>
          );
        })}
      </SimpleGrid>
    </RadioCard.Root>
  );
}
