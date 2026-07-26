import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "Missing docId." }, { status: 400 });

  const db = await getDb();
  // confirm this docId actually belongs to this chat before asking FastAPI about it
  const doc = await db.collection("documents").findOne({ chatId: id, docId });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const upstream = await fastapiFetch(`/api/upload/status?doc_id=${encodeURIComponent(docId)}`);
  const job = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json({ error: job.error || "Status unavailable." }, { status: upstream.status });
  }

  if (job.status === "done") {
    await db.collection("documents").updateOne(
      { _id: doc._id },
      { $set: { status: "indexed", chunks: job.stats.chunks, pages: job.stats.pages } }
    );
    await db.collection("chats").updateOne({ _id: new ObjectId(id) }, { $set: { updatedAt: new Date() } });
  } else if (job.status === "error") {
    await db.collection("documents").updateOne({ _id: doc._id }, { $set: { status: "error" } });
  }

  return NextResponse.json(job);
}
