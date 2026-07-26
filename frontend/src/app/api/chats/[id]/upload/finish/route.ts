import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { fastapiFetch } from "@/lib/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Indexing service unavailable." }, { status: 502 });
  }

  // tee: browser gets one stream live, we consume the other to save metadata once it's done
  const [clientStream, sideStream] = upstream.body.tee();
  void (async () => {
    const reader = sideStream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let stats: { doc_name: string; chunks: number; pages: number } | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === "done") stats = e.stats;
        } catch {
          /* ignore partial */
        }
      }
    }
    if (stats) {
      const db = await getDb();
      await db.collection("documents").insertOne({
        chatId: id,
        userId: gate.userId,
        docName: stats.doc_name,
        chunks: stats.chunks,
        pages: stats.pages,
        status: "indexed",
        createdAt: new Date(),
      });
      await db.collection("chats").updateOne({ _id: new ObjectId(id) }, { $set: { updatedAt: new Date() } });
    }
  })().catch(() => {});

  return new Response(clientStream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}
