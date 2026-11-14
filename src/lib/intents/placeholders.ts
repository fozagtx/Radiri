import { chainFamily } from "./chains";

/**
 * Placeholder addresses for DRY (indicative) quotes only. 1Click validates the recipient format for
 * the destination chain and the refund format for the origin chain before it prices a dry quote.
 * A dry quote returns no deposit address, so nothing can ever be sent to these. Live quotes always
 * require the user's own addresses.
 */
const EVM_PLACEHOLDER = "0x1111111111111111111111111111111111111111";
const SOLANA_PLACEHOLDER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NEAR_PLACEHOLDER = "0000000000000000000000000000000000000000000000000000000000000001";

export function dryRunPlaceholder(chain: string): string | null {
  switch (chainFamily(chain)) {
    case "evm":
      return EVM_PLACEHOLDER;
    case "solana":
      return SOLANA_PLACEHOLDER;
    case "near":
      return NEAR_PLACEHOLDER;
    default:
      return null;
  }
}
