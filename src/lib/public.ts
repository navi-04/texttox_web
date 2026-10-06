import type { User } from "./auth";
import { all, one, run } from "./db";
import { ApiError } from "./errors";
import { allow } from "./ratelimit";

/** Public-room messages disappear this long after they were posted. */
export const PUBLIC_TTL_MS = 48 * 60 * 60 * 1000;
export const MAX_PUBLIC_LENGTH = 500;
/** How many of the newest messages someone sees when they walk in. */
const BACKLOG = 100;

/** How long one poll may wait for news, and how often the server looks while waiting. */
export const PUBLIC_HOLD_MS = 20_000;
const CHECK_MS = 2_000;

export interface PublicMessageView {
  id: number;
  mine: boolean;
  text: string;
  at: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Posts to the public room. Nothing about the author is ever sent back out: others only see the text and the time. */
export async function sendPublic(user: User, text: unknown): Promise<{ id: number; at: number }> {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new ApiError(400, "Type a message first.");
  if (body.length > MAX_PUBLIC_LENGTH) throw new ApiError(400, `Messages in the public room can be up to ${MAX_PUBLIC_LENGTH} characters.`);
  if (!(await allow(`pub:send:${user.id}`, 12, 60_000))) throw new ApiError(429, "You're posting too fast. Slow down a little.");

  const now = Date.now();
  const row = await one<{ id: number }>("INSERT INTO public_messages (user_id, body, created_at) VALUES (?, ?, ?) RETURNING id", [user.id, body, now]);
  if (!row) throw new Error("public message was not saved");
  return { id: Number(row.id), at: now };
}

/**
 * The public room, as a long-poll. `after = 0` answers at once with the newest messages from the last 48 hours;
 * otherwise it answers as soon as something newer than `after` exists, or with nothing after PUBLIC_HOLD_MS.
 */
export async function pollPublic(user: User, after: number, signal?: AbortSignal): Promise<{ messages: PublicMessageView[] }> {
  const deadline = Date.now() + PUBLIC_HOLD_MS;
  // Being in the room counts as being online. One write per request is plenty.
  await run("UPDATE users SET last_seen = ? WHERE id = ?", [Date.now(), user.id]);

  while (true) {
    const cutoff = Date.now() - PUBLIC_TTL_MS;
    const rows =
      after > 0
        ? await all<{ id: number; user_id: number; body: string; created_at: number }>(
            "SELECT id, user_id, body, created_at FROM public_messages WHERE id > ? AND created_at > ? ORDER BY id LIMIT 200",
            [after, cutoff],
          )
        : (
            await all<{ id: number; user_id: number; body: string; created_at: number }>(
              "SELECT id, user_id, body, created_at FROM public_messages WHERE created_at > ? ORDER BY id DESC LIMIT ?",
              [cutoff, BACKLOG],
            )
          ).reverse();

    if (rows.length > 0 || after === 0 || Date.now() >= deadline || signal?.aborted) {
      return { messages: rows.map((m) => ({ id: Number(m.id), mine: Number(m.user_id) === user.id, text: m.body, at: Number(m.created_at) })) };
    }
    await sleep(CHECK_MS);
  }
}
