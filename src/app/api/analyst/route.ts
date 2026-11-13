import { analyzeComparison } from "@/lib/radiri/ai";
import type { AnalystRequest, AnalystResponse, ApiError } from "@/lib/radiri/types";

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 502;
}

export async function POST(request: Request) {
  let body: AnalystRequest;
  try {
    body = (await request.json()) as AnalystRequest;
  } catch (error) {
    return Response.json(
      { error: `Request body must be JSON: ${error instanceof Error ? error.message : String(error)}` } satisfies ApiError,
      { status: 400 },
    );
  }

  if (!body?.compare) {
    return Response.json({ error: "compare is required (a CompareResponse from /api/compare)" } satisfies ApiError, {
      status: 400,
    });
  }

  try {
    const result: AnalystResponse = await analyzeComparison(body);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) } satisfies ApiError, {
      status: statusOf(error),
    });
  }
}
