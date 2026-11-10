import { Document, ObjectId, WithId } from "mongodb";
import { getDb } from "./mongo";
import { fastapiFetch } from "./fastapi";
import { releaseStorage } from "./quota";

export async function refreshDocumentJob(doc: WithId<Document>) {
  const upstream = await fastapiFetch(
    `/api/upload/status?doc_id=${encodeURIComponent(doc.docId)}`
  );
  const job = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return { status: upstream.status, job: { error: job.error || "Status unavailable." } };
  }

  const db = await getDb();
  const documents = db.collection("documents");
  if (job.status === "done" && job.stats) {
    const updated = await documents.findOneAndUpdate(
      { _id: doc._id, status: { $in: ["processing", "queued"] } },
      { $set: { status: "indexed", chunks: job.stats.chunks, pages: job.stats.pages } },
      { returnDocument: "before" }
    );
    if (updated) {
      await db.collection("chats").updateOne(
        { _id: new ObjectId(updated.chatId) },
        { $set: { updatedAt: new Date() } }
      );
    }
  } else if (job.status === "error") {
    const updated = await documents.findOneAndUpdate(
      { _id: doc._id, status: { $in: ["processing", "queued"] } },
      { $set: { status: "error" } },
      { returnDocument: "before" }
    );
    if (updated?.sizeBytes) {
      await releaseStorage(updated.userId, updated.sizeBytes);
    }
  }

  return { status: 200, job };
}
