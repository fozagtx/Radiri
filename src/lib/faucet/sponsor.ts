import "server-only";

import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";
import { NETWORK, RPC_URL } from "@/lib/config";

/** 1 NEAR covers gas plus every one-time storage deposit the lending flow needs. */
const FUND_AMOUNT = BigInt(10) ** BigInt(24);
/** Never spend the sponsor below this. */
const MIN_RESERVE = BigInt(2) * BigInt(10) ** BigInt(24);
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

async function accountExists(provider: JsonRpcProvider, accountId: string, final = false): Promise<boolean> {
  try {
    await provider.viewAccount(final ? { accountId, blockQuery: { finality: "final" } } : { accountId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a brand-new implicit testnet account by transferring 1 NEAR to the id derived from its
 * public key. Existing accounts are never touched; named accounts cannot be created by a transfer.
 */
export async function fundTestnetAccount(accountId: string): Promise<FundResult> {
  const idle = (reason: string, exists = false): FundResult => ({ accountId, exists, funded: false, txHash: null, reason });

  if (NETWORK !== "testnet") return idle("the sponsor faucet only runs on NEAR testnet");
  const provider = new JsonRpcProvider({ url: RPC_URL });
  if (await accountExists(provider, accountId)) return idle("account already exists", true);
  if (!IMPLICIT_ACCOUNT.test(accountId)) return idle("only implicit accounts can be created by a transfer");

  const sponsor = sponsorCredentials();
  if (!sponsor) return idle("faucet not configured on this server");
  if (sponsor.accountId === accountId) return idle("refusing to fund the sponsor itself");

  const signer = new Account(sponsor.accountId, provider, KeyPairSigner.fromSecretKey(sponsor.secret as KeyPairString));
  const sponsorBalance = BigInt((await provider.viewAccount({ accountId: sponsor.accountId }) as unknown as { amount: string }).amount);
  if (sponsorBalance < FUND_AMOUNT + MIN_RESERVE) return idle("the sponsor faucet is out of funds");

  const outcome = await signer.transfer({ receiverId: accountId, amount: FUND_AMOUNT });
  const txHash = outcome.transaction?.hash ?? null;

  // The wallet signs the mint right after this; wait until the new key is final on chain.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await accountExists(provider, accountId, true)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { accountId, exists: true, funded: true, txHash, reason: null };
}
