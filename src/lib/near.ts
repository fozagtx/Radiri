import { RPC_URL } from "./config";

/** Read-only contract call over JSON-RPC. No wallet needed. */
export async function viewCall<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC_URL, {
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
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.data ?? json.error.message ?? "RPC error");
  if (json.result?.error) throw new Error(json.result.error);
  const bytes = new Uint8Array(json.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export const TGAS = (n: number) => (BigInt(n) * BigInt(10) ** BigInt(12)).toString();
export const NEAR_TO_YOCTO = (n: string) => {
  const [whole, frac = ""] = n.split(".");
  return (BigInt(whole || "0") * BigInt(10) ** BigInt(24) + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
};
