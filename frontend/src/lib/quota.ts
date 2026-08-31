import { ObjectId } from "mongodb";
import { getDb } from "./mongo";
import { STORAGE_QUOTA_BYTES, STALE_PROCESSING_MS } from "./uploadLimits";

export async function migrateUserQuotas(): Promise<void> {
  const db = await getDb();
  const users = db.collection("users");
  const docs = db.collection("documents");

  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const stale = await docs.find({ status: "processing", createdAt: { $lt: staleBefore } }).toArray();
  for (const doc of stale) {
    const size = doc.sizeBytes || 0;
    if (doc.userId && size > 0) {
      await users.updateOne({ _id: doc.userId }, { $inc: { storageUsedBytes: -size } });
    }
    await docs.updateOne({ _id: doc._id }, { $set: { status: "error" } });
  }

  const needsMigration = await users.find({ storageQuotaBytes: { $exists: false } }).toArray();
  for (const user of needsMigration) {
    const indexed = await docs
      .find({ userId: user._id, status: { $in: ["indexed", "processing"] } })
      .toArray();
    const used = indexed.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
    await users.updateOne(
      { _id: user._id },
      { $set: { storageQuotaBytes: STORAGE_QUOTA_BYTES, storageUsedBytes: used } }
    );
  }
}

export async function reserveStorage(userId: ObjectId, bytes: number): Promise<boolean> {
  await migrateUserQuotas();
  const db = await getDb();
  const result = await db.collection("users").findOneAndUpdate(
    {
      _id: userId,
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ["$storageUsedBytes", 0] }, bytes] },
          { $ifNull: ["$storageQuotaBytes", STORAGE_QUOTA_BYTES] },
        ],
      },
    },
    { $inc: { storageUsedBytes: bytes } },
    { returnDocument: "after" }
  );
  return result !== null;
}

export async function releaseStorage(userId: ObjectId, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  const db = await getDb();
  await db.collection("users").updateOne({ _id: userId }, { $inc: { storageUsedBytes: -bytes } });
  const user = await db.collection("users").findOne({ _id: userId });
  if (user && (user.storageUsedBytes ?? 0) < 0) {
    await db.collection("users").updateOne({ _id: userId }, { $set: { storageUsedBytes: 0 } });
  }
}

export async function getStorageInfo(userId: ObjectId) {
  await migrateUserQuotas();
  const db = await getDb();
  const user = await db.collection("users").findOne({ _id: userId });
  return {
    storageQuotaBytes: user?.storageQuotaBytes ?? STORAGE_QUOTA_BYTES,
    storageUsedBytes: user?.storageUsedBytes ?? 0,
  };
}
