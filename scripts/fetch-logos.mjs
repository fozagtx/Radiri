/**
 * Downloads real coin and chain logos (PNG) from the Trust Wallet assets repository into public/logos,
 * so the app serves them itself. Run: NODE_USE_ENV_PROXY=1 node scripts/fetch-logos.mjs
 */
import { getAddress } from "viem";
import { writeFileSync } from "node:fs";
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const coins = [
  ["PEPE", "ethereum", "0x6982508145454ce325ddbe47a25d4ec3d2311933"],
  ["SHIB", "ethereum", "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce"],
  ["MOG", "ethereum", "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a"],
  ["SPX", "ethereum", "0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c"],
  ["TURBO", "ethereum", "0xa35923162c49cf95e6bf26623385eb431ad920d3"],
  ["BRETT", "base", "0x532f27101965dd16442e59d40670faf5ebb142e4"],
  ["WIF", "solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["BOME", "solana", "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["TRUMP", "solana", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"],
  ["PENGU", "solana", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"],
  ["MELANIA", "solana", "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P"],
  ["BONK", "solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["DOGE", "doge", null],
  ["NEAR", "near", null],
];
const chains = [["eth", "ethereum"], ["sol", "solana"], ["bsc", "smartchain"], ["near", "near"], ["base", "base"], ["arb", "arbitrum"], ["pol", "polygon"], ["op", "optimism"], ["avax", "avalanchec"], ["doge", "doge"]];
async function grab(url, file) {
  const res = await fetch(url);
  if (!res.ok) return `${res.status}`;
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return `ok ${buf.length}B`;
}
for (const [sym, chain, addr] of coins) {
  const id = addr === null ? null : chain === "solana" ? addr : getAddress(addr);
  const url = id ? `${TW}/${chain}/assets/${id}/logo.png` : `${TW}/${chain}/info/logo.png`;
  console.log(sym.padEnd(8), await grab(url, `public/logos/coins/${sym.toLowerCase()}.png`));
}
for (const [id, tw] of chains) console.log(`chain ${id}`.padEnd(12), await grab(`${TW}/${tw}/info/logo.png`, `public/logos/chains/${id}.png`));

// NEAR-native meme coins publish their logo on-chain in NEP-148 ft_metadata.icon (a data URI).
const NEAR_RPC = "https://rpc.mainnet.fastnear.com";
const nearCoins = [
  ["BLACKDRAGON", "blackdragon.tkn.near"],
  ["SHITZU", "token.0xshitzu.near"],
  ["ABG", "abg-966.meme-cooking.near"],
  ["GNEAR", "gnear-229.meme-cooking.near"],
  ["JAMBO", "jambo-1679.meme-cooking.near"],
  ["NOEAR", "noear-324.meme-cooking.near"],
  ["PURGE", "purge-558.meme-cooking.near"],
];
function extensionOf(bytes, mime) {
  const head = bytes.subarray(0, 12).toString("latin1");
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (head.startsWith("\x89PNG")) return "png";
  if (mime.includes("svg") || head.trimStart().startsWith("<")) return "svg";
  return null;
}
for (const [sym, account] of nearCoins) {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: "ft_metadata", args_base64: "e30=" } }),
  });
  const json = await res.json();
  const meta = JSON.parse(Buffer.from(json.result.result).toString("utf8"));
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(meta.icon ?? "");
  if (!match) {
    console.log(sym.padEnd(12), "no data-URI icon");
    continue;
  }
  const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  const ext = extensionOf(bytes, match[1]);
  if (!ext) {
    console.log(sym.padEnd(12), `unknown image type ${match[1]}`);
    continue;
  }
  writeFileSync(`public/logos/coins/${sym.toLowerCase()}.${ext}`, bytes);
  console.log(sym.padEnd(12), `ok ${ext} ${bytes.length}B (on-chain icon of ${account})`);
}
