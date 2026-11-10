import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  try {
    let response = await fastapiFetch("/api/warm", {
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    });
    if (response.status === 404) {
      response = await fastapiFetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      });
    }
    if (!response.ok) return new Response(null, { status: 503, headers: NO_STORE });
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch {
    return new Response(null, { status: 503, headers: NO_STORE });
  }
}
