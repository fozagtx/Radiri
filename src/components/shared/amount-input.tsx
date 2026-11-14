"use client";

import { Button, Field, Flex, HStack, Input, InputGroup, Text } from "@chakra-ui/react";
import { formatTokenAmount, formatUnits, type MaxAmount, parseUnits } from "@/lib/risk";

const LIMITER_LABEL: Record<MaxAmount["limitedBy"], string> = {
  wallet: "wallet balance",
  health: "borrow limit",
  liquidity: "pool liquidity",
  cap: "protocol cap",
  position: "your position",
  blocked: "blocked",
  none: "",
};

/** Validates a typed amount exactly against the token's decimals. Null = no error. */
export function amountError(input: string, decimals: number): string | null {
  if (input.trim() === "") return null;
  try {
    parseUnits(input, decimals);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function AmountInput({
  id,
  label,
  value,
  onChange,
  decimals,
  symbol,
  max,
  balance,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimals: number;
  symbol: string;
  max?: MaxAmount | null;
  balance?: { label: string; amount: bigint | null } | null;
  disabled?: boolean;
}) {
  const error = amountError(value, decimals);
  const canMax = !!max && max.amount > BigInt(0) && !disabled;
  return (
    <Field.Root invalid={!!error} disabled={disabled}>
      <Flex w="full" justify="space-between" align="center" gap="2">
        <Field.Label htmlFor={id} textStyle="xs" color="fg.muted" fontWeight="medium" textTransform="uppercase" letterSpacing="0.06em">
          {label}
        </Field.Label>
        {balance ? (
          <Text fontFamily="mono" textStyle="xs" color="fg.muted" truncate>
            {balance.label}: {balance.amount === null ? "n/a" : `${formatTokenAmount(balance.amount, decimals)} ${symbol}`}
          </Text>
        ) : null}
      </Flex>
      <HStack w="full" gap="2">
        <InputGroup flex="1" endElement={<Text fontFamily="mono" textStyle="xs" color="fg.muted">{symbol}</Text>}>
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            size="md"
            fontFamily="mono"
            borderRadius="xl"
            bg="bg.panel"
          />
        </InputGroup>
        <Button size="md" variant="outline" borderRadius="xl" disabled={!canMax} onClick={() => max && onChange(formatUnits(max.amount, decimals))}>
          Max
        </Button>
      </HStack>
      {error ? (
        <Field.ErrorText textStyle="xs">{error}</Field.ErrorText>
      ) : max ? (
        <Field.HelperText fontFamily="mono" textStyle="xs">
          {max.limitedBy === "blocked"
            ? "Max 0: blocked (see reasons)"
            : `Max ${formatTokenAmount(max.amount, decimals)} ${symbol}${LIMITER_LABEL[max.limitedBy] ? ` · ${LIMITER_LABEL[max.limitedBy]}` : ""}`}
        </Field.HelperText>
      ) : null}
    </Field.Root>
  );
}
