import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_FILE_CAP_BYTES = 500 * 1024 * 1024;
const TOTAL_QUOTA_BYTES = 500 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const form = await req.formData();
  const uploadId = form.get("uploadId");
  const index = form.get("index");
  const total = form.get("total");
  const chunk = form.get("chunk");
  const fileSize = form.get("fileSize");
  const filename = form.get("filename");
  if (
    typeof uploadId !== "string" ||
    typeof index !== "string" ||
    typeof total !== "string" ||
    typeof fileSize !== "string" ||
    typeof filename !== "string" ||
    !(chunk instanceof File)
  ) {
    return NextResponse.json({ error: "Malformed chunk upload." }, { status: 400 });
  }

  // quota is reserved on the first chunk, before any bytes are forwarded, so parallel
  // uploads can't all look "under quota" at once
  if (index === "0") {
    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Malformed chunk upload." }, { status: 400 });
    }
    if (size > PER_FILE_CAP_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${PER_FILE_CAP_BYTES / (1024 * 1024)} MB).` },
        { status: 413 }
      );
    }

    const db = await getDb();
    const existing = await db.collection("documents").find({ userId: gate.userId }).toArray();
    const usage = existing.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
    if (usage + size > TOTAL_QUOTA_BYTES) {
      const usedMb = Math.round(usage / (1024 * 1024));
      const quotaMb = TOTAL_QUOTA_BYTES / (1024 * 1024);
      return NextResponse.json(
        { error: `Storage quota exceeded (${usedMb} MB of ${quotaMb} MB used).` },
        { status: 413 }
      );
    }

    await db.collection("documents").insertOne({
      chatId: id,
      userId: gate.userId,
      uploadId,
      docName: filename,
      sizeBytes: size,
      chunks: 0,
      pages: 0,
      status: "processing",
      createdAt: new Date(),
    });
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
