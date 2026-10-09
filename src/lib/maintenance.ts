import { getDb } from "./db";
import { publicTtlMs } from "./settings";

/** Housekeeping, run now and then from busy endpoints so no cron job is needed. */
export async function cleanup(): Promise<void> {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const publicTtl = await publicTtlMs();
  const db = await getDb();
  await db.batch(
    [
      { sql: "DELETE FROM sessions WHERE expires_at < ?", args: [now] },
      { sql: "DELETE FROM otps WHERE expires_at < ?", args: [now] },
      { sql: "DELETE FROM rate_limits WHERE reset_at < ?", args: [now] },
      { sql: "DELETE FROM queue WHERE last_seen < ?", args: [now - 60_000] },
      // Public-room messages are only shown for the admin's chosen lifetime (see settings.ts); this just frees the space.
      { sql: "DELETE FROM public_messages WHERE created_at < ?", args: [now - publicTtl] },
      // Conversations nobody has touched for a day disappear, unless somebody reported them.
      { sql: "DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE reported = 0 AND updated_at < ?)", args: [dayAgo] },
      { sql: "UPDATE users SET chat_id = NULL WHERE chat_id IN (SELECT id FROM chats WHERE reported = 0 AND updated_at < ?)", args: [dayAgo] },
      { sql: "DELETE FROM chats WHERE reported = 0 AND updated_at < ?", args: [dayAgo] },
    ],
    "write",
  );
}

/** Roughly one call in `n` does the cleanup. Never lets a cleanup failure break the request. */
export async function maybeCleanup(n = 20): Promise<void> {
  if (Math.floor(Math.random() * n) !== 0) return;
  await cleanup().catch((e) => console.error("cleanup failed:", e));
}
