"use client";

import { Clipboard, HStack, IconButton, Text } from "@chakra-ui/react";

/** Read-only value with a copy button (Chakra Clipboard). */
export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <Clipboard.Root value={value}>
      <HStack gap="2" px="3" py="2" borderWidth="1px" borderColor="border" bg="bg.subtle" borderRadius="xl">
        {label ? (
          <Text textStyle="xs" color="fg.muted" flexShrink={0} minW="20">
            {label}
          </Text>
        ) : null}
        <Text fontFamily="mono" textStyle="xs" flex="1" minW="0" overflowX="auto" whiteSpace="nowrap">
          {value}
        </Text>
        <Clipboard.Trigger asChild>
          <IconButton size="xs" variant="surface" borderRadius="full" aria-label={label ? `Copy ${label}` : "Copy"}>
            <Clipboard.Indicator />
          </IconButton>
        </Clipboard.Trigger>
      </HStack>
    </Clipboard.Root>
  );
}
