import { randomInt } from "node:crypto";
import type { User } from "./auth";
import { getChat, type ChatRow } from "./chat";
import { all, batch, one } from "./db";
import { ApiError } from "./errors";
import { allow } from "./ratelimit";
import { DARES, TRUTHS } from "./tod-prompts";

/**
 * Truth or Dare, played inside an ordinary chat (chats.mode = 'tod'). Each round has one "player" (chats.turn_user) and
 * one "asker" (the other person):
 *   choose  the player picks truth or dare
 *   ask     the asker draws one from the bank or types their own (the player just waits: they don't get to pick their own)
 *   answer  the card is on screen; the player replies in the chat, and only once they have sent that reply can they finish
 *           (or they skip), and the turn passes
 * Every action is one atomic batch that only acts if the chat is still in the state it was read in, so a double tap or
 * two phones acting at once can't make two moves.
 */
export type Kind = "truth" | "dare";

export const MAX_SKIPS = 2; // per person, for prompts from the bank (skipping a prompt the partner typed is always free)
export const MIN_PROMPT = 5;
export const MAX_PROMPT = 200;

/* -------------------------------------------------------------- screening */

// Whole words only. A first filter, not a promise: a list can't know every language or spelling, which is why a
// prompt typed by the partner can always be skipped for free and the chat can be reported.
const NOT_SUITABLE =
  /\b(sex|sexy|sexual|nude|nudes|naked|porn|porno|boob|boobs|breast|breasts|penis|vagina|dick|cock|pussy|fuck|fucking|fucker|bitch|slut|whore|rape|rapist|horny|hookup|hook up|kiss|kissing|cuddle|undress|strip off|bra|panties|underwear|thong|suicide|kys|kill yourself|kill urself|drunk|vodka|beer|whisky|whiskey|weed|ganja|cigarette|cigarettes|drugs)\b/;
// Pushing the other person to leave the app, or to say who they are.
const CONTACT_APPS = ["whatsapp", "instagram", "snapchat", "telegram", "facebook", "discord"];
const CONTACT_WORDS =
  /\b(insta|phone number|mobile number|contact number|your address|home address|real name|full name|your surname|where do you (live|stay)|(which|what) (college|school|city|town) (are you|do you|did you|is your))\b/;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", $: "s" };

/** Returns what is wrong with a prompt a person typed, or null if it is fine. */
export function screenPrompt(text: string): string | null {
  if (text.includes("@")) return "Leave out @names and email addresses.";
  if (/https?:|www\.|\b[a-z0-9-]+\.(?:com|in|net|org|io|me|co|app|xyz|link|ly|gl|gg)\b/i.test(text)) return "Leave out links.";
  if (/(?:\d[\s().+-]*){7,}/.test(text)) return "Leave out phone numbers.";

  const lower = text.toLowerCase().replace(/[01345$]/g, (c) => LEET[c]);
  const squashed = lower.replace(/[^a-z]/g, "");
  if (CONTACT_APPS.some((w) => squashed.includes(w)) || CONTACT_WORDS.test(lower)) return "Keep it inside this chat: no social media, contact details or questions about who they are.";
  if (NOT_SUITABLE.test(lower)) return "That isn't suitable here. Keep it fun and clean.";
  return null;
}

/* --------------------------------------------------------------- helpers */

const kindOf = (v: unknown): Kind => {
  if (v !== "truth" && v !== "dare") throw new ApiError(400, "Choose truth or dare.");
  return v;
};

/** The chat this person is in, if it is a running Truth or Dare game. */
async function runningGame(user: User): Promise<ChatRow> {
  if (!(await allow(`game:${user.id}`, 40, 60_000))) throw new ApiError(429, "You're going a little fast. Slow down.");
  const chat = await getChat(user.id, user.chat_id);
  if (!chat || chat.mode !== "tod") throw new ApiError(409, "There is no Truth or Dare game here.");
  if (chat.status !== "active") throw new ApiError(409, "This chat has ended.");
  return chat;
}

/** Plays one move: adds a line to the chat and updates the game, only if `guard` still holds. Returns false if it no longer does. */
async function move(
  chat: ChatRow,
  actor: number,
  kind: string,
  body: string,
  guard: { sql: string; args: (string | number)[] },
  set: { sql: string; args: (string | number | null)[] },
  senderId: number | null = actor,
): Promise<boolean> {
  const now = Date.now();
  const where = `id = ? AND mode = 'tod' AND status = 'active' AND ${guard.sql}`;
  const [, updated] = await batch([
    {
      sql: `INSERT INTO messages (chat_id, sender_id, kind, body, created_at)
            SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM chats WHERE ${where})`,
      args: [chat.id, senderId, kind, body, now, chat.id, ...guard.args],
    },
    {
      sql: `UPDATE chats SET ${set.sql}, version = version + 1, updated_at = ? WHERE ${where}`,
      args: [...set.args, now, chat.id, ...guard.args],
    },
  ]);
  return updated.rowsAffected === 1;
}

const otherPlayer = "CASE WHEN user_a = turn_user THEN user_b ELSE user_a END";

/**
 * SQL: has the player sent a message in the chat since the current card appeared? `t` is the chats table (or its alias) in
 * the query this goes into. Used both to enable the Done button (state.ts) and to enforce it (finishTurn).
 */
export const answeredSql = (t: string) =>
  `EXISTS (SELECT 1 FROM messages a WHERE a.chat_id = ${t}.id AND a.kind = 'msg' AND a.sender_id = ${t}.turn_user
           AND a.id > COALESCE((SELECT MAX(p.id) FROM messages p WHERE p.chat_id = ${t}.id AND p.kind IN ('tod_truth', 'tod_dare')), 0))`;

/* ----------------------------------------------------------------- moves */

/** The player says whether they want a truth or a dare. */
export async function pickKind(user: User, rawKind: unknown): Promise<void> {
  const kind = kindOf(rawKind);
  const chat = await runningGame(user);
  if (chat.turn_user !== user.id || chat.phase !== "choose") throw new ApiError(409, "It isn't your turn to choose.");
  const ok = await move(
    chat, user.id, "tod_pick", kind,
    { sql: "turn_user = ? AND phase = 'choose'", args: [user.id] },
    { sql: "phase = 'ask', pick = ?, custom = 0", args: [kind] },
  );
  if (!ok) throw new ApiError(409, "That moment has passed.");
}

/** A prompt from the bank, for the current pick. Only the asker can ask for it; prompts already used in this chat are left out. */
export async function drawPrompt(user: User): Promise<void> {
  const chat = await runningGame(user);
  if (chat.phase !== "ask" || !chat.pick) throw new ApiError(409, "Nothing is waiting for a prompt.");
  if (chat.turn_user === user.id) throw new ApiError(409, "Your partner picks yours.");
  const bank = chat.pick === "truth" ? TRUTHS : DARES;
  const used = new Set(
    (await all<{ body: string }>("SELECT body FROM messages WHERE chat_id = ? AND kind = ? AND sender_id IS NULL", [chat.id, `tod_${chat.pick}`])).map((r) => r.body),
  );
  const fresh = bank.filter((p) => !used.has(p));
  const pool = fresh.length > 0 ? fresh : bank; // a very long game may see a repeat
  const prompt = pool[randomInt(pool.length)];
  const ok = await move(
    chat, user.id, `tod_${chat.pick}`, prompt,
    { sql: "phase = 'ask' AND pick = ? AND turn_user != ?", args: [chat.pick, user.id] },
    { sql: "phase = 'answer', custom = 0", args: [] },
    null, // from the bank, so nobody wrote it
  );
  if (!ok) throw new ApiError(409, "That moment has passed.");
}

/** The asker types their own truth or dare. */
export async function writePrompt(user: User, text: unknown): Promise<void> {
  const body = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  if (body.length < MIN_PROMPT) throw new ApiError(400, "Write a little more.");
  if (body.length > MAX_PROMPT) throw new ApiError(400, `Keep it under ${MAX_PROMPT} characters.`);
  const problem = screenPrompt(body);
  if (problem) throw new ApiError(400, problem);

  const chat = await runningGame(user);
  if (chat.phase !== "ask" || !chat.pick) throw new ApiError(409, "Nothing is waiting for a prompt.");
  if (chat.turn_user === user.id) throw new ApiError(409, "Your partner writes yours. Or draw one from the deck.");
  const ok = await move(
    chat, user.id, `tod_${chat.pick}`, body,
    { sql: "phase = 'ask' AND pick = ? AND turn_user != ?", args: [chat.pick, user.id] },
    { sql: "phase = 'answer', custom = 1", args: [] },
  );
  if (!ok) throw new ApiError(409, "That moment has passed.");
}

/** The player is done with their turn: it passes to the other person. They have to have answered in the chat first. */
export async function finishTurn(user: User): Promise<void> {
  const chat = await runningGame(user);
  if (chat.turn_user !== user.id || chat.phase !== "answer") throw new ApiError(409, "There is nothing to finish.");
  const answered = await one<{ ok: number }>(`SELECT ${answeredSql("c")} AS ok FROM chats c WHERE c.id = ?`, [chat.id]);
  if (!answered?.ok) throw new ApiError(409, "Send your answer in the chat first.");
  const ok = await move(
    chat, user.id, "tod_done", "",
    { sql: `turn_user = ? AND phase = 'answer' AND ${answeredSql("chats")}`, args: [user.id] },
    { sql: `turn_user = ${otherPlayer}, phase = 'choose', pick = NULL, custom = 0`, args: [] },
  );
  if (!ok) throw new ApiError(409, "That moment has passed.");
}

/** The player passes on this prompt. The turn goes to the other person. Bank prompts can be skipped twice; typed ones always. */
export async function skipTurn(user: User): Promise<void> {
  const chat = await runningGame(user);
  if (chat.turn_user !== user.id || chat.phase !== "answer") throw new ApiError(409, "There is nothing to skip.");
  const col = chat.user_a === user.id ? "skips_a" : "skips_b";
  if (!chat.custom && (chat.user_a === user.id ? chat.skips_a : chat.skips_b) >= MAX_SKIPS) {
    throw new ApiError(409, "No skips left. Answer this one, or leave the chat.");
  }
  const ok = await move(
    chat, user.id, "tod_skip", "",
    { sql: `turn_user = ? AND phase = 'answer' AND (custom = 1 OR ${col} < ${MAX_SKIPS})`, args: [user.id] },
    // SET sees the row as it was, so a typed prompt costs nothing.
    { sql: `${col} = ${col} + (CASE WHEN custom = 1 THEN 0 ELSE 1 END), turn_user = ${otherPlayer}, phase = 'choose', pick = NULL, custom = 0`, args: [] },
  );
  if (!ok) throw new ApiError(409, "That moment has passed.");
}
