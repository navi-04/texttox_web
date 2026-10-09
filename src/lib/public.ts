import type { User } from "./auth";
import { all, one, run } from "./db";
import { ApiError } from "./errors";
import { allow } from "./ratelimit";
import { getPublicTtlHours } from "./settings";

export const MAX_PUBLIC_LENGTH = 500;
/** How many of the newest messages someone sees when they walk in. */
const BACKLOG = 100;

/** How long one poll may wait for news, and how often the server looks while waiting. */
export const PUBLIC_HOLD_MS = 20_000;
const CHECK_MS = 2_000;

/** The message a reply answers. `text` is null when that message has since been deleted or has expired. */
export interface PublicReplyView {
  id: number;
  text: string | null;
  mine: boolean;
}

export interface PublicMessageView {
  id: number;
  mine: boolean;
  text: string;
  at: number;
  reply?: PublicReplyView;
}

/** How much of the quoted message a reply carries. */
const QUOTE_LENGTH = 140;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Posts to the public room. Nothing about the author is ever sent back out: others only see the text and the time. */
export async function sendPublic(user: User, text: unknown, replyTo?: unknown): Promise<{ id: number; at: number; reply?: PublicReplyView }> {
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new ApiError(400, "Type a message first.");
  if (body.length > MAX_PUBLIC_LENGTH) throw new ApiError(400, `Messages in the public room can be up to ${MAX_PUBLIC_LENGTH} characters.`);
  if (!(await allow(`pub:send:${user.id}`, 12, 60_000))) throw new ApiError(429, "You're posting too fast. Slow down a little.");

  // A reply must point at a message that is still there. Whose it is stays hidden: only "you" or "anonymous" is ever shown.
  let reply: PublicReplyView | undefined;
  if (replyTo !== undefined && replyTo !== null) {
    if (typeof replyTo !== "number" || !Number.isInteger(replyTo) || replyTo < 1) throw new ApiError(400, "Choose a message to reply to.");
    const cutoff = Date.now() - (await getPublicTtlHours()) * 60 * 60 * 1000;
    const target = await one<{ user_id: number; body: string }>("SELECT user_id, body FROM public_messages WHERE id = ? AND created_at > ?", [replyTo, cutoff]);
    if (!target) throw new ApiError(409, "The message you are replying to is no longer there.");
    reply = { id: replyTo, text: quote(target.body), mine: Number(target.user_id) === user.id };
  }

  const now = Date.now();
  const row = await one<{ id: number }>("INSERT INTO public_messages (user_id, body, reply_to, created_at) VALUES (?, ?, ?, ?) RETURNING id", [
    user.id,
    body,
    reply ? reply.id : null,
    now,
  ]);
  if (!row) throw new Error("public message was not saved");
  return { id: Number(row.id), at: now, ...(reply ? { reply } : {}) };
}

const quote = (body: string) => (body.length > QUOTE_LENGTH ? body.slice(0, QUOTE_LENGTH).trimEnd() + "…" : body);

interface Row {
  id: number;
  user_id: number;
  body: string;
  created_at: number;
  reply_to: number | null;
  r_body: string | null;
  r_user: number | null;
}

const SELECT = `SELECT m.id, m.user_id, m.body, m.created_at, m.reply_to, o.body AS r_body, o.user_id AS r_user
  FROM public_messages m LEFT JOIN public_messages o ON o.id = m.reply_to AND o.created_at > ?`

/**
 * The public room, as a long-poll. `after = 0` answers at once with the newest messages that have not expired yet
 * (the lifetime is the admin's setting, 12 to 48 hours, and is sent back as `ttlHours`); otherwise it answers as soon
 * as something newer than `after` exists, or with nothing after PUBLIC_HOLD_MS.
 */
export async function pollPublic(user: User, after: number, signal?: AbortSignal): Promise<{ messages: PublicMessageView[]; ttlHours: number }> {
  const deadline = Date.now() + PUBLIC_HOLD_MS;
  // Being in the room counts as being online. One write per request is plenty.
  await run("UPDATE users SET last_seen = ? WHERE id = ?", [Date.now(), user.id]);

  while (true) {
    const ttlHours = await getPublicTtlHours();
    const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
    // The join only finds the quoted message while it is still live, so deleted or expired originals show as "gone".
    const rows =
      after > 0
        ? await all<Row>(`${SELECT} WHERE m.id > ? AND m.created_at > ? ORDER BY m.id LIMIT 200`, [cutoff, after, cutoff])
        : (await all<Row>(`${SELECT} WHERE m.created_at > ? ORDER BY m.id DESC LIMIT ?`, [cutoff, cutoff, BACKLOG])).reverse();

    if (rows.length > 0 || after === 0 || Date.now() >= deadline || signal?.aborted) {
      return {
        messages: rows.map((m): PublicMessageView => {
          const view: PublicMessageView = { id: Number(m.id), mine: Number(m.user_id) === user.id, text: m.body, at: Number(m.created_at) };
          if (m.reply_to !== null && m.reply_to !== undefined) {
            view.reply = { id: Number(m.reply_to), text: m.r_body === null ? null : quote(m.r_body), mine: m.r_user !== null && Number(m.r_user) === user.id };
          }
          return view;
        }),
        ttlHours,
      };
    }
    await sleep(CHECK_MS);
  }
}
