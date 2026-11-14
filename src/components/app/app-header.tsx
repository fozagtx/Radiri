"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Button, Container, Flex, HStack, Link, Popover, Portal, Text } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { LiveTicker } from "@/components/app/live-ticker";
import { ModeBadge, WalletSection } from "@/components/dashboard/wallet-section";
import { isActive, PRIMARY_NAV } from "@/components/dashboard/nav";
import { RadiriMark } from "@/components/landing/mark";
import { useEvmWallet } from "@/lib/wallets/evm";
import { useNearWallet } from "@/lib/wallets/near";
import { useSolanaWallet } from "@/lib/wallets/solana";

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function WalletMenu() {
  const near = useNearWallet();
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const connected = [near.accountId, evm.address, solana.address].filter((value): value is string => Boolean(value));
  return (
    <Popover.Root positioning={{ placement: "bottom-end" }} lazyMount>
      <Popover.Trigger asChild>
        <Button
          size="sm"
          borderRadius="full"
          px="4"
          variant={connected.length ? "outline" : "solid"}
          bg={connected.length ? "bg.panel" : "ink"}
          color={connected.length ? "fg" : "white"}
          _hover={{ bg: connected.length ? "bg.subtle" : "#2a2a2a" }}
        >
          {connected.length ? (
            <Text as="span">
              {short(connected[0])}
              {connected.length > 1 ? ` +${connected.length - 1}` : ""}
            </Text>
          ) : (
            "Connect wallet"
          )}
          <ChevronDown size={14} aria-hidden />
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content w="80" borderRadius="xl" boxShadow="lift">
            <Popover.Body p="4">
              <WalletSection />
              <Text mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted" textStyle="xs" color="fg.muted">
                Radiri never holds a key. Every action is signed in your wallet.
              </Text>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

function NavLinks({ pathname, scroll }: { pathname: string; scroll?: boolean }) {
  return (
    <HStack gap="1" overflowX={scroll ? "auto" : undefined} px={scroll ? "4" : undefined} pb={scroll ? "3" : undefined}>
      {PRIMARY_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            asChild
            flexShrink={0}
            px="3.5"
            py="1.5"
            borderRadius="full"
            textStyle="sm"
            fontWeight="medium"
            textDecoration="none"
            bg={active ? "ink" : "transparent"}
            color={active ? "white" : "fg.muted"}
            _hover={{ bg: active ? "ink" : "bg.muted", color: active ? "white" : "fg", textDecoration: "none" }}
            aria-current={active ? "page" : undefined}
          >
            <NextLink href={item.href}>{item.label}</NextLink>
          </Link>
        );
      })}
    </HStack>
  );
}

export function AppHeader() {
  const pathname = usePathname() ?? "";
  return (
    <Box as="header" position="sticky" top="0" zIndex="sticky" bg="rgba(251,250,245,0.88)" backdropFilter="blur(12px)" borderBottomWidth="1px" borderColor="border.muted">
      <Container maxW="6xl" px="4">
        <Flex h="16" align="center" gap="4">
          <Link asChild textDecoration="none" _hover={{ textDecoration: "none" }} gap="2" flexShrink={0}>
            <NextLink href="/" aria-label="Radiri home">
              <RadiriMark size={22} />
              <Text as="span" fontWeight="semibold" textStyle="lg" letterSpacing="-0.03em">
                Radiri
              </Text>
            </NextLink>
          </Link>
          <Box flex="1" display={{ base: "none", md: "flex" }} justifyContent="center">
            <NavLinks pathname={pathname} />
          </Box>
          <HStack ml="auto" gap="2">
            <Box display={{ base: "none", lg: "block" }}>
              <ModeBadge />
            </Box>
            <WalletMenu />
          </HStack>
        </Flex>
      </Container>
      <Box display={{ base: "block", md: "none" }}>
        <NavLinks pathname={pathname} scroll />
      </Box>
      <LiveTicker />
    </Box>
  );
}
