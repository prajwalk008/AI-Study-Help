import { NextResponse } from "next/server";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const form = await req.formData();
  const uploadId = form.get("uploadId");
  const index = form.get("index");
  const total = form.get("total");
  const chunk = form.get("chunk");
  if (
    typeof uploadId !== "string" ||
    typeof index !== "string" ||
    typeof total !== "string" ||
    !(chunk instanceof File)
  ) {
    return NextResponse.json({ error: "Malformed chunk upload." }, { status: 400 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("chunk", chunk);
  const qs = new URLSearchParams({ upload_id: uploadId, index, total });
  const upstream = await fastapiFetch(`/api/upload/chunk?${qs}`, {
    method: "POST",
    body: upstreamForm,
  });
  const body = await upstream.json().catch(() => ({}));
  return NextResponse.json(body, { status: upstream.status });
}
