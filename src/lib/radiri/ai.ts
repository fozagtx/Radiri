import type { AnalystRequest, AnalystResponse, CompareResponse, RouteQuote } from "./types";

const NEARAI_API = "https://cloud-api.near.ai";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const CHAT_TIMEOUT_MS = 60_000;
const SIGNATURE_TIMEOUT_MS = 10_000;
const MAX_COMPLETION_TOKENS = 700;

/** Thrown when the analyst cannot run at all (no key configured). */
export class AnalystUnavailableError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "AnalystUnavailableError";
  }
}

interface ChatMessage {
  role: string;
  content: string | { type?: string; text?: string }[] | null;
}

interface ChatCompletion {
  id: string;
  model: string;
  choices?: { message?: ChatMessage; finish_reason?: string | null }[];
}

const SYSTEM_PROMPT = [
  "You are Radiri's stablecoin liquidity analyst. Radiri compares cross-chain stablecoin swap routes on NEAR",
  "(NEAR Intents 1Click across chains, and the Rhea Smart Router on NEAR) and records results on a NEAR contract.",
  "Rules:",
  "- Use only the numbers, routes and quoted failure reasons in the JSON payload. Never invent a rate, fee, route or chain.",
  "- If a source returned a failure, quote its reason verbatim once and say which source covers the pair instead.",
  "- Lead with the best route and its execution cost in basis points, then the runner-up, then the risk (worst-case at the quoted slippage).",
  "- Be specific and short: at most 160 words, plain prose, no markdown headings, no tables, no bullet symbols.",
].join("\n");

function describeRoute(route: RouteQuote): string {
  const fees = route.fees.map((fee) => `${fee.label} ${fee.amount} ${fee.unit}`).join("; ") || "none reported";
  return [
    `${route.source}: ${route.amountIn} ${route.from.symbol} (${route.from.chain}) -> ${route.amountOut} ${route.to.symbol} (${route.to.chain})`,
    `cost ${route.costBps.toFixed(2)} bps, worst case ${route.worstCaseCostBps.toFixed(2)} bps at ${route.slippageBps} bps slippage,`,
    `min ${route.minAmountOut} ${route.to.symbol}, eta ${route.etaSeconds ?? "not reported"}s, fees: ${fees}, quoted ${route.quotedAt}`,
  ].join(" ");
}

function buildUserPrompt(compare: CompareResponse, question?: string): string {
  const payload = {
    request: compare.request,
    routes: compare.routes.map(describeRoute),
    failures: compare.failures.map((failure) => ({ source: failure.source, kind: failure.kind, reason: failure.reason })),
    opportunities: compare.opportunities.map((item) => ({ kind: item.kind, severity: item.severity, title: item.title })),
    best: compare.best
      ? { source: compare.best.source, amountOut: compare.best.amountOut, costBps: Number(compare.best.costBps.toFixed(2)) }
      : null,
    generatedAt: compare.generatedAt,
  };

  return [
    "Quote data (JSON):",
    JSON.stringify(payload, null, 2),
    "",
    question?.trim()
      ? `Question from the operator: ${question.trim()}`
      : "Explain what this comparison means for a treasury operator moving this size, and name the route you would take.",
  ].join("\n");
}

function textOf(message: ChatMessage | undefined): string {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function errorDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; type?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? raw.slice(0, 300);
  } catch {
    return raw.trim().slice(0, 300) || "empty response body";
  }
}

async function fetchSignature(
  apiKey: string,
  chatId: string,
): Promise<AnalystResponse["verification"]> {
  try {
    const res = await fetch(`${NEARAI_API}/v1/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(SIGNATURE_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const payload = (await res.json()) as {
      signature?: string;
      signing_address?: string;
      error_code?: string;
    };
    if (!payload.signature || payload.error_code) return undefined;
    return {
      chatId,
      verifyUrl: `${NEARAI_API}/v1/signature/${encodeURIComponent(chatId)}`,
      signature: payload.signature,
      signingAddress: payload.signing_address,
    };
  } catch {
    return undefined;
  }
}

/** Asks NEAR AI Cloud (OpenAI-compatible chat completions, TEE-attested) to explain a comparison. */
export async function analyzeComparison({ compare, question }: AnalystRequest): Promise<AnalystResponse> {
  const apiKey = process.env.NEARAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AnalystUnavailableError(
      "NEARAI_API_KEY is not set on the server, so the NEAR AI Cloud analyst is unavailable. Claim a key at nearbuilders.org/dashboard.",
    );
  }
  if (!compare?.request || !Array.isArray(compare.routes)) {
    throw new Error("analyst request is missing a compare payload");
  }

  const model = process.env.NEARAI_MODEL?.trim() || DEFAULT_MODEL;
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(compare, question) },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    temperature: 0.2,
    stream: false,
  });

  let res: Response;
  try {
    res = await fetch(`${NEARAI_API}/v1/chat/completions`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "identity",
      },
      body,
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`NEAR AI Cloud request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const raw = await res.text();
  if (!res.ok) throw new Error(`NEAR AI Cloud returned HTTP ${res.status}: ${errorDetail(raw)}`);

  let completion: ChatCompletion;
  try {
    completion = JSON.parse(raw) as ChatCompletion;
  } catch (error) {
    throw new Error(`NEAR AI Cloud returned non-JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = textOf(completion.choices?.[0]?.message);
  if (!text) throw new Error("NEAR AI Cloud returned an empty completion");

  return {
    model: completion.model || model,
    text,
    verification: completion.id ? await fetchSignature(apiKey, completion.id) : undefined,
  };
}
