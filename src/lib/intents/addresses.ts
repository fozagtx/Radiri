import { chainFamily } from "./chains";

/**
 * Local address format checks per 1Click chain. A `null` verdict means Radiri has no local rule for
 * that chain and 1Click itself validates the address when quoting (it answers e.g.
 * "recipient is not valid"). Client-safe.
 */
export interface AddressCheck {
  valid: boolean | null;
  reason?: string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const NEAR_NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const MOVE_ADDRESS = /^0x[0-9a-fA-F]{64}$/;
const BTC_ADDRESS = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;

/** Decoded byte length of a base58 string, or null when it contains a non-base58 character. */
export function base58ByteLength(value: string): number | null {
  if (!value) return null;
  let bytes: number[] = [0];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  bytes = bytes.reverse();
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === "1") leadingZeros += 1;
  const firstNonZero = bytes.findIndex((byte) => byte !== 0);
  const significant = firstNonZero < 0 ? 0 : bytes.length - firstNonZero;
  return leadingZeros + significant;
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value);
}

export function isSolanaAddress(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && base58ByteLength(value) === 32;
}

export function isNearAccountId(value: string): boolean {
  if (HEX64.test(value)) return true; // implicit account
  if (/^0x[0-9a-f]{40}$/.test(value)) return true; // eth-implicit account
  return value.length >= 2 && value.length <= 64 && NEAR_NAMED.test(value);
}

/** Checks `address` against the format of 1Click chain `chain`. */
export function checkAddress(chain: string, address: string): AddressCheck {
  const value = address.trim();
  if (!value) return { valid: false, reason: "address is empty" };
  if (value !== address) return { valid: false, reason: "address has leading or trailing whitespace" };
  const key = chain.trim().toLowerCase();

  switch (chainFamily(key)) {
    case "evm":
      return isEvmAddress(value) ? { valid: true } : { valid: false, reason: "expected a 0x-prefixed 20-byte EVM address" };
    case "solana":
      return isSolanaAddress(value) ? { valid: true } : { valid: false, reason: "expected a base58 Solana address (32 bytes)" };
    case "near":
      return isNearAccountId(value)
        ? { valid: true }
        : { valid: false, reason: "expected a NEAR account id (e.g. alice.near) or a 64-hex implicit account" };
    default:
      break;
  }

  if (key === "tron") {
    return TRON_ADDRESS.test(value) && base58ByteLength(value) === 25
      ? { valid: true }
      : { valid: false, reason: "expected a base58 Tron address starting with T" };
  }
  if (key === "sui" || key === "aptos" || key === "movement") {
    return MOVE_ADDRESS.test(value) ? { valid: true } : { valid: false, reason: "expected a 0x-prefixed 32-byte address" };
  }
  if (key === "btc") {
    return BTC_ADDRESS.test(value) ? { valid: true } : { valid: false, reason: "expected a Bitcoin address (bc1…, 1… or 3…)" };
  }
  return { valid: null };
}
