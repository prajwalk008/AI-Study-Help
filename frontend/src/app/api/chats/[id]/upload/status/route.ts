import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { requireOwnedChat } from "@/lib/chatauth";
import { refreshDocumentJob } from "@/lib/documentJob";

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

  const result = await refreshDocumentJob(doc);
  return NextResponse.json(result.job, { status: result.status });
}
