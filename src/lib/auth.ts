import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { one, run } from "./db";
import { ApiError } from "./errors";
import { sendLoginCode, type CodePurpose } from "./mail";
import { allow } from "./ratelimit";

export const SESSION_COOKIE = "ttx_sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export type Gender = "boy" | "girl";

export interface User {
  id: number;
  email: string;
  username: string | null;
  gender: Gender | null;
  chat_id: string | null;
  last_seen: number;
}

/** What other people may see of someone, and the only thing they can ever choose to reveal: the username, never the email. */
export const nameOf = (u: { username: string | null; email: string }) => u.username ?? u.email.split("@")[0];

const GOOGLE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Accepts any email address.
 * `send` is what the user typed (where the code goes); `canonical` is the identity we store.
 * "+tags" are dropped, and Gmail ignores dots as well, so the canonical form drops those too -
 * otherwise one mailbox could register many accounts.
 */
export function parseEmail(input: unknown): { send: string; canonical: string } | null {
  if (typeof input !== "string") return null;
  const send = input.trim().toLowerCase();
  if (send.length > 254) return null;
  const m = /^([a-z0-9][a-z0-9._%+-]{0,63})@((?:[a-z0-9-]+\.)+[a-z]{2,24})$/.exec(send);
  if (!m) return null;
  let local = m[1].split("+")[0];
  let domain = m[2];
  if (GOOGLE_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return local ? { send, canonical: `${local}@${domain}` } : null;
}

const USERNAME_HELP = "Choose a username of 3 to 20 letters, numbers or underscores.";
const RESERVED = new Set(["admin", "administrator", "moderator", "support", "texttox", "anonymous", "stranger", "system"]);

/** A valid, lowercase username, or null. Usernames are how people sign in and what they may choose to reveal in a chat. */
export function parseUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(name) ? name : null;
}

/** Names nobody may register: staff-sounding ones, and whatever the admin signs in with. */
export function isReservedUsername(name: string): boolean {
  return RESERVED.has(name) || name === process.env.ADMIN_USERNAME?.trim().toLowerCase();
}

export function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return "dev-only-secret-do-not-use-in-production";
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const hashCode = (email: string, code: string) => createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* --------------------------------------------------------------- passwords */

const scryptAsync = (password: string, salt: Buffer, keylen: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** scrypt with a random salt per password, stored as "scrypt1$salt$key" (both base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt1$${salt.toString("base64")}$${(await scryptAsync(password, salt, 64)).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [tag, salt, key] = stored.split("$");
  if (tag !== "scrypt1" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Checked against when the ID has no account, so "no such account" takes as long as "wrong password".
let dummyHash: Promise<string> | undefined;
const decoyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));

function checkPassword(password: unknown, canonical: string, username?: string | null): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new ApiError(400, `Use at least ${MIN_PASSWORD} characters for your password.`);
  if (password.length > MAX_PASSWORD) throw new ApiError(400, `Use at most ${MAX_PASSWORD} characters for your password.`);
  const lower = password.toLowerCase();
  if (lower === canonical.split("@")[0] || lower === canonical || lower === username) {
    throw new ApiError(400, "Your password can't be the same as your email or username.");
  }
  return password;
}

/* ---------------------------------------------------------------- sessions */

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [sha256(token), userId, Date.now() + SESSION_TTL_MS]);
  return token;
}

export async function getUserByToken(token: string | undefined): Promise<User | undefined> {
  if (!token) return undefined;
  return one<User>(
    `SELECT u.id, u.email, u.username, u.gender, u.chat_id, u.last_seen
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.banned = 0`,
    [sha256(token), Date.now()],
  );
}

export async function endSession(token: string | undefined): Promise<void> {
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

/* ----------------------------------------------------------------- sign in */

export const BAD_LOGIN = "Wrong username, email or password.";

/** `rawId` is a username or an email address. */
export async function loginWithPassword(rawId: unknown, rawPassword: unknown, ip: string): Promise<{ token: string }> {
  const { id } = await verifyCredentials(rawId, rawPassword, ip);
  return { token: await createSession(id) };
}

/**
 * Checks a username-or-email and password, with the sign-in guess limits, and returns who it is.
 * Used for signing in and for deleting your own account, so both are equally hard to guess into.
 */
export async function verifyCredentials(rawId: unknown, rawPassword: unknown, ip: string): Promise<{ id: number }> {
  const id = typeof rawId === "string" ? rawId.trim().toLowerCase().slice(0, 254) : "";
  if (!id || typeof rawPassword !== "string" || !rawPassword) throw new ApiError(400, "Enter your username or email, and your password.");

  // Slow down guessing, per address and per account.
  if (!(await allow(`login:ip:${ip}`, 40, 15 * 60 * 1000))) {
    throw new ApiError(429, "Too many attempts. Try again in 15 minutes, or reset your password.");
  }

  const isEmail = id.includes("@");
  const email = isEmail ? parseEmail(id) : null;
  const user =
    isEmail && !email
      ? undefined
      : await one<{ id: number; password_hash: string | null; banned: number }>(
          `SELECT id, password_hash, banned FROM users WHERE ${email ? "email" : "username"} = ?`,
          [email ? email.canonical : id],
        );
  // One counter per account, however it is typed (username or email); unknown names share a counter per typed value.
  if (!(await allow(user ? `login:uid:${user.id}` : `login:id:${id}`, 10, 15 * 60 * 1000))) {
    throw new ApiError(429, "Too many attempts. Try again in 15 minutes, or reset your password.");
  }

  const matches = await verifyPassword(rawPassword.slice(0, MAX_PASSWORD), user?.password_hash ?? (await decoyHash()));
  // Same answer (and about the same time) whether the account is unknown, has no password yet, or the password is wrong.
  if (!user || !user.password_hash || !matches) throw new ApiError(401, BAD_LOGIN);
  if (user.banned) throw new ApiError(403, "This account has been blocked.");
  return { id: user.id };
}

/* ---------------------------------------------- create account / reset password */

/**
 * Step 1: ask for a code. The answer is the same for every ID, so nobody can find out who has an account:
 *  - "signup" emails a code unless the ID already has a password
 *  - "reset"  emails a code only if the ID has an account
 * Otherwise nothing is emailed (saving mail quota and bounces) but a decoy entry is stored, so verifying a code
 * behaves identically either way.
 * Returns the function that sends the email, or null if there is nothing to send. The caller runs it after replying.
 */
export async function requestCode(rawEmail: unknown, rawPurpose: unknown, ip: string): Promise<(() => Promise<void>) | null> {
  const email = parseEmail(rawEmail);
  if (!email) throw new ApiError(400, "Enter a valid email address.");
  const purpose: CodePurpose = rawPurpose === "reset" ? "reset" : "signup";

  // Generous per-IP cap: a whole campus can share one public IP. These count every request, sent or not.
  if (!(await allow(`otp:ip:${ip}`, 200, 60 * 60 * 1000)) || !(await allow(`otp:email:${email.canonical}`, 5, 60 * 60 * 1000))) {
    throw new ApiError(429, "Too many code requests. Please try again in a while.");
  }
  if (!(await allow(`otp:cool:${email.canonical}`, 1, 60 * 1000))) {
    throw new ApiError(429, "A code was just requested. Wait a minute before asking again.");
  }

  const user = await one<{ password_hash: string | null; banned: number }>("SELECT password_hash, banned FROM users WHERE email = ?", [email.canonical]);
  const eligible = purpose === "reset" ? !!user && !user.banned : !user || (!user.password_hash && !user.banned);

  const now = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = eligible ? hashCode(email.canonical, code) : randomBytes(32).toString("hex"); // decoy: nobody can match it
  await run(
    `INSERT INTO otps (email, code_hash, expires_at, attempts, sent_at, verified) VALUES (?, ?, ?, 0, ?, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                                       attempts = 0, sent_at = excluded.sent_at, verified = 0
     WHERE ? OR otps.expires_at < ?`, // a decoy never replaces a real code that is still waiting
    [email.canonical, codeHash, now + OTP_TTL_MS, now, eligible ? 1 : 0, now],
  );
  if (!eligible) return null;

  return async () => {
    try {
      await sendLoginCode(email.send, code, purpose);
    } catch (e) {
      console.error("Could not send login email:", e);
      await run("DELETE FROM otps WHERE email = ? AND code_hash = ?", [email.canonical, codeHash]).catch(() => {});
    }
  };
}

const BAD_CODE = "That code is wrong or has expired. Check it, or go back and ask for a new one.";

/** Step 2: check the code. On success returns a one-time ticket for step 3 (the code itself can't be reused). */
export async function verifyCode(rawEmail: unknown, rawCode: unknown, ip: string): Promise<{ ticket: string }> {
  const email = parseEmail(rawEmail);
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) throw new ApiError(400, "Enter the 6-digit code from your email.");
  if (!(await allow(`verify:ip:${ip}`, 60, 10 * 60 * 1000))) throw new ApiError(429, "Too many attempts. Please try again in a few minutes.");

  // Count the attempt *before* comparing, so parallel guesses can't beat the attempt limit.
  const row = await one<{ code_hash: string }>(
    `UPDATE otps SET attempts = attempts + 1
     WHERE email = ? AND verified = 0 AND attempts < ? AND expires_at > ? RETURNING code_hash`,
    [email.canonical, OTP_MAX_ATTEMPTS, Date.now()],
  );
  // One message for "no code was asked for", "wrong", "expired" and "too many tries", so none of them reveals anything.
  if (!row || !safeEqual(row.code_hash, hashCode(email.canonical, code))) throw new ApiError(400, BAD_CODE);

  const ticket = randomBytes(32).toString("base64url");
  const changed = await run("UPDATE otps SET code_hash = ?, verified = 1, attempts = 0, expires_at = ? WHERE email = ? AND verified = 0", [
    sha256(ticket),
    Date.now() + OTP_TTL_MS,
    email.canonical,
  ]);
  if (changed !== 1) throw new ApiError(400, BAD_CODE);
  return { ticket };
}

/**
 * Step 3: choose the password (and, for a new account, a username). Creates the account if the email is new,
 * otherwise replaces the password and signs every other device out. An existing username is never changed.
 */
export async function setPassword(rawEmail: unknown, rawTicket: unknown, rawPassword: unknown, ip: string, rawUsername?: unknown): Promise<{ token: string }> {
  const email = parseEmail(rawEmail);
  if (!email || typeof rawTicket !== "string" || !rawTicket) throw new ApiError(400, "Start again from the sign-in page.");
  const typedName = parseUsername(rawUsername);
  const password = checkPassword(rawPassword, email.canonical, typedName); // before anything is used up, so a short password can be retyped
  if (!(await allow(`setpw:ip:${ip}`, 30, 10 * 60 * 1000))) throw new ApiError(429, "Too many attempts. Please try again in a few minutes.");

  const expired = new ApiError(400, "This step has expired. Please start again from the sign-in page.");
  const ticketHash = sha256(rawTicket);
  const valid = await one("SELECT 1 FROM otps WHERE email = ? AND verified = 1 AND code_hash = ? AND expires_at > ?", [email.canonical, ticketHash, Date.now()]);
  if (!valid) throw expired;

  const existing = await one<{ banned: number; username: string | null }>("SELECT banned, username FROM users WHERE email = ?", [email.canonical]);
  if (existing?.banned) throw new ApiError(403, "This account has been blocked.");

  // A new account must choose a username. Checked before the ticket is used up, so a taken name can be replaced.
  let username: string | null = null;
  if (!existing || (!existing.username && typeof rawUsername === "string" && rawUsername.trim())) {
    if (!typedName) throw new ApiError(400, USERNAME_HELP);
    if (isReservedUsername(typedName)) throw new ApiError(400, "That username isn't available.");
    if (await one("SELECT 1 FROM users WHERE username = ?", [typedName])) throw new ApiError(409, "That username is taken. Try another.");
    username = typedName;
  }

  const hash = await hashPassword(password); // the slow part, done before the ticket is used up

  // Single use: whoever deletes the ticket wins.
  const claimed = await one("DELETE FROM otps WHERE email = ? AND verified = 1 AND code_hash = ? AND expires_at > ? RETURNING email", [email.canonical, ticketHash, Date.now()]);
  if (!claimed) throw expired;

  try {
    await run(
      `INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, username = COALESCE(users.username, excluded.username)`,
      [email.canonical, username, hash, Date.now()],
    );
  } catch (e) {
    if (/UNIQUE.*username/i.test(String(e))) throw new ApiError(409, "Someone just took that username. Start again and pick another.");
    throw e;
  }
  const user = await one<{ id: number }>("SELECT id FROM users WHERE email = ?", [email.canonical]);
  if (!user) throw new Error("user row missing after insert");

  await run("DELETE FROM sessions WHERE user_id = ?", [user.id]); // a reset signs out every other device
  await run("DELETE FROM rate_limits WHERE key = ?", [`login:uid:${user.id}`]); // and forgives earlier failed tries
  return { token: await createSession(user.id) };
}

export async function setGender(user: User, gender: unknown): Promise<void> {
  if (gender !== "boy" && gender !== "girl") throw new ApiError(400, "Choose boy or girl.");
  if (user.gender) throw new ApiError(409, "This can't be changed once it is set.");
  await run("UPDATE users SET gender = ? WHERE id = ? AND gender IS NULL", [gender, user.id]);
}
