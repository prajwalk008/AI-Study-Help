import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";
import { MAX_PART_BYTES } from "@/lib/uploadLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const form = await req.formData();
  const uploadId = form.get("uploadId");
  const filename = form.get("filename");
  const segmentIndex = form.get("segmentIndex");
  const totalSegments = form.get("totalSegments");
  const pageOffset = form.get("pageOffset");
  const totalPages = form.get("totalPages");
  const docId = form.get("docId");
  const file = form.get("file");

  if (
    typeof uploadId !== "string" ||
    typeof filename !== "string" ||
    typeof segmentIndex !== "string" ||
    typeof totalSegments !== "string" ||
    typeof pageOffset !== "string" ||
    typeof totalPages !== "string" ||
    !(file instanceof File)
  ) {
    return NextResponse.json({ error: "Malformed segment upload." }, { status: 400 });
  }

  if (file.size > MAX_PART_BYTES) {
    return NextResponse.json(
      { error: `PDF part exceeds ${MAX_PART_BYTES / (1024 * 1024)} MB limit.` },
      { status: 413 }
    );
  }

  const db = await getDb();
  const reservation = await db.collection("documents").findOne({ chatId: id, uploadId });
  if (!reservation || reservation.status !== "processing") {
    return NextResponse.json({ error: "Upload session not found." }, { status: 404 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file);
  const qs = new URLSearchParams({
    chat_id: id,
    filename,
    segment_index: segmentIndex,
    total_segments: totalSegments,
    page_offset: pageOffset,
    total_pages: totalPages,
  });
  if (typeof docId === "string" && docId) qs.set("doc_id", docId);

  const upstream = await fastapiFetch(`/api/upload/segment?${qs}`, {
    method: "POST",
    body: upstreamForm,
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json({ error: body.detail || body.error || "Segment upload failed." }, {
      status: upstream.status,
    });
  }

  if (segmentIndex === "0") {
    await db.collection("documents").updateOne(
      { _id: reservation._id },
      { $set: { docId: body.doc_id as string } }
    );
  }

  return NextResponse.json({ docId: body.doc_id });
}
