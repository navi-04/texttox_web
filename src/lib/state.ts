import { nameOf, type User, type Gender } from "./auth";
import { heartbeat, tryMatch, type Want } from "./chat";
import { all, one, run } from "./db";
import { answeredSql, MAX_SKIPS, type Kind } from "./game";

/** How long one poll request may wait for news, and how often the server looks while waiting. */
export const HOLD_MS = 20_000;
const CHECK_MS = 800;
/** Nothing can happen to an idle user except through their own actions, so look less often. */
const IDLE_CHECK_MS = 3_000;
/** A partner who hasn't been heard from for this long is shown as offline. */
const PARTNER_ONLINE_MS = 35_000;
/** Signed-in people seen within this long ago count as "online". */
const ONLINE_WINDOW_MS = 60_000;
/** A search whose client vanished for this long is no longer "searching". */
const SEARCH_ALIVE_MS = 60_000;

export interface MessageView {
  id: number;
  kind: "msg" | "info" | "card";
  mine: boolean;
  text: string;
  at: number;
  /** Truth or Dare prompt cards only. `forMe`: I am the one who has to answer it. `byAsker`: typed by the other person rather than drawn from the bank. */
  card?: { type: Kind; forMe: boolean; byAsker: boolean };
}

/** Where a Truth or Dare game stands. `myTurn`: I am the player this round (the one being asked). The other person is the asker. */
export interface GameView {
  phase: "choose" | "ask" | "answer";
  pick: Kind | null;
  myTurn: boolean;
  /** The current prompt was typed by the asker (so skipping it is free). */
  custom: boolean;
  skipsLeft: number;
  /** The player has sent a message since the card appeared, which is what unlocks Done. */
  answered: boolean;
}

export interface ChatView {
  id: string;
  ended: boolean;
  iAmAnonymous: boolean;
  reportedByMe: boolean;
  partner: { revealed: boolean; handle: string | null; online: boolean };
  /** Set for a Truth or Dare chat, null for an ordinary one. */
  game: GameView | null;
  messages: MessageView[];
}

export interface StateView {
  token: string;
  status: "idle" | "searching" | "chatting";
  me: { handle: string; gender: Gender | null };
  want: Want | null;
  chat: ChatView | null;
}

interface Position {
  token: string;
  status: StateView["status"];
  chatId: string | null;
  want: Want | null;
}

/** How many signed-in people have the site open right now. */
export async function onlineCount(): Promise<number> {
  const row = await one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE last_seen > ?", [Date.now() - ONLINE_WINDOW_MS]);
  return row?.n ?? 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One cheap query: where is this user right now, and has it changed? */
async function position(userId: number): Promise<Position> {
  const row = await one<{ chat_id: string | null; version: number | null; status: string | null; want: Want | null; q_seen: number | null }>(
    `SELECT u.chat_id, c.version, c.status, q.want, q.last_seen AS q_seen
     FROM users u
     LEFT JOIN chats c ON c.id = u.chat_id
     LEFT JOIN queue q ON q.user_id = u.id
     WHERE u.id = ?`,
    [userId],
  );
  if (row?.chat_id && row.status) {
    return { token: `c:${row.chat_id}:${row.version}:${row.status}`, status: "chatting", chatId: row.chat_id, want: null };
  }
  if (row?.want && (row.q_seen ?? 0) > Date.now() - SEARCH_ALIVE_MS) {
    return { token: "s", status: "searching", chatId: null, want: row.want };
  }
  return { token: "i", status: "idle", chatId: null, want: null };
}

const INFO_TEXT: Record<string, (mine: boolean, body: string) => string> = {
  connected: () => "You're connected. You are both anonymous - be kind.",
  tod_start: () => "You're connected for Truth or Dare. You are both anonymous - keep it fun.",
  tod_pick: (mine, body) => `${mine ? "You chose" : "Your partner chose"} ${body === "dare" ? "dare" : "truth"}.`,
  tod_done: (mine) => (mine ? "You finished your turn." : "Your partner finished their turn."),
  tod_skip: (mine) => (mine ? "You skipped." : "Your partner skipped."),
  anon_off: (mine) =>
    mine
      ? "You turned anonymity off. Your partner can now see your username."
      : "Your partner turned anonymity off. Their username is shown at the top.",
  anon_on: (mine) => (mine ? "You are anonymous again." : "Your partner is anonymous again."),
  ended: (mine) => (mine ? "You left the chat." : "Your partner left the chat."),
};

async function chatView(user: User, chatId: string, after: number): Promise<ChatView | null> {
  const c = await one<{
    id: string; user_a: number; a_open: number; b_open: number; status: string; partner_username: string | null; partner_email: string; partner_seen: number; reported_by_me: number;
    mode: string; turn_user: number | null; phase: GameView["phase"] | null; pick: Kind | null; custom: number; skips_a: number; skips_b: number; answered: number;
  }>(
    `SELECT c.id, c.user_a, c.a_open, c.b_open, c.status, p.username AS partner_username, p.email AS partner_email, p.last_seen AS partner_seen,
            EXISTS (SELECT 1 FROM reports r WHERE r.chat_id = c.id AND r.reporter_id = ?) AS reported_by_me,
            c.mode, c.turn_user, c.phase, c.pick, c.custom, c.skips_a, c.skips_b,
            CASE WHEN c.mode = 'tod' AND c.phase = 'answer' THEN ${answeredSql("c")} ELSE 0 END AS answered
     FROM chats c JOIN users p ON p.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
     WHERE c.id = ? AND (c.user_a = ? OR c.user_b = ?)`,
    [user.id, user.id, chatId, user.id, user.id],
  );
  if (!c) return null;

  const iAmA = c.user_a === user.id;
  const partnerRevealed = (iAmA ? c.b_open : c.a_open) === 1;

  // `player`: for a Truth or Dare card, who had to answer it (whoever made the pick just before it).
  type Row = { id: number; sender_id: number | null; kind: string; body: string; created_at: number; player: number | null };
  const select = `SELECT m.id, m.sender_id, m.kind, m.body, m.created_at,
                         CASE WHEN m.kind IN ('tod_truth', 'tod_dare') THEN
                           (SELECT p.sender_id FROM messages p WHERE p.chat_id = m.chat_id AND p.kind = 'tod_pick' AND p.id < m.id ORDER BY p.id DESC LIMIT 1)
                         END AS player
                  FROM messages m WHERE m.chat_id = ?`;
  const rows =
    after > 0
      ? await all<Row>(`${select} AND m.id > ? ORDER BY m.id LIMIT 300`, [chatId, after])
      : (await all<Row>(`${select} ORDER BY m.id DESC LIMIT 300`, [chatId])).reverse();

  return {
    id: c.id,
    ended: c.status === "ended",
    iAmAnonymous: (iAmA ? c.a_open : c.b_open) === 0,
    reportedByMe: !!c.reported_by_me,
    partner: {
      revealed: partnerRevealed,
      // The partner's username leaves the server only while they have anonymity switched off.
      handle: partnerRevealed ? nameOf({ username: c.partner_username, email: c.partner_email }) : null,
      online: Date.now() - c.partner_seen < PARTNER_ONLINE_MS,
    },
    game:
      c.mode === "tod" && c.phase
        ? {
            phase: c.phase,
            pick: c.pick,
            myTurn: c.turn_user === user.id,
            custom: c.custom === 1,
            skipsLeft: Math.max(0, MAX_SKIPS - (iAmA ? c.skips_a : c.skips_b)),
            answered: c.answered === 1,
          }
        : null,
    messages: rows.map((m): MessageView => {
      const mine = m.sender_id === user.id;
      if (m.kind === "msg") return { id: m.id, kind: "msg", mine, text: m.body, at: m.created_at };
      if (m.kind === "tod_truth" || m.kind === "tod_dare") {
        // Never says who typed a prompt, only whether it was me.
        return {
          id: m.id,
          kind: "card",
          mine,
          text: m.body,
          at: m.created_at,
          card: { type: m.kind === "tod_dare" ? "dare" : "truth", forMe: m.player === user.id, byAsker: m.sender_id !== null },
        };
      }
      return { id: m.id, kind: "info", mine, text: INFO_TEXT[m.kind]?.(mine, m.body) ?? "", at: m.created_at };
    }),
  };
}

async function buildView(user: User, pos: Position, knownChat: string | null, after: number): Promise<StateView> {
  return {
    token: pos.token,
    status: pos.status,
    me: { handle: nameOf(user), gender: user.gender },
    want: pos.want,
    // `after` only makes sense for the chat the client was already looking at.
    chat: pos.chatId ? await chatView(user, pos.chatId, pos.chatId === knownChat ? after : 0) : null,
  };
}

/**
 * Long-poll. `known` is the token the client last saw; we answer as soon as it differs from the
 * current one (a match, a new message, anonymity toggled, chat ended...) or after HOLD_MS.
 * `known = null` answers immediately.
 */
export async function pollState(
  user: User,
  known: string | null,
  knownChat: string | null,
  after: number,
  signal?: AbortSignal,
): Promise<StateView> {
  const deadline = Date.now() + HOLD_MS;
  let lastBeat = 0;

  while (true) {
    const now = Date.now();
    let pos = await position(user.id);

    // Keep our own "online" markers fresh without writing on every tick. An idle page checks in once per
    // request (the 30s is longer than a request lasts), which is enough for the online counter.
    const beatEvery = pos.status === "searching" ? 5_000 : pos.status === "chatting" ? 10_000 : 30_000;
    if (now - lastBeat >= beatEvery) {
      lastBeat = now;
      if (pos.status === "searching") await heartbeat(user.id);
      await run("UPDATE users SET last_seen = ? WHERE id = ?", [now, user.id]);
    }

    if (pos.status === "searching" && (await tryMatch(user.id))) pos = await position(user.id);

    if (pos.token !== known || now >= deadline || signal?.aborted) {
      return buildView(user, pos, knownChat, after);
    }
    await sleep(pos.status === "idle" ? IDLE_CHECK_MS : CHECK_MS);
  }
}
