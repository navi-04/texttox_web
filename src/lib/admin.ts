import { createHmac } from "node:crypto";
import type { InValue } from "@libsql/client";
import { safeEqual, secret, sha256 } from "./auth";
import { leaveChat } from "./chat";
import { all, getDb, one, run } from "./db";
import { ApiError } from "./errors";
import { getPublicTtlHours, isPublicTtl, publicTtlMs, storePublicTtlHours, type PublicTtlHours } from "./settings";

/* ------------------------------------------------------------------- login */

export const ADMIN_COOKIE = "ttx_admin";
export const ADMIN_TTL_MS = 8 * 60 * 60 * 1000;

/** Admin is off until both values are set, and the password is long enough to not be guessed in a day. */
function credentials(): { username: string; password: string } | null {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  return username && password && password.length >= 10 ? { username, password } : null;
}

/** True if `id` is the admin's username, so the ordinary sign-in form can hand the admin over to the admin login. */
export function isAdminUsername(id: unknown): boolean {
  const c = credentials();
  return !!c && typeof id === "string" && !id.includes("@") && id.trim() === c.username;
}

// Changing the username or password changes every signature, so it signs the admin out everywhere.
const sign = (exp: number, c: { username: string; password: string }) =>
  createHmac("sha256", secret()).update(`admin:${exp}:${sha256(`${c.username}\n${c.password}`)}`).digest("base64url");

/** Checks the login and returns the value for the admin cookie. */
export function adminLogin(username: unknown, password: unknown): string {
  const c = credentials();
  if (!c) throw new ApiError(503, "Admin is not set up yet. Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 10 characters).");
  // Check both before answering so a wrong username isn't faster to reject than a wrong password.
  const userOk = typeof username === "string" && safeEqual(sha256(username.trim()), sha256(c.username));
  const passOk = typeof password === "string" && safeEqual(sha256(password), sha256(c.password));
  if (!userOk || !passOk) throw new ApiError(401, "Wrong username or password.");
  const exp = Date.now() + ADMIN_TTL_MS;
  return `${exp}.${sign(exp, c)}`;
}

export function isAdmin(cookie: string | undefined): boolean {
  const c = credentials();
  if (!c || !cookie) return false;
  const [expText, sig] = cookie.split(".");
  const exp = Number(expText);
  return Number.isFinite(exp) && exp > Date.now() && !!sig && safeEqual(sig, sign(exp, c));
}

/* ------------------------------------------------------------------- types */

const ONLINE_MS = 60_000;
const SEARCH_ALIVE_MS = 20_000;

export type ReportStatus = "open" | "dismissed" | "actioned";

export interface UserRow {
  id: number;
  email: string;
  username: string | null;
  gender: "boy" | "girl" | null;
  blocked: boolean;
  createdAt: number;
  lastSeen: number;
  online: boolean;
  inChat: boolean;
  searching: boolean;
  reportsAgainst: number;
}

export interface ReportRow {
  id: number;
  chatId: string;
  reason: string;
  status: ReportStatus;
  at: number;
  reporter: { id: number; email: string; username: string | null };
  reported: { id: number; email: string; username: string | null; blocked: boolean };
  timesReported: number;
}

export interface TimelineItem {
  id: number;
  who: "reporter" | "reported" | "system";
  kind: "msg" | "info";
  text: string;
  at: number;
}

export interface ReportDetail extends ReportRow {
  chat: { status: "active" | "ended"; startedAt: number } | null; // null = the conversation was deleted
  reporterInfo: UserRow;
  reportedInfo: UserRow;
  timeline: TimelineItem[];
}

export interface UserDetail extends UserRow {
  chatsCount: number;
  reportsAgainstList: ReportRow[];
  reportsByList: ReportRow[];
}

export interface Overview {
  users: number;
  online: number;
  searching: number;
  activeChats: number;
  openReports: number;
  blocked: number;
  newToday: number;
  activity: { id: number; at: number; action: string; detail: string }[];
}

/* ----------------------------------------------------------------- queries */

const REPORT_SELECT = `
  SELECT r.id, r.chat_id, r.reason, r.status, r.created_at,
         rp.id AS reporter_id, rp.email AS reporter_email, rp.username AS reporter_username,
         rd.id AS reported_id, rd.email AS reported_email, rd.username AS reported_username, rd.banned AS reported_banned,
         (SELECT COUNT(*) FROM reports x WHERE x.reported_id = r.reported_id) AS times_reported
  FROM reports r
  JOIN users rp ON rp.id = r.reporter_id
  JOIN users rd ON rd.id = r.reported_id`;

type Raw = Record<string, string | number | null>;

const mapReport = (r: Raw): ReportRow => ({
  id: Number(r.id),
  chatId: String(r.chat_id),
  reason: String(r.reason ?? ""),
  status: r.status as ReportStatus,
  at: Number(r.created_at),
  reporter: { id: Number(r.reporter_id), email: String(r.reporter_email), username: (r.reporter_username as string | null) ?? null },
  reported: { id: Number(r.reported_id), email: String(r.reported_email), username: (r.reported_username as string | null) ?? null, blocked: r.reported_banned === 1 },
  timesReported: Number(r.times_reported),
});

const USER_SELECT = `
  SELECT u.id, u.email, u.username, u.gender, u.banned, u.created_at, u.last_seen,
         (u.chat_id IS NOT NULL) AS in_chat,
         EXISTS (SELECT 1 FROM queue q WHERE q.user_id = u.id AND q.last_seen > ?) AS searching,
         (SELECT COUNT(*) FROM reports r WHERE r.reported_id = u.id) AS reports_against
  FROM users u`;

const mapUser = (r: Raw): UserRow => ({
  id: Number(r.id),
  email: String(r.email),
  username: (r.username as string | null) ?? null,
  gender: (r.gender as UserRow["gender"]) ?? null,
  blocked: r.banned === 1,
  createdAt: Number(r.created_at),
  lastSeen: Number(r.last_seen),
  online: Number(r.last_seen) > Date.now() - ONLINE_MS,
  inChat: r.in_chat === 1,
  searching: r.searching === 1,
  reportsAgainst: Number(r.reports_against),
});

const searchCutoff = () => Date.now() - SEARCH_ALIVE_MS;

export async function overview(): Promise<Overview> {
  const now = Date.now();
  const row = await one<Raw>(
    `SELECT
       (SELECT COUNT(*) FROM users)                                        AS users,
       (SELECT COUNT(*) FROM users WHERE last_seen > ?)                    AS online,
       (SELECT COUNT(*) FROM queue WHERE last_seen > ?)                    AS searching,
       (SELECT COUNT(*) FROM chats WHERE status = 'active')                AS active_chats,
       (SELECT COUNT(*) FROM reports WHERE status = 'open')                AS open_reports,
       (SELECT COUNT(*) FROM users WHERE banned = 1)                       AS blocked,
       (SELECT COUNT(*) FROM users WHERE created_at > ?)                   AS new_today`,
    [now - ONLINE_MS, searchCutoff(), now - 24 * 60 * 60 * 1000],
  );
  const activity = await all<Raw>("SELECT id, at, action, detail FROM admin_log ORDER BY id DESC LIMIT 20");
  return {
    users: Number(row?.users ?? 0),
    online: Number(row?.online ?? 0),
    searching: Number(row?.searching ?? 0),
    activeChats: Number(row?.active_chats ?? 0),
    openReports: Number(row?.open_reports ?? 0),
    blocked: Number(row?.blocked ?? 0),
    newToday: Number(row?.new_today ?? 0),
    activity: activity.map((a) => ({ id: Number(a.id), at: Number(a.at), action: String(a.action), detail: String(a.detail) })),
  };
}

export async function listReports(closed: boolean): Promise<ReportRow[]> {
  const rows = await all<Raw>(`${REPORT_SELECT} WHERE r.status ${closed ? "!=" : "="} 'open' ORDER BY r.id DESC LIMIT 100`);
  return rows.map(mapReport);
}

async function userRow(id: number): Promise<UserRow> {
  const row = await one<Raw>(`${USER_SELECT} WHERE u.id = ?`, [searchCutoff(), id]);
  if (!row) throw new ApiError(404, "User not found.");
  return mapUser(row);
}

export async function reportDetail(id: number): Promise<ReportDetail> {
  const row = await one<Raw>(`${REPORT_SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw new ApiError(404, "Report not found.");
  const report = mapReport(row);

  const chat = await one<{ status: "active" | "ended"; created_at: number }>("SELECT status, created_at FROM chats WHERE id = ?", [report.chatId]);
  const messages = (
    await all<Raw>("SELECT id, sender_id, kind, body, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 500", [report.chatId])
  ).reverse();

  const events: Record<string, (who: string, body: string) => string> = {
    connected: () => "Chat started",
    anon_off: (who) => `${who} turned anonymity off`,
    anon_on: (who) => `${who} turned anonymity back on`,
    ended: (who) => `${who} left the chat`,
    tod_start: () => "Truth or Dare chat started",
    tod_pick: (who, body) => `${who} chose ${body === "dare" ? "dare" : "truth"}`,
    tod_done: (who) => `${who} finished their turn`,
    tod_skip: (who) => `${who} skipped`,
    // A prompt card: the text is shown, and who typed it (nobody, if it came from the bank).
    tod_truth: (who, body) => `Truth ${who === "Someone" ? "from the bank" : `typed by ${who}`}: ${body}`,
    tod_dare: (who, body) => `Dare ${who === "Someone" ? "from the bank" : `typed by ${who}`}: ${body}`,
  };
  const timeline = messages.map((m): TimelineItem => {
    const who = m.sender_id === report.reporter.id ? "reporter" : m.sender_id === report.reported.id ? "reported" : "system";
    const name = who === "reporter" ? "Reporter" : who === "reported" ? "Reported" : "Someone";
    return m.kind === "msg"
      ? { id: Number(m.id), who, kind: "msg", text: String(m.body), at: Number(m.created_at) }
      : { id: Number(m.id), who, kind: "info", text: events[String(m.kind)]?.(name, String(m.body)) ?? String(m.kind), at: Number(m.created_at) };
  });

  return {
    ...report,
    chat: chat ? { status: chat.status, startedAt: Number(chat.created_at) } : null,
    reporterInfo: await userRow(report.reporter.id),
    reportedInfo: await userRow(report.reported.id),
    timeline,
  };
}

export async function listUsers(q: string, filter: string): Promise<UserRow[]> {
  const where: string[] = [];
  const args: InValue[] = [searchCutoff()];
  const needle = q.trim().toLowerCase();
  if (needle) {
    where.push("(u.email LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
    args.push(like, like);
  }
  if (filter === "online") {
    where.push("u.last_seen > ?");
    args.push(Date.now() - ONLINE_MS);
  } else if (filter === "blocked") {
    where.push("u.banned = 1");
  } else if (filter === "reported") {
    where.push("EXISTS (SELECT 1 FROM reports r WHERE r.reported_id = u.id)");
  } else if (filter === "unset") {
    where.push("u.gender IS NULL");
  }
  const rows = await all<Raw>(`${USER_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.last_seen DESC, u.id DESC LIMIT 50`, args);
  return rows.map(mapUser);
}

export async function userDetail(id: number): Promise<UserDetail> {
  const user = await userRow(id);
  const count = await one<{ n: number }>("SELECT COUNT(*) AS n FROM chats WHERE user_a = ? OR user_b = ?", [id, id]);
  const against = await all<Raw>(`${REPORT_SELECT} WHERE r.reported_id = ? ORDER BY r.id DESC LIMIT 50`, [id]);
  const by = await all<Raw>(`${REPORT_SELECT} WHERE r.reporter_id = ? ORDER BY r.id DESC LIMIT 50`, [id]);
  return { ...user, chatsCount: count?.n ?? 0, reportsAgainstList: against.map(mapReport), reportsByList: by.map(mapReport) };
}

/* ----------------------------------------------------------------- actions */

async function log(action: string, detail = ""): Promise<void> {
  await run("INSERT INTO admin_log (at, action, detail) VALUES (?, ?, ?)", [Date.now(), action, detail]);
  await run("DELETE FROM admin_log WHERE id <= (SELECT MAX(id) FROM admin_log) - 500"); // keep the last 500
}

async function emailOf(userId: number): Promise<string> {
  const u = await one<{ email: string }>("SELECT email FROM users WHERE id = ?", [userId]);
  if (!u) throw new ApiError(404, "User not found.");
  return u.email;
}

/** Block: signed out everywhere, taken out of the queue, and their chat (if any) ends. Unblock lets them log in again. */
export async function setBlocked(userId: number, blocked: boolean, reportId?: number): Promise<void> {
  const email = await emailOf(userId);
  await run("UPDATE users SET banned = ? WHERE id = ?", [blocked ? 1 : 0, userId]);
  if (blocked) {
    await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
    await run("DELETE FROM queue WHERE user_id = ?", [userId]);
    await leaveChat(userId);
    if (reportId) await run("UPDATE reports SET status = 'actioned' WHERE id = ? AND status = 'open'", [reportId]);
  }
  await log(blocked ? "Blocked user" : "Unblocked user", email);
}

export async function signOutEverywhere(userId: number): Promise<void> {
  const email = await emailOf(userId);
  await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  await log("Signed user out everywhere", email);
}

/**
 * Set someone's gender, or clear it (null) so they choose again the next time they open the site.
 * A real change also ends their chat and search, because both were set up on the old value.
 */
export async function setUserGender(userId: number, gender: "boy" | "girl" | null): Promise<void> {
  const u = await one<{ email: string; gender: string | null }>("SELECT email, gender FROM users WHERE id = ?", [userId]);
  if (!u) throw new ApiError(404, "User not found.");
  if (u.gender === gender) return;
  await run("UPDATE users SET gender = ? WHERE id = ?", [gender, userId]);
  if (u.gender) {
    await run("DELETE FROM queue WHERE user_id = ?", [userId]);
    await leaveChat(userId);
  }
  await log(gender ? "Set gender" : "Cleared gender", gender ? `${u.email}: ${gender}` : u.email);
}

export async function endUserChat(userId: number): Promise<void> {
  const email = await emailOf(userId);
  await leaveChat(userId);
  await log("Ended user's chat", email);
}

/** Close a report with no action. Once nothing else needs the conversation it is deleted. */
export async function dismissReport(reportId: number): Promise<void> {
  const r = await one<{ chat_id: string }>("SELECT chat_id FROM reports WHERE id = ?", [reportId]);
  if (!r) throw new ApiError(404, "Report not found.");
  const db = await getDb();
  await db.batch(
    [
      { sql: "UPDATE reports SET status = 'dismissed' WHERE id = ?", args: [reportId] },
      {
        sql: `UPDATE chats SET reported = CASE WHEN EXISTS (SELECT 1 FROM reports WHERE chat_id = ? AND status != 'dismissed') THEN 1 ELSE 0 END
              WHERE id = ?`,
        args: [r.chat_id, r.chat_id],
      },
      {
        sql: `DELETE FROM messages WHERE chat_id = ?
              AND NOT EXISTS (SELECT 1 FROM users WHERE chat_id = ?)
              AND NOT EXISTS (SELECT 1 FROM chats WHERE id = ? AND reported = 1)`,
        args: [r.chat_id, r.chat_id, r.chat_id],
      },
    ],
    "write",
  );
  await log("Dismissed report", `#${reportId}`);
}

/** Delete one conversation and the reports about it. People still inside it are returned to the home screen. */
export async function deleteChat(chatId: string): Promise<void> {
  const db = await getDb();
  await db.batch(
    [
      { sql: "DELETE FROM messages WHERE chat_id = ?", args: [chatId] },
      { sql: "DELETE FROM reports WHERE chat_id = ?", args: [chatId] },
      { sql: "UPDATE users SET chat_id = NULL WHERE chat_id = ?", args: [chatId] },
      { sql: "DELETE FROM chats WHERE id = ?", args: [chatId] },
    ],
    "write",
  );
  await log("Deleted conversation", chatId);
}

export interface PublicMessageRow {
  id: number;
  userId: number;
  username: string | null;
  email: string;
  blocked: boolean;
  text: string;
  at: number;
}

/** The public room's messages that have not expired yet (newest first). Only the admin ever sees who wrote them. */
export async function listPublicMessages(): Promise<PublicMessageRow[]> {
  const rows = await all<Raw>(
    `SELECT m.id, m.user_id, m.body, m.created_at, u.username, u.email, u.banned
     FROM public_messages m JOIN users u ON u.id = m.user_id
     WHERE m.created_at > ? ORDER BY m.id DESC LIMIT 200`,
    [Date.now() - (await publicTtlMs())],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    username: (r.username as string | null) ?? null,
    email: String(r.email),
    blocked: r.banned === 1,
    text: String(r.body),
    at: Number(r.created_at),
  }));
}

export async function deletePublicMessage(id: number): Promise<void> {
  if ((await run("DELETE FROM public_messages WHERE id = ?", [id])) === 0) throw new ApiError(404, "Message not found.");
  await log("Deleted public message", `#${id}`);
}

/**
 * Sets how long public-room messages live (12, 24, 36 or 48 hours). Anything already older than the new limit is
 * deleted right away, so shortening takes effect at once and lengthening later can't bring those messages back.
 */
export async function setPublicTtl(hours: unknown): Promise<{ hours: PublicTtlHours; removed: number }> {
  if (!isPublicTtl(hours)) throw new ApiError(400, "Choose 12, 24, 36 or 48 hours.");
  const before = await getPublicTtlHours();
  await storePublicTtlHours(hours);
  const removed = await run("DELETE FROM public_messages WHERE created_at < ?", [Date.now() - hours * 60 * 60 * 1000]);
  if (hours !== before) {
    await log("Changed public room lifetime", `${before} h to ${hours} h${removed ? `, ${removed} old message${removed === 1 ? "" : "s"} deleted` : ""}`);
  }
  return { hours, removed };
}

/** Empties the public room: every message, from everyone. Accounts are untouched. Returns how many were removed. */
export async function deleteAllPublicMessages(): Promise<number> {
  const removed = await run("DELETE FROM public_messages");
  await log("Cleared the public room", `${removed} message${removed === 1 ? "" : "s"}`);
  return removed;
}

/**
 * Remove a person completely: the account, sessions, queue spot, any pending login code, every
 * conversation they were in (the other person simply returns to the home screen), and all reports
 * about or by them. They can sign up again with the same email; to keep someone out, block instead.
 */
export async function deleteUser(userId: number): Promise<void> {
  const email = await emailOf(userId);
  await removeUser(userId, email);
  await log("Deleted user", email);
}

/** The deletion itself, with no log entry. Also used when people delete their own account. */
export async function removeUser(userId: number, email: string): Promise<void> {
  const mine = "SELECT id FROM chats WHERE user_a = ? OR user_b = ?";
  const db = await getDb();
  await db.batch(
    [
      { sql: `DELETE FROM messages WHERE chat_id IN (${mine})`, args: [userId, userId] },
      { sql: `DELETE FROM reports WHERE reporter_id = ? OR reported_id = ? OR chat_id IN (${mine})`, args: [userId, userId, userId, userId] },
      { sql: `UPDATE users SET chat_id = NULL WHERE chat_id IN (${mine})`, args: [userId, userId] },
      { sql: "DELETE FROM chats WHERE user_a = ? OR user_b = ?", args: [userId, userId] },
      { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
      { sql: "DELETE FROM queue WHERE user_id = ?", args: [userId] },
      { sql: "DELETE FROM public_messages WHERE user_id = ?", args: [userId] },
      { sql: "DELETE FROM otps WHERE email = ?", args: [email] },
      {
        sql: "DELETE FROM rate_limits WHERE key IN (?, ?, ?, ?)",
        args: [`otp:email:${email}`, `otp:cool:${email}`, `login:uid:${userId}`, `pub:send:${userId}`],
      },
      { sql: "DELETE FROM users WHERE id = ?", args: [userId] },
    ],
    "write",
  );
}
