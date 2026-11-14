import "server-only";

import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";
import { NETWORK, RPC_URL } from "@/lib/config";

/** 1 NEAR covers gas plus every one-time storage deposit the lending flow needs. */
const FUND_AMOUNT = BigInt(10) ** BigInt(24);
/** Never spend the sponsor below this. */
const MIN_RESERVE = BigInt(2) * BigInt(10) ** BigInt(24);
/** An existing account below this is topped up; above it we leave it alone. */
const TOPUP_THRESHOLD = BigInt(5) * BigInt(10) ** BigInt(23);
/** Implicit account ids are the 32-byte public key in lowercase hex. */
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;

export interface FundResult {
  accountId: string;
  exists: boolean;
  funded: boolean;
  txHash: string | null;
  reason: string | null;
}

function sponsorCredentials(): { accountId: string; secret: string } | null {
  const accountId = process.env.RADIRI_FAUCET_ACCOUNT?.trim();
  const secret = process.env.RADIRI_FAUCET_PRIVATE_KEY?.trim();
  return accountId && secret ? { accountId, secret } : null;
}

export function faucetConfigured(): boolean {
  return NETWORK === "testnet" && sponsorCredentials() !== null;
}

async function accountBalance(provider: JsonRpcProvider, accountId: string, final = false): Promise<bigint | null> {
  try {
    const view = await provider.viewAccount(final ? { accountId, blockQuery: { finality: "final" } } : { accountId });
    return BigInt((view as unknown as { amount: string | bigint }).amount);
  } catch {
    return null;
  }
}

/**
 * Funds a testnet wallet account: creates a brand-new implicit account with 1 NEAR, or tops up an
 * existing account (named or implicit) that has less than 0.5 NEAR. Implicit accounts are the ones
 * a browser wallet generates before it has an on-chain balance; named accounts come from wallets
 * like Meteor and cannot be created by a transfer, only topped up.
 */
export async function fundTestnetAccount(accountId: string): Promise<FundResult> {
  const idle = (reason: string, exists = false): FundResult => ({ accountId, exists, funded: false, txHash: null, reason });

  if (NETWORK !== "testnet") return idle("the sponsor faucet only runs on NEAR testnet");
  const provider = new JsonRpcProvider({ url: RPC_URL });
  const existing = await accountBalance(provider, accountId);
  if (existing !== null) {
    if (existing >= TOPUP_THRESHOLD) return idle("account already has funds", true);
  } else if (!IMPLICIT_ACCOUNT.test(accountId)) {
    return idle("only implicit accounts can be created by a transfer");
  }

  const sponsor = sponsorCredentials();
  if (!sponsor) return idle("faucet not configured on this server");
  if (sponsor.accountId === accountId) return idle("refusing to fund the sponsor itself");

  const signer = new Account(sponsor.accountId, provider, KeyPairSigner.fromSecretKey(sponsor.secret as KeyPairString));
  const sponsorBalance = await accountBalance(provider, sponsor.accountId);
  if (sponsorBalance === null || sponsorBalance < FUND_AMOUNT + MIN_RESERVE) return idle("the sponsor faucet is out of funds");

  const outcome = await signer.transfer({ receiverId: accountId, amount: FUND_AMOUNT });
  const txHash = outcome.transaction?.hash ?? null;

  // The wallet signs the mint right after this; wait until the new balance is final on chain.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await accountBalance(provider, accountId, true)) !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { accountId, exists: existing !== null, funded: true, txHash, reason: null };
}
