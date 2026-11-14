"use client";

import { Badge, Flex, Link, Text } from "@chakra-ui/react";
import { FlaskConical } from "lucide-react";
import { EXPLORER_URL, LENDING_CONTRACT_ID } from "@/lib/config";

/** One-line note on the lending pages: live NEAR testnet contract, test tokens with no value. */
export function ModeBanner() {
  return (
    <Flex mb="5" wrap="wrap" align="center" gap="2" textStyle="xs" color="fg.muted">
      <Badge colorPalette="green" variant="subtle" borderRadius="full" gap="1.5">
        <span className="radiri-live-dot size-1.5 rounded-full bg-emerald-600" aria-hidden />
        Live on NEAR testnet
      </Badge>
      <Link href={`${EXPLORER_URL}/address/${LENDING_CONTRACT_ID}`} target="_blank" rel="noreferrer" fontFamily="mono" color="fg.muted">
        {LENDING_CONTRACT_ID}
      </Link>
      <Text as="span" display="inline-flex" alignItems="center" gap="1">
        <FlaskConical size={12} aria-hidden />
        Test tokens with no value, priced at their real meme coin and stock references
      </Text>
    </Flex>
  );
}
