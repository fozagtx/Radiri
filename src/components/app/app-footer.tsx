"use client";

import { Box, Container, Flex, Text } from "@chakra-ui/react";

export function AppFooter() {
  return (
    <Box as="footer" borderTopWidth="1px" borderColor="border.muted" mt="16">
      <Container maxW="6xl" px="4" py="5">
        <Flex direction={{ base: "column", sm: "row" }} justify="space-between" gap="1" textStyle="xs" color="fg.muted">
          <Text>Lending runs on NEAR testnet with test tokens that have no value.</Text>
          <Text>Swaps settle on mainnet through NEAR Intents.</Text>
        </Flex>
      </Container>
    </Box>
  );
}
