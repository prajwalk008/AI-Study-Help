import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getSession } from "@/lib/session";
import { releaseStorage } from "@/lib/quota";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { uploadId } = await req.json().catch(() => ({}));
  if (typeof uploadId !== "string") {
    return NextResponse.json({ error: "Malformed release request." }, { status: 400 });
  }

  const db = await getDb();
  const doc = await db.collection("documents").findOne({
    userId: new ObjectId(user.id),
    uploadId,
    status: "processing",
  });
  if (!doc) return NextResponse.json({ ok: true });

  await releaseStorage(new ObjectId(user.id), doc.sizeBytes || 0);
  await db.collection("documents").updateOne({ _id: doc._id }, { $set: { status: "error" } });

  return NextResponse.json({ ok: true });
}
