import type {
  AnalystRequest,
  AnalystResponse,
  CompareRequest,
  CompareResponse,
  MatrixResponse,
  OnchainSnapshot,
  StableAsset,
} from "@/lib/radiri/types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  const fallback = text.trim() || `HTTP ${res.status} ${res.statusText}`.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.error === "string" && record.error) return record.error;
      if (typeof record.message === "string" && record.message) return record.message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : String(error));
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  try {
    return (await res.json()) as T;
  } catch (error) {
    throw new ApiError(
      `Response from ${url} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      res.status,
    );
  }
}

function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export function getStables(signal?: AbortSignal): Promise<StableAsset[]> {
  return request<StableAsset[]>("/api/stables", { signal, cache: "no-store" });
}

export function postCompare(body: CompareRequest, signal?: AbortSignal): Promise<CompareResponse> {
  return postJson<CompareResponse>("/api/compare", body, signal);
}

export function postMatrix(amount: number, signal?: AbortSignal): Promise<MatrixResponse> {
  return postJson<MatrixResponse>("/api/matrix", { amount }, signal);
}

export function postAnalyst(body: AnalystRequest, signal?: AbortSignal): Promise<AnalystResponse> {
  return postJson<AnalystResponse>("/api/analyst", body, signal);
}

export function getSnapshots(signal?: AbortSignal): Promise<OnchainSnapshot[]> {
  return request<OnchainSnapshot[]>("/api/snapshots", { signal, cache: "no-store" });
}
