import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await requireOwnedChat(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = await getDb();
  const messages = await db
    .collection("messages")
    .find({ chatId: id, userId: gate.userId })
    .sort({ createdAt: 1 })
    .toArray();

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      sources: m.sources ?? null,
      status: m.status ?? "complete",
    })),
  });
}
