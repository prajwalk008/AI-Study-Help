import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { uploadId, filename, total } = await req.json();
  if (typeof uploadId !== "string" || typeof filename !== "string" || typeof total !== "number") {
    return NextResponse.json({ error: "Malformed finish request." }, { status: 400 });
  }
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  const qs = new URLSearchParams({ chat_id: id, upload_id: uploadId, filename, total: String(total) });
  const upstream = await fastapiFetch(`/api/upload/finish?${qs}`, { method: "POST" });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json({ error: body.error || "Indexing service unavailable." }, { status: upstream.status || 502 });
  }

  const docId = body.doc_id as string;
  const db = await getDb();
  // the reservation row was created at the first chunk; attach the doc_id now and
  // correct the recorded size to the real reassembled byte count
  await db.collection("documents").updateOne(
    { chatId: id, uploadId },
    { $set: { docId, sizeBytes: body.bytes } }
  );

  return NextResponse.json({ docId });
}
