import { RPC_URL } from "@/lib/config";

export class NearRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NearRpcError";
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface ViewCallOptions {
  rpcUrl?: string;
  signal?: AbortSignal;
}

/** Read-only contract call over JSON-RPC. No wallet needed. */
export async function viewCall<T>(
  contractId: string,
  method: string,
  args: object = {},
  options: ViewCallOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(options.rpcUrl ?? RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "view",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "optimistic",
          account_id: contractId,
          method_name: method,
          args_base64: toBase64(JSON.stringify(args)),
        },
      }),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new NearRpcError(`RPC unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) throw new NearRpcError(`RPC HTTP ${res.status} for ${contractId}.${method}`);
  const json = await res.json();
  if (json.error) {
    const data = json.error.data;
    const detail = typeof data === "string" ? data : json.error.cause?.name ?? json.error.message ?? "RPC error";
    throw new NearRpcError(`${contractId}.${method}: ${detail}`);
  }
  if (json.result?.error) throw new NearRpcError(`${contractId}.${method}: ${json.result.error}`);
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** n TGas in gas units. */
export const TGAS = (n: number) => (BigInt(n) * BigInt(10) ** BigInt(12)).toString();

/** "0.1" NEAR -> yoctoNEAR string (exact). */
export const NEAR_TO_YOCTO = (n: string) => {
  const [whole, frac = ""] = n.split(".");
  return (BigInt(whole || "0") * BigInt(10) ** BigInt(24) + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
};

/** NEAR account id rules (2-64 chars, lowercase, separators . - _). */
export function isValidAccountId(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value);
}
