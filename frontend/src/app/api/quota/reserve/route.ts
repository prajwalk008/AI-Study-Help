import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getSession } from "@/lib/session";
import { reserveStorage } from "@/lib/quota";
import { MAX_FILE_BYTES } from "@/lib/uploadLimits";
import { requireOwnedChat } from "@/lib/chatauth";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId as string | undefined;
  const filename = body.filename as string | undefined;
  const fileSize = Number(body.fileSize);
  const uploadId = body.uploadId as string | undefined;

  if (!chatId || !filename || !uploadId || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: "Malformed reserve request." }, { status: 400 });
  }
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }
  if (fileSize > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).` },
      { status: 413 }
    );
  }

  const gate = await requireOwnedChat(chatId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const userId = new ObjectId(user.id);
  const ok = await reserveStorage(userId, fileSize);
  if (!ok) {
    const db = await getDb();
    const u = await db.collection("users").findOne({ _id: userId });
    const used = u?.storageUsedBytes ?? 0;
    const quota = u?.storageQuotaBytes ?? 0;
    return NextResponse.json(
      {
        error: `Storage quota exceeded (${Math.round(used / (1024 * 1024))} MB of ${Math.round(quota / (1024 * 1024))} MB used).`,
      },
      { status: 413 }
    );
  }

  const db = await getDb();
  await db.collection("documents").insertOne({
    chatId,
    userId,
    uploadId,
    docName: filename,
    sizeBytes: fileSize,
    chunks: 0,
    pages: 0,
    status: "processing",
    createdAt: new Date(),
  });

  const info = await db.collection("users").findOne({ _id: userId });
  return NextResponse.json({
    ok: true,
    storageUsedBytes: info?.storageUsedBytes ?? 0,
    storageQuotaBytes: info?.storageQuotaBytes ?? 0,
  });
}
