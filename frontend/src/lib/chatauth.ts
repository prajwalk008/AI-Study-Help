import { ObjectId } from "mongodb";
import { getDb } from "./mongo";
import { getSession } from "./session";

export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// 404 (not 403) on a chat you don't own, so the response can't be used to guess valid chat ids
export async function requireOwnedChat(
  chatId: string
): Promise<
  | { ok: true; userId: ObjectId; chat: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const user = await getSession();
  if (!user) return { ok: false, status: 401, error: "Not signed in." };

  const oid = toObjectId(chatId);
  if (!oid) return { ok: false, status: 404, error: "Chat not found." };

  const userId = new ObjectId(user.id);
  const db = await getDb();
  const chat = await db.collection("chats").findOne({ _id: oid, userId });
  if (!chat) return { ok: false, status: 404, error: "Chat not found." };

  return { ok: true, userId, chat };
}
