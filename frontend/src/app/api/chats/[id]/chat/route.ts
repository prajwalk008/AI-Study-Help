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

  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").trim();
  } catch {
    /* handled below */
  }
  if (!question) return NextResponse.json({ error: "Question cannot be empty." }, { status: 400 });

  const db = await getDb();
  const now = new Date();
  await db.collection("messages").insertOne({
    chatId: id,
    userId: gate.userId,
    role: "user",
    content: question,
    createdAt: now,
  });
  // Auto-title a fresh chat from its first question.
  const update: Record<string, unknown> = { updatedAt: now };
  if (gate.chat.title === "New chat") update.title = question.slice(0, 48);
  await db.collection("chats").updateOne({ _id: new ObjectId(id) }, { $set: update });

  const upstream = await fastapiFetch(`/api/chat?chat_id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Answering service unavailable." }, { status: 502 });
  }

  // Forward tokens to the browser while accumulating the full answer server-side to persist.
  const [clientStream, sideStream] = upstream.body.tee();
  void (async () => {
    const reader = sideStream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    let sources: unknown = null;
    let done = false;
    for (;;) {
      const { done: d, value } = await reader.read();
      if (d) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === "sources") sources = e.sources;
          else if (e.type === "token") content += e.text;
          else if (e.type === "done") done = true;
        } catch {
          /* ignore partial */
        }
      }
    }
    const db2 = await getDb();
    // Never store a partial stream as if it were a complete answer.
    await db2.collection("messages").insertOne({
      chatId: id,
      userId: gate.userId,
      role: "assistant",
      content,
      sources,
      status: done ? "complete" : "failed",
      createdAt: new Date(),
    });
    await db2.collection("chats").updateOne({ _id: new ObjectId(id) }, { $set: { updatedAt: new Date() } });
  })().catch(() => {});

  return new Response(clientStream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" },
  });
}
