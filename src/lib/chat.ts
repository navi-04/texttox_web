import { randomBytes } from "node:crypto";
import type { Gender, User } from "./auth";
import { all, getDb, one, run } from "./db";
import { ApiError } from "./errors";

export const MAX_MESSAGE_LENGTH = 1000;

/** A searcher counts as "online" if its client checked in this recently. */
const ONLINE_MS = 20_000;
/** Don't pair two people again right after they have just talked. */
const NO_REMATCH_MS = 10 * 60 * 1000;

/** "any" = non-specific chat: paired with anyone else who also chose "any", whatever either person's gender. */
export type Want = Gender | "any";

interface QueueRow {
  user_id: number;
  gender: Want;
  want: Want;
}

export interface ChatRow {
  id: string;
  user_a: number;
  user_b: number;
  a_open: number;
  b_open: number;
  status: "active" | "ended";
  ended_by: number | null;
  version: number;
  reported: number;
  updated_at: number;
}

/* ------------------------------------------------------------------ queue */

export async function joinQueue(user: User, want: unknown): Promise<void> {
  if (want !== "boy" && want !== "girl" && want !== "any") throw new ApiError(400, "Choose who you want to chat with.");
  // Only the specific chat is two-sided by gender, so only it needs to know who you are.
  if (want !== "any" && !user.gender) throw new ApiError(400, "Choose boy or girl for yourself first.");

  // `user` was loaded at the start of the request - look at the chat again.
  const current = await one<{ chat_id: string | null; status: string | null }>(
    "SELECT u.chat_id, c.status FROM users u LEFT JOIN chats c ON c.id = u.chat_id WHERE u.id = ?",
    [user.id],
  );
  if (current?.chat_id) {
    if (current.status === "active") throw new ApiError(409, "You are already in a chat.");
    await leaveChat(user.id); // an ended chat that was still on screen
  }

  const now = Date.now();
  await run(
    `INSERT INTO queue (user_id, gender, want, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       joined_at = CASE WHEN queue.want = excluded.want THEN queue.joined_at ELSE excluded.joined_at END,
       want = excluded.want, gender = excluded.gender, last_seen = excluded.last_seen`,
    [user.id, want === "any" ? "any" : user.gender, want, now, now],
  );
  await tryMatch(user.id);
}

export async function cancelSearch(userId: number): Promise<void> {
  await run("DELETE FROM queue WHERE user_id = ?", [userId]);
}

export async function heartbeat(userId: number): Promise<void> {
  const now = Date.now();
  // Only revives a row that was seen recently; a long-abandoned search stays dead.
  await run("UPDATE queue SET last_seen = ? WHERE user_id = ? AND last_seen > ?", [now, userId, now - 60_000]);
}

/**
 * Pairs this searcher with the longest-waiting online person who wants what they are and is what they want
 * (or, for a non-specific search, with the longest-waiting person who also chose non-specific).
 * Returns true if a chat was created.
 */
export async function tryMatch(userId: number): Promise<boolean> {
  const now = Date.now();
  const me = await one<QueueRow>("SELECT user_id, gender, want FROM queue WHERE user_id = ?", [userId]);
  if (!me) return false;

  const other = await one<{ user_id: number }>(
    `SELECT q.user_id FROM queue q
     WHERE q.gender = ? AND q.want = ? AND q.user_id != ? AND q.last_seen > ?
       AND NOT EXISTS (
         SELECT 1 FROM chats c
         WHERE c.created_at > ?
           AND ((c.user_a = ? AND c.user_b = q.user_id) OR (c.user_a = q.user_id AND c.user_b = ?))
       )
     ORDER BY q.joined_at LIMIT 1`,
    // A non-specific searcher is stored as ("any", "any"), so the same two-sided test pairs "any" with "any" only.
    [me.want, me.gender, userId, now - ONLINE_MS, now - NO_REMATCH_MS, userId, userId],
  );
  if (!other) return false;

  // Both people may be trying to match at this very moment. One batch is one atomic write, and every
  // statement after the first only acts if the chat row was created - which requires that both people
  // are still waiting. So a loser of the race changes nothing.
  const chatId = randomBytes(12).toString("base64url");
  const ids = [userId, other.user_id];
  const made = "EXISTS (SELECT 1 FROM chats WHERE id = ?)";
  try {
    const db = await getDb();
    const [created] = await db.batch(
      [
        {
          sql: `INSERT INTO chats (id, user_a, user_b, created_at, updated_at)
                SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM queue WHERE user_id IN (?, ?)) = 2`,
          args: [chatId, ...ids, now, now, ...ids],
        },
        { sql: `UPDATE users SET chat_id = ?, last_seen = ? WHERE id IN (?, ?) AND ${made}`, args: [chatId, now, ...ids, chatId] },
        { sql: `DELETE FROM queue WHERE user_id IN (?, ?) AND ${made}`, args: [...ids, chatId] },
        {
          sql: `INSERT INTO messages (chat_id, sender_id, kind, body, created_at) SELECT ?, NULL, 'connected', '', ? WHERE ${made}`,
          args: [chatId, now, chatId],
        },
      ],
      "write",
    );
    return created.rowsAffected === 1;
  } catch (e) {
    // Another match is writing right now. Both people keep polling, so we simply try again on the next tick.
    if (/SQLITE_BUSY|database is locked/i.test(String(e))) return false;
    throw e;
  }
}

/* ------------------------------------------------------------------- chat */

export async function getChat(userId: number, chatId: string | null): Promise<ChatRow | undefined> {
  if (!chatId) return undefined;
  return one<ChatRow>(
    `SELECT id, user_a, user_b, a_open, b_open, status, ended_by, version, reported, updated_at
     FROM chats WHERE id = ? AND (user_a = ? OR user_b = ?)`,
    [chatId, userId, userId],
  );
}

export async function sendMessage(user: User, text: unknown): Promise<{ id: number; at: number }> {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new ApiError(400, "Type a message first.");
  if (body.length > MAX_MESSAGE_LENGTH) throw new ApiError(400, `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
  if (!user.chat_id) throw new ApiError(409, "You are not in a chat.");

  const now = Date.now();
  const recent = await all<{ sender_id: number | null; created_at: number }>(
    "SELECT sender_id, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 25",
    [user.chat_id],
  );
  if (recent.filter((m) => m.sender_id === user.id && now - m.created_at < 10_000).length >= 12) {
    throw new ApiError(429, "You're sending too fast. Slow down a little.");
  }

  const db = await getDb();
  const [inserted] = await db.batch(
    [
      {
        sql: `INSERT INTO messages (chat_id, sender_id, kind, body, created_at)
              SELECT ?, ?, 'msg', ?, ? WHERE EXISTS (SELECT 1 FROM chats WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?))`,
        args: [user.chat_id, user.id, body, now, user.chat_id, user.id, user.id],
      },
      {
        sql: "UPDATE chats SET version = version + 1, updated_at = ? WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?)",
        args: [now, user.chat_id, user.id, user.id],
      },
    ],
    "write",
  );
  if (inserted.rowsAffected === 0) throw new ApiError(409, "This chat has ended.");
  return { id: Number(inserted.lastInsertRowid), at: now };
}

/** Turn anonymity on/off for this user. Off = their username becomes visible to the partner. */
export async function setAnonymous(user: User, anonymous: unknown): Promise<void> {
  if (typeof anonymous !== "boolean") throw new ApiError(400, "Invalid request.");
  const chat = await getChat(user.id, user.chat_id);
  if (!chat || chat.status !== "active") throw new ApiError(409, "This chat has ended.");

  const col = chat.user_a === user.id ? "a_open" : "b_open";
  const open = anonymous ? 0 : 1;
  const now = Date.now();
  // Both statements test the same "state is changing" condition, so repeated clicks do nothing.
  const db = await getDb();
  await db.batch(
    [
      {
        sql: `INSERT INTO messages (chat_id, sender_id, kind, body, created_at)
              SELECT ?, ?, ?, '', ? WHERE EXISTS (SELECT 1 FROM chats WHERE id = ? AND status = 'active' AND ${col} != ?)`,
        args: [chat.id, user.id, anonymous ? "anon_on" : "anon_off", now, chat.id, open],
      },
      {
        sql: `UPDATE chats SET ${col} = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'active' AND ${col} != ?`,
        args: [open, now, chat.id, open],
      },
    ],
    "write",
  );
}

/**
 * Leave the current chat. If it was still running it ends for both people; if the partner already
 * left, this just clears it from the screen. Messages are deleted once both sides are gone
 * (unless the chat was reported).
 */
export async function leaveChat(userId: number): Promise<void> {
  const me = await one<{ chat_id: string | null }>("SELECT chat_id FROM users WHERE id = ?", [userId]);
  if (!me?.chat_id) return;
  const chatId = me.chat_id;
  const now = Date.now();

  const db = await getDb();
  await db.batch(
    [
      {
        sql: `INSERT INTO messages (chat_id, sender_id, kind, body, created_at)
              SELECT ?, ?, 'ended', '', ? WHERE EXISTS (SELECT 1 FROM chats WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?))`,
        args: [chatId, userId, now, chatId, userId, userId],
      },
      {
        sql: `UPDATE chats SET status = 'ended', ended_by = ?, ended_at = ?, updated_at = ?, version = version + 1
              WHERE id = ? AND status = 'active' AND (user_a = ? OR user_b = ?)`,
        args: [userId, now, now, chatId, userId, userId],
      },
      { sql: "UPDATE users SET chat_id = NULL WHERE id = ? AND chat_id = ?", args: [userId, chatId] },
      {
        sql: `DELETE FROM messages WHERE chat_id = ?
              AND NOT EXISTS (SELECT 1 FROM users WHERE chat_id = ?)
              AND NOT EXISTS (SELECT 1 FROM chats WHERE id = ? AND reported = 1)`,
        args: [chatId, chatId, chatId],
      },
    ],
    "write",
  );
}

/** Returns the new report's id, or null if this person had already reported this chat. */
export async function reportChat(user: User, reason: unknown): Promise<number | null> {
  const chat = await getChat(user.id, user.chat_id);
  if (!chat) throw new ApiError(409, "There is no chat to report.");
  const partner = chat.user_a === user.id ? chat.user_b : chat.user_a;
  const text = typeof reason === "string" ? reason.trim().slice(0, 300) : "";

  const db = await getDb();
  const [inserted] = await db.batch(
    [
      {
        sql: "INSERT OR IGNORE INTO reports (chat_id, reporter_id, reported_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [chat.id, user.id, partner, text, Date.now()],
      },
      { sql: "UPDATE chats SET reported = 1 WHERE id = ?", args: [chat.id] }, // keeps the messages for review
    ],
    "write",
  );
  return inserted.rowsAffected === 1 ? Number(inserted.lastInsertRowid) : null;
}
