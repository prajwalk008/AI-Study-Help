import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";
import { refreshDocumentJob } from "@/lib/documentJob";
import { releaseStorage } from "@/lib/quota";
import { decryptField } from "@/lib/fieldcipher";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const documents = await db
    .collection("documents")
    .find({ chatId: id })
    .sort({ createdAt: 1 })
    .toArray();

  for (const doc of documents) {
    if ((doc.status !== "processing" && doc.status !== "queued") || !doc.docId) continue;
    try {
      await refreshDocumentJob(doc);
    } catch {
      // Keep the last known state until the job service is available again.
    }
  }
  const currentDocuments = await db.collection("documents")
    .find({ chatId: id }).sort({ createdAt: 1 }).toArray();

  return NextResponse.json({
    chat: { id, title: gate.chat.title, updatedAt: gate.chat.updatedAt },
    documents: currentDocuments.map((d) => ({
      id: String(d._id),
      docName: decryptField(String(d.docName ?? ""), `documents|docName|${d._id}`),
      chunks: d.chunks,
      pages: d.pages,
      status: d.status,
    })),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const docs = await db.collection("documents").find({ chatId: id }).toArray();
  for (const doc of docs) {
    if (doc.status !== "processing" && doc.status !== "queued") continue;
    if (!doc.docId) {
      return NextResponse.json(
        { error: "Wait for the PDF upload to finish before deleting this chat." },
        { status: 409 }
      );
    }
    try {
      const response = await fastapiFetch(
        `/api/upload/status?doc_id=${encodeURIComponent(doc.docId)}`
      );
      const job = await response.json();
      if (!response.ok || (job.status !== "done" && job.status !== "error")) {
        return NextResponse.json(
          { error: "Wait for PDF indexing to finish before deleting this chat." },
          { status: 409 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Could not check the PDF job. Try again shortly." },
        { status: 503 }
      );
    }
  }
  let released = 0;
  for (const doc of docs) {
    if (doc.status === "indexed" || doc.status === "processing" || doc.status === "queued") {
      released += doc.sizeBytes || 0;
    }
  }
  if (released > 0) {
    await releaseStorage(gate.userId, released);
  }

  // Drop the chat's vector index in FastAPI (best-effort — don't fail the delete if it's down).
  try {
    await fastapiFetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* ignore */
  }

  await db.collection("messages").deleteMany({ chatId: id });
  await db.collection("documents").deleteMany({ chatId: id });
  await db.collection("chats").deleteOne({ _id: gate.chat._id as object });

  return NextResponse.json({ ok: true });
}
