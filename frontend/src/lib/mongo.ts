import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "recall";

if (!uri || uri.startsWith("REPLACE_WITH")) {
  // Surfaced clearly at runtime so the fix (paste the Atlas URI) is obvious.
  console.warn("[mongo] MONGODB_URI is not set — paste your Atlas connection string in frontend/.env.local");
}

// Reuse a single client across hot reloads in dev (avoids exhausting connections).
const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>;
  _mongoIndexesReady?: Promise<void>;
};

function clientPromise(): Promise<MongoClient> {
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(uri as string);
    globalForMongo._mongoClientPromise = client.connect();
  }
  return globalForMongo._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

function ensureIndexes(db: Db): Promise<void> {
  if (!globalForMongo._mongoIndexesReady) {
    globalForMongo._mongoIndexesReady = (async () => {
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      // TTL indexes: Mongo auto-deletes expired OTPs and sessions.
      await db.collection("otps").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await db.collection("otps").createIndex({ email: 1 }, { unique: true });
      await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true });
      await db.collection("chats").createIndex({ userId: 1, updatedAt: -1 });
      await db.collection("messages").createIndex({ chatId: 1, createdAt: 1 });
      await db.collection("documents").createIndex({ chatId: 1, createdAt: 1 });
    })().catch((e) => {
      globalForMongo._mongoIndexesReady = undefined; // allow retry on next call
      throw e;
    });
  }
  return globalForMongo._mongoIndexesReady;
}
