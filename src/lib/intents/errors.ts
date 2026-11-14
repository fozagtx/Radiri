import type { SwapQuoteFailure } from "@/types/protocol";

/**
 * Turns anything thrown by the 1Click SDK (axios-based `ApiError`), the network, or our own guards
 * into the verbatim 1Click message plus a failure kind. Client-safe and pure.
 */

export interface OneClickErrorInfo {
  /** Verbatim `message` from the 1Click response body when there is one. */
  message: string;
  status: number | null;
  correlationId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Extracts the verbatim 1Click reason. The SDK's own `ApiError.message` is generic ("Bad Request - ..."). */
export function extractOneClickError(error: unknown): OneClickErrorInfo {
  const err = record(error);
  const status = typeof err?.status === "number" ? err.status : null;
  const body = record(err?.body);
  const bodyText = typeof err?.body === "string" ? err.body.trim() : "";

  if (body) {
    const message =
      (typeof body.message === "string" && body.message) ||
      (Array.isArray(body.message) && body.message.filter((item) => typeof item === "string").join("; ")) ||
      (typeof body.error === "string" && body.error) ||
      "";
    if (message) {
      return {
        message,
        status,
        correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
      };
    }
  }

  if (bodyText.startsWith("<")) {
    return {
      message: `1Click answered with an HTML page instead of JSON (HTTP ${status ?? "?"}), usually a Cloudflare challenge on this network`,
      status,
      correlationId: null,
    };
  }
  if (bodyText) return { message: bodyText.slice(0, 500), status, correlationId: null };

  const code = typeof err?.code === "string" ? ` (${err.code})` : "";
  const message = error instanceof Error ? `${error.message}${code}` : String(error);
  return { message, status, correlationId: null };
}

/** Maps a verbatim 1Click reason to a failure kind. The reason itself is always shown unchanged. */
export function classifyOneClickMessage(message: string, status: number | null = null): SwapQuoteFailure["kind"] {
  if (/no liquidity|not enough liquidity|insufficient liquidity/i.test(message)) return "no-liquidity";
  if (/token(in|out) is not valid|asset .*not (supported|found)|unsupported|not supported/i.test(message)) {
    return "unsupported";
  }
  if (
    /is not valid|invalid|must be|should be|too low|too high|minimum swap amount|amount is|recipient|refundTo|deadline/i.test(
      message,
    )
  ) {
    return "invalid-input";
  }
  if (status === 400) return "invalid-input";
  return "error";
}

export function quoteFailureFrom(error: unknown): SwapQuoteFailure {
  const info = extractOneClickError(error);
  return { reason: info.message, kind: classifyOneClickMessage(info.message, info.status) };
}
