import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongo";
import { getSession } from "@/lib/session";
import { decryptField, encryptField } from "@/lib/fieldcipher";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const db = await getDb();
  const chats = await db
    .collection("chats")
    .find({ userId: new ObjectId(user.id) })
    .sort({ updatedAt: -1 })
    .toArray();

  return NextResponse.json({
    chats: chats.map((c) => ({
      id: String(c._id),
      title: decryptField(String(c.title ?? ""), `chats|title|${c._id}`),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let title = "New chat";
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) title = body.title.trim().slice(0, 120);
  } catch {
    /* body optional */
  }

  const db = await getDb();
  const now = new Date();
  const chatId = new ObjectId();
  const res = await db.collection("chats").insertOne({
    _id: chatId,
    userId: new ObjectId(user.id),
    title: encryptField(title, `chats|title|${chatId}`),
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    chat: { id: String(res.insertedId), title, createdAt: now, updatedAt: now },
  });
}
