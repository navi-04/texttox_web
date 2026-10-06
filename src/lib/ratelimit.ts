import { one } from "./db";

/** Fixed-window counter. Returns false once `key` has been hit more than `limit` times in the window. */
export async function allow(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await one<{ count: number }>(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count    = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
     RETURNING count`,
    [key, now + windowMs, now, now, now + windowMs],
  );
  return (row?.count ?? 1) <= limit;
}
