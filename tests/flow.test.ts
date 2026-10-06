// Run with: npm test   (uses a throwaway local sqlite file, never your Turso database)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "texttox-"));
process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret";
delete process.env.SMTP_HOST; // login codes get printed instead of mailed

import {
  BAD_LOGIN, getUserByToken, hashPassword, loginWithPassword, nameOf, parseEmail, parseUsername, requestCode, setGender, setPassword, verifyCode, verifyPassword,
  type Gender, type User,
} from "../src/lib/auth";
import { cancelSearch, joinQueue, leaveChat, reportChat, sendMessage, setAnonymous, tryMatch } from "../src/lib/chat";
import { all, getDb, one, run } from "../src/lib/db";
import { ApiError } from "../src/lib/errors";
import { cleanup } from "../src/lib/maintenance";
import { allow } from "../src/lib/ratelimit";
import { pollPublic, sendPublic } from "../src/lib/public";
import { onlineCount, pollState } from "../src/lib/state";

let seq = 0;
const sentCodes = new Map<string, string>();
const realLog = console.log;

const PASSWORD = "correct horse battery";
const ipFor = (n: number) => `10.${(n >> 8) & 255}.${n & 255}.1`; // a different "address" per test user, so the per-address limits don't interfere

/** Asks for a code the way the site does and returns it (read from the dev log), or null if nothing would be emailed. */
async function codeFor(email: string, purpose: "signup" | "reset", ip: string): Promise<string | null> {
  const send = await requestCode(email, purpose, ip);
  if (!send) return null;
  await send();
  return sentCodes.get(email)!;
}
const skipCooldown = () => run("DELETE FROM rate_limits WHERE key LIKE 'otp:cool:%'");

/** The whole create-account flow: code -> ticket -> password. Returns the session token. */
const usernameFor = (email: string) => "u" + email.split("@")[0].replace(/[^a-z0-9]/g, "").slice(0, 19);
async function createAccount(email: string, ip: string, password = PASSWORD, username = usernameFor(email)): Promise<string> {
  const code = await codeFor(email, "signup", ip);
  assert.ok(code, "a code should have been sent");
  const { ticket } = await verifyCode(email, code, ip);
  return (await setPassword(email, ticket, password, ip, username)).token;
}

/** A new, signed-up person, optionally with their gender chosen. */
async function signUp(gender: Gender | null): Promise<User> {
  const n = ++seq;
  const email = `9276${String(n).padStart(3, "0")}000@mkce.ac.in`;
  const token = await createAccount(email, ipFor(n));
  let user = (await getUserByToken(token))!;
  if (gender) {
    await setGender(user, gender);
    user = (await getUserByToken(token))!;
  }
  return user;
}

const fresh = async (u: User) => (await one<User>("SELECT id, email, username, gender, chat_id, last_seen FROM users WHERE id = ?", [u.id]))!;
const rejects = (p: Promise<unknown>, status: number) =>
  assert.rejects(p, (e) => e instanceof ApiError && e.status === status);

before(async () => {
  console.log = (...args: unknown[]) => {
    const m = /^\[dev\] login code for (\S+): (\d{6})$/.exec(String(args[0]));
    if (m) sentCodes.set(m[1], m[2]);
    else realLog(...args);
  };
  await getDb(); // creates the tables
});

after(async () => {
  console.log = realLog;
  (await getDb()).close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the sqlite file locked until the process exits */
  }
});

describe("email addresses and usernames", () => {
  it("accepts an email address from any provider", () => {
    assert.equal(parseEmail("9276ABC123@MKCE.AC.IN")?.canonical, "9276abc123@mkce.ac.in");
    assert.equal(parseEmail("  Someone@Outlook.com ")?.canonical, "someone@outlook.com");
    assert.equal(parseEmail("a.b@mail.example.co.uk")?.canonical, "a.b@mail.example.co.uk", "dots only matter to Gmail");
    for (const bad of ["no-at-sign", "a@b", "@gmail.com", "a@@gmail.com", "a b@gmail.com", "a@gmail..com", "", null, 42, `${"x".repeat(250)}@gmail.com`]) {
      assert.equal(parseEmail(bad), null, String(bad));
    }
  });
  it("treats +tags, and Gmail's dots, as the same mailbox", () => {
    assert.equal(parseEmail("jo.hn.doe@gmail.com")?.canonical, "johndoe@gmail.com");
    assert.equal(parseEmail("johndoe+spam@googlemail.com")?.canonical, "johndoe@gmail.com");
    assert.equal(parseEmail("jo+tag@example.org")?.canonical, "jo@example.org");
    assert.equal(parseEmail("jo.hn@example.org")?.canonical, "jo.hn@example.org");
  });
  it("accepts 3-20 letters, numbers and underscores, in lowercase", () => {
    assert.equal(parseUsername("  Night_Owl9 "), "night_owl9");
    for (const bad of ["ab", "x".repeat(21), "has space", "dot.ted", "dash-ed", "emoji😀", "a@b.com", "", null, 7]) {
      assert.equal(parseUsername(bad), null, String(bad));
    }
  });
});

describe("accounts and passwords", () => {
  const status = (e: unknown) => (e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
  const failure = async (p: Promise<unknown>) => status(await p.then(() => "no error", (e) => e));

  it("creates an account with an emailed code, then signs in with just the password", async () => {
    const email = "9276900001@mkce.ac.in";
    const user = (await getUserByToken(await createAccount(email, "20.0.0.1")))!;
    assert.equal(user.email, email);

    const again = await loginWithPassword(email, PASSWORD, "20.0.0.2"); // no code this time
    assert.equal((await getUserByToken(again.token))!.id, user.id);

    const stored = (await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [user.id]))!.password_hash;
    assert.match(stored, /^scrypt1\$/);
    assert.ok(!stored.includes(PASSWORD), "the password is stored hashed");
    assert.ok(await verifyPassword(PASSWORD, stored));
    assert.equal(await verifyPassword("wrong", stored), false);
    assert.notEqual(await hashPassword(PASSWORD), await hashPassword(PASSWORD), "each hash has its own salt");
  });

  it("is one account per person, whichever way the email or username is typed", async () => {
    const email = "9276900002@mkce.ac.in";
    const user = (await getUserByToken(await createAccount(email, "20.0.0.3")))!;
    for (const typed of ["9276900002@MKCE.AC.IN", "  9276900002@mkce.ac.in ", "9276900002+tag@mkce.ac.in", "u9276900002", "  U9276900002 "]) {
      const { token } = await loginWithPassword(typed, PASSWORD, "20.0.0.4");
      assert.equal((await getUserByToken(token))!.id, user.id, typed);
    }
    assert.equal((await all("SELECT id FROM users WHERE email = ?", [email])).length, 1);
    await skipCooldown();
    assert.equal(await requestCode(email, "signup", "20.0.0.5"), null, "creating it a second time sends nothing");
  });

  it("signs in with either the username or the email, and they share one guess counter", async () => {
    const email = "someone.nice@gmail.com";
    await createAccount(email, "21.0.0.1", PASSWORD, "someone_nice");
    for (const id of ["someone_nice", "SOMEONE_NICE", email, "s.o.m.e.o.n.e.nice@gmail.com", "someonenice+x@googlemail.com"]) {
      assert.ok(await loginWithPassword(id, PASSWORD, "21.0.0.2"), id);
    }
    await run("DELETE FROM rate_limits WHERE key LIKE 'login:uid:%'"); // the good logins above used some of the budget
    // 5 wrong guesses by username + 5 by email = the same 10-guess budget, not 10 each
    for (let i = 0; i < 5; i++) await rejects(loginWithPassword("someone_nice", `bad ${i}`, "21.0.0.3"), 401);
    for (let i = 0; i < 5; i++) await rejects(loginWithPassword(email, `bad ${i}`, "21.0.0.3"), 401);
    await rejects(loginWithPassword("someone_nice", PASSWORD, "21.0.0.4"), 429);
    await rejects(loginWithPassword(email, PASSWORD, "21.0.0.4"), 429);
  });

  it("gives each new account a unique username that can't be reserved, and keeps it on password reset", async () => {
    await createAccount("first@example.com", "21.1.0.1", PASSWORD, "taken_name");

    const code = (await codeFor("second@example.com", "signup", "21.1.0.2"))!;
    const { ticket } = await verifyCode("second@example.com", code, "21.1.0.2");
    await rejects(setPassword("second@example.com", ticket, PASSWORD, "21.1.0.2", "Taken_Name"), 409); // case doesn't matter
    process.env.ADMIN_USERNAME = "TheBoss";
    await rejects(setPassword("second@example.com", ticket, PASSWORD, "21.1.0.2", "theboss"), 400); // the admin's name is off limits
    delete process.env.ADMIN_USERNAME;
    const second = (await getUserByToken((await setPassword("second@example.com", ticket, PASSWORD, "21.1.0.2", "free_name")).token))!;
    assert.equal(second.username, "free_name");

    // resetting needs no username, and can't change it
    await skipCooldown();
    const reset = (await codeFor("second@example.com", "reset", "21.1.0.3"))!;
    const t2 = (await verifyCode("second@example.com", reset, "21.1.0.3")).ticket;
    const after = (await getUserByToken((await setPassword("second@example.com", t2, "another password!", "21.1.0.3", "sneaky_rename")).token))!;
    assert.equal(after.id, second.id);
    assert.equal(after.username, "free_name");
    assert.equal(nameOf(after), "free_name");
    assert.equal(nameOf({ username: null, email: "old.account@mkce.ac.in" }), "old.account", "accounts from before usernames fall back to the start of the email");
  });

  it("the shared sign-in answer never says which of username or email was wrong", async () => {
    await createAccount("known@example.com", "21.2.0.1", PASSWORD, "known_user");
    assert.equal(BAD_LOGIN, "Wrong username, email or password.");
    for (const id of ["known_user", "known@example.com"]) {
      await assert.rejects(loginWithPassword(id, "nope", "21.2.0.2"), (e) => e instanceof ApiError && e.status === 401 && e.message === BAD_LOGIN);
    }
  });

  it("gives the same answer for a wrong password, an unknown ID, and an account that has no password yet", async () => {
    const email = "9276900003@mkce.ac.in";
    await createAccount(email, "20.0.0.6");
    await run("INSERT INTO users (email, created_at) VALUES (?, ?)", ["9276900004@mkce.ac.in", Date.now()]); // signed up before passwords existed
    const wrong = await failure(loginWithPassword(email, "not the password", "20.0.0.7"));
    const unknown = await failure(loginWithPassword("9276900099@mkce.ac.in", PASSWORD, "20.0.0.7"));
    const legacy = await failure(loginWithPassword("9276900004@mkce.ac.in", PASSWORD, "20.0.0.7"));
    assert.match(wrong, /^401: /);
    assert.equal(unknown, wrong);
    assert.equal(legacy, wrong);
    assert.equal(await failure(loginWithPassword("someone@gmail.com", PASSWORD, "20.0.0.7")), wrong, "an email nobody used");
    assert.equal(await failure(loginWithPassword("nobody_here", PASSWORD, "20.0.0.7")), wrong, "a username nobody chose");
    assert.equal(await failure(loginWithPassword("not an email@@", PASSWORD, "20.0.0.7")), wrong);
    await rejects(loginWithPassword(email, "", "20.0.0.7"), 400);
  });

  it("stops password guessing after 10 tries per ID per 15 minutes", async () => {
    const email = "9276900005@mkce.ac.in";
    await createAccount(email, "20.0.0.8");
    for (let i = 0; i < 10; i++) await rejects(loginWithPassword(email, `guess ${i}`, "20.0.0.9"), 401);
    await rejects(loginWithPassword(email, PASSWORD, "20.0.0.9"), 429); // even the right password waits
    await rejects(loginWithPassword(email, PASSWORD, "20.0.0.10"), 429); // from any address
  });

  it("blocks banned accounts from signing in", async () => {
    const email = "9276900006@mkce.ac.in";
    const token = await createAccount(email, "20.0.0.11");
    assert.ok(await getUserByToken(token));
    await run("UPDATE users SET banned = 1 WHERE email = ?", [email]);
    assert.equal(await getUserByToken(token), undefined);
    await rejects(loginWithPassword(email, PASSWORD, "20.0.0.12"), 403);
    await rejects(loginWithPassword(email, "wrong", "20.0.0.12"), 401, ); // and wrong passwords still learn nothing
    await skipCooldown();
    assert.equal(await requestCode(email, "reset", "20.0.0.12"), null, "no codes for blocked accounts");
  });

  it("emails a code only when it is useful", async () => {
    const email = "9276900007@mkce.ac.in";
    assert.equal(await requestCode(email, "reset", "20.1.0.1"), null, "reset for an ID with no account sends nothing");
    await skipCooldown();
    assert.ok(await requestCode(email, "signup", "20.1.0.1"), "signup for a new ID sends");
    await skipCooldown();
    await createAccount(email, "20.1.0.2");
    await skipCooldown();
    assert.equal(await requestCode(email, "signup", "20.1.0.3"), null, "signup for an ID that has a password sends nothing");
    await skipCooldown();
    assert.ok(await requestCode(email, "reset", "20.1.0.3"), "reset for an existing account sends");
  });

  it("never reveals whether an account exists", async () => {
    const real = "9276900008@mkce.ac.in";
    const ghost = "9276900009@mkce.ac.in";
    await createAccount(real, "20.2.0.1");
    await skipCooldown();
    const realCode = (await codeFor(real, "reset", "20.2.0.2"))!;
    assert.equal(await codeFor(ghost, "reset", "20.2.0.2"), null);

    // asking again too soon is refused identically
    assert.equal(await failure(requestCode(real, "reset", "20.2.0.2")), await failure(requestCode(ghost, "reset", "20.2.0.2")));

    // a wrong code looks the same, and so does running out of tries
    const wrong = realCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      assert.equal(await failure(verifyCode(real, wrong, "20.2.0.3")), await failure(verifyCode(ghost, wrong, "20.2.0.3")));
    }
    assert.match(await failure(verifyCode(real, realCode, "20.2.0.3")), /^400: /, "locked out even with the right code");
    assert.equal(await failure(verifyCode(real, realCode, "20.2.0.3")), await failure(verifyCode(ghost, "123456", "20.2.0.3")));
    assert.equal(await failure(verifyCode("9276900013@mkce.ac.in", "123456", "20.2.0.3")), await failure(verifyCode(ghost, "123456", "20.2.0.3")), "and so does never having asked");
  });

  it("a decoy never wipes a real code that is waiting", async () => {
    const email = "9276900014@mkce.ac.in";
    await createAccount(email, "20.3.0.1");
    await skipCooldown();
    const code = (await codeFor(email, "reset", "20.3.0.2"))!;
    await skipCooldown();
    assert.equal(await requestCode(email, "signup", "20.3.0.3"), null); // someone else pokes at the same ID
    assert.ok((await verifyCode(email, code, "20.3.0.4")).ticket, "the real code still works");
  });

  it("the code can be used once, then a one-time ticket is needed to set the password", async () => {
    const email = "9276900015@mkce.ac.in";
    const code = (await codeFor(email, "signup", "20.4.0.1"))!;
    const { ticket } = await verifyCode(email, code, "20.4.0.2");
    await rejects(verifyCode(email, code, "20.4.0.2"), 400); // the code itself is spent
    await rejects(setPassword("9276900016@mkce.ac.in", ticket, PASSWORD, "20.4.0.3"), 400); // ticket is for this ID only
    await rejects(setPassword(email, "forged-ticket", PASSWORD, "20.4.0.3"), 400);
    await rejects(setPassword(email, code, PASSWORD, "20.4.0.3", "tester15"), 400); // the code is not a ticket

    // password rules don't use the ticket up
    await rejects(setPassword(email, ticket, "short", "20.4.0.3"), 400);
    await rejects(setPassword(email, ticket, "x".repeat(129), "20.4.0.3"), 400);
    await rejects(setPassword(email, ticket, "9276900015", "20.4.0.3"), 400); // same as the ID
    // a new account needs a username; a missing or bad one doesn't use the ticket up either
    await rejects(setPassword(email, ticket, PASSWORD, "20.4.0.3"), 400);
    await rejects(setPassword(email, ticket, PASSWORD, "20.4.0.3", "no spaces please"), 400);
    await rejects(setPassword(email, ticket, PASSWORD, "20.4.0.3", "admin"), 400); // reserved
    await rejects(setPassword(email, ticket, "tester15", "20.4.0.3", "tester15"), 400); // password can't be the username
    const { token } = await setPassword(email, ticket, PASSWORD, "20.4.0.3", "Tester15");
    const made = (await getUserByToken(token))!;
    assert.equal(made.email, email);
    assert.equal(made.username, "tester15", "stored in lowercase");
    await rejects(setPassword(email, ticket, "another password", "20.4.0.3", "tester15b"), 400); // single use
  });

  it("codes and tickets expire", async () => {
    const email = "9276900017@mkce.ac.in";
    const code = (await codeFor(email, "signup", "20.5.0.1"))!;
    await run("UPDATE otps SET expires_at = ? WHERE email = ?", [Date.now() - 1000, email]);
    await rejects(verifyCode(email, code, "20.5.0.2"), 400);

    await skipCooldown();
    const { ticket } = await verifyCode(email, (await codeFor(email, "signup", "20.5.0.3"))!, "20.5.0.4");
    await run("UPDATE otps SET expires_at = ? WHERE email = ?", [Date.now() - 1000, email]);
    await rejects(setPassword(email, ticket, PASSWORD, "20.5.0.5", "tester17"), 400);
  });

  it("forgot password: new password works, the old one and other devices stop working, the username stays", async () => {
    const email = "9276900018@mkce.ac.in";
    const phone = await createAccount(email, "20.6.0.1");
    const laptop = (await loginWithPassword(email, PASSWORD, "20.6.0.2")).token;
    const id = (await getUserByToken(phone))!.id;
    await run("UPDATE users SET gender = 'girl' WHERE id = ?", [id]);

    await skipCooldown();
    const code = (await codeFor(email, "reset", "20.6.0.3"))!;
    const { ticket } = await verifyCode(email, code, "20.6.0.3");
    const fresh = await setPassword(email, ticket, "a brand new password", "20.6.0.3");

    assert.equal(await getUserByToken(phone), undefined, "other devices are signed out");
    assert.equal(await getUserByToken(laptop), undefined);
    const me = (await getUserByToken(fresh.token))!;
    assert.equal(me.id, id, "same account");
    assert.equal(me.email, email, "same username");
    assert.equal(me.gender, "girl", "profile untouched");
    await rejects(loginWithPassword(email, PASSWORD, "20.6.0.4"), 401);
    assert.ok(await loginWithPassword(email, "a brand new password", "20.6.0.4"));
  });

  it("forgives earlier failed attempts after a reset", async () => {
    const email = "9276900019@mkce.ac.in";
    await createAccount(email, "20.7.0.1");
    for (let i = 0; i < 10; i++) await rejects(loginWithPassword(email, `bad ${i}`, "20.7.0.2"), 401);
    await rejects(loginWithPassword(email, PASSWORD, "20.7.0.2"), 429);
    await skipCooldown();
    const { ticket } = await verifyCode(email, (await codeFor(email, "reset", "20.7.0.3"))!, "20.7.0.3");
    await setPassword(email, ticket, "fresh start password", "20.7.0.3");
    assert.ok(await loginWithPassword(email, "fresh start password", "20.7.0.4"));
  });

  it("lets someone who signed up before passwords existed choose one (keeping their profile)", async () => {
    const email = "9276900020@mkce.ac.in";
    await run("INSERT INTO users (email, gender, created_at) VALUES (?, 'boy', ?)", [email, Date.now()]);
    const before = (await one<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]))!.id;
    const user = (await getUserByToken(await createAccount(email, "20.8.0.1")))!;
    assert.equal(user.id, before);
    assert.equal(user.gender, "boy");
    assert.ok(await loginWithPassword(email, PASSWORD, "20.8.0.2"));
  });

  it("rejects malformed emails and codes", async () => {
    await rejects(requestCode("not-an-email", "signup", "20.9.0.1"), 400);
    await rejects(verifyCode("9276900021@mkce.ac.in", "12ab56", "20.9.0.1"), 400);
  });

  it("limits code requests: once a minute and five an hour per ID", async () => {
    const email = "9276900022@mkce.ac.in";
    assert.ok(await requestCode(email, "signup", "20.9.1.1"));
    await rejects(requestCode(email, "signup", "20.9.1.1"), 429);
    // the refused request above counted too (hammering is penalised), so three more make five
    for (let i = 0; i < 3; i++) {
      await skipCooldown();
      await requestCode(email, "signup", "20.9.1.1");
    }
    await skipCooldown();
    await rejects(requestCode(email, "signup", "20.9.1.1"), 429); // over the hourly limit
  });

  it("gender can be set once", async () => {
    const u = await signUp(null);
    await setGender(u, "girl");
    await rejects(setGender(await fresh(u), "boy"), 409);
    await rejects(setGender(u, "robot"), 400);
  });

  it("rate limiter blocks after the limit", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allow("t:limit", 3, 60_000));
    assert.deepEqual(results, [true, true, true, false]);
  });
});

describe("matching", () => {
  it("pairs a boy who wants a girl with a girl who wants a boy - and nobody else", async () => {
    const boy = await signUp("boy");
    const girlWantsGirl = await signUp("girl");
    const girl = await signUp("girl");
    const boyWantsBoy = await signUp("boy");

    await joinQueue(boy, "girl");
    await joinQueue(girlWantsGirl, "girl"); // wants a girl, not a boy: must not match the boy
    await joinQueue(boyWantsBoy, "boy"); // wants a boy, not a girl
    assert.equal((await fresh(boy)).chat_id, null);
    assert.equal((await fresh(girlWantsGirl)).chat_id, null);

    await joinQueue(girl, "boy");
    const [b, g] = [await fresh(boy), await fresh(girl)];
    assert.ok(b.chat_id);
    assert.equal(b.chat_id, g.chat_id);
    assert.equal((await fresh(girlWantsGirl)).chat_id, null);
    assert.equal((await fresh(boyWantsBoy)).chat_id, null);

    // same-gender preferences pair up with each other
    const boy2 = await signUp("boy");
    await joinQueue(boy2, "boy");
    assert.equal((await fresh(boy2)).chat_id, (await fresh(boyWantsBoy)).chat_id);
    assert.ok((await fresh(boy2)).chat_id);
  });

  it("never double-matches under a race (10 boys vs 10 girls searching at once)", async () => {
    const boys = await Promise.all(Array.from({ length: 10 }, () => signUp("boy")));
    const girls = await Promise.all(Array.from({ length: 10 }, () => signUp("girl")));
    const everyone = [...boys.map((u) => ({ u, want: "girl" as const })), ...girls.map((u) => ({ u, want: "boy" as const }))];
    await Promise.all(everyone.map(({ u, want }) => joinQueue(u, want)));
    // keep nudging like the poll loop does, all in parallel, until everybody has a partner
    for (let i = 0; i < 40; i++) {
      await Promise.all(everyone.map(({ u }) => tryMatch(u.id)));
      if ((await all("SELECT 1 FROM queue WHERE user_id IN (" + everyone.map((e) => e.u.id).join(",") + ")")).length === 0) break;
    }

    const chats = new Map<string, number[]>();
    for (const { u } of everyone) {
      const f = await fresh(u);
      assert.ok(f.chat_id, `user ${u.id} should be matched`);
      chats.set(f.chat_id!, [...(chats.get(f.chat_id!) ?? []), u.id]);
    }
    for (const [id, members] of chats) assert.equal(members.length, 2, `chat ${id} has ${members.length} members`);
    assert.equal(chats.size, 10);
    assert.equal((await all("SELECT user_id FROM queue WHERE user_id IN (" + everyone.map((e) => e.u.id).join(",") + ")")).length, 0);
  });

  it("ignores searchers that stopped checking in", async () => {
    const boy = await signUp("boy");
    const ghost = await signUp("girl");
    await joinQueue(ghost, "boy");
    await run("UPDATE queue SET last_seen = ? WHERE user_id = ?", [Date.now() - 60_000, ghost.id]);
    await joinQueue(boy, "girl");
    assert.equal((await fresh(boy)).chat_id, null);
    await cancelSearch(boy.id);
    await cancelSearch(ghost.id);
  });

  it("can't search while in a chat, and can cancel a search", async () => {
    const a = await signUp("boy");
    const b = await signUp("girl");
    await joinQueue(a, "girl");
    await cancelSearch(a.id);
    assert.equal((await all("SELECT 1 FROM queue WHERE user_id = ?", [a.id])).length, 0);
    await joinQueue(a, "girl");
    await joinQueue(b, "boy");
    await rejects(joinQueue(await fresh(a), "girl"), 409);
  });

  it("won't immediately re-pair two people who just talked", async () => {
    const a = await signUp("boy");
    const b = await signUp("girl");
    await joinQueue(a, "girl");
    await joinQueue(b, "boy");
    await leaveChat(a.id);
    await leaveChat(b.id);
    await joinQueue(await fresh(a), "girl");
    await joinQueue(await fresh(b), "boy");
    assert.equal((await fresh(a)).chat_id, null);
    assert.equal((await fresh(b)).chat_id, null);
    await cancelSearch(a.id);
    await cancelSearch(b.id);
  });

  it("requires a gender before searching", async () => {
    await rejects(joinQueue(await signUp(null), "girl"), 400);
  });
});

async function pair(): Promise<[User, User]> {
  const a = await signUp("boy");
  const b = await signUp("girl");
  await joinQueue(a, "girl");
  await joinQueue(b, "boy");
  return [await fresh(a), await fresh(b)];
}

describe("chat", () => {
  it("delivers messages both ways and keeps identities hidden by default", async () => {
    const [a, b] = await pair();
    await sendMessage(a, "  hello there ");
    await sendMessage(b, "hi!");

    const va = await pollState(a, null, null, 0);
    const vb = await pollState(b, null, null, 0);
    assert.equal(va.status, "chatting");
    assert.deepEqual(va.chat!.messages.filter((m) => m.kind === "msg").map((m) => [m.text, m.mine]), [["hello there", true], ["hi!", false]]);
    assert.deepEqual(vb.chat!.messages.filter((m) => m.kind === "msg").map((m) => [m.text, m.mine]), [["hello there", false], ["hi!", true]]);
    for (const v of [va, vb]) {
      assert.equal(v.chat!.partner.revealed, false);
      assert.equal(v.chat!.partner.handle, null);
      assert.equal(v.chat!.iAmAnonymous, true);
    }
    // nothing in the payload may contain either person's ID
    for (const [v, other] of [[va, b], [vb, a]] as const) {
      assert.ok(!JSON.stringify(v).includes(other.email.split("@")[0]), "partner id leaked");
      assert.ok(!JSON.stringify(v).includes(other.email), "partner email leaked");
      assert.ok(!JSON.stringify(v).includes(other.username!), "partner username leaked");
    }
  });

  it("anonymity toggle reveals the ID to the partner only, and can be switched back", async () => {
    const [a, b] = await pair();
    await setAnonymous(a, false);

    let va = await pollState(a, null, null, 0);
    let vb = await pollState(b, null, null, 0);
    assert.equal(va.chat!.iAmAnonymous, false);
    assert.equal(vb.chat!.partner.revealed, true);
    assert.equal(vb.chat!.partner.handle, a.username, "what is revealed is the username, not the email");
    assert.equal(va.chat!.partner.handle, null, "a must not see b");
    assert.equal(vb.chat!.iAmAnonymous, true);

    await setAnonymous(a, true);
    await setAnonymous(a, true); // repeating changes nothing
    vb = await pollState(b, null, null, 0);
    assert.equal(vb.chat!.partner.revealed, false);
    assert.equal(vb.chat!.partner.handle, null);
    assert.ok(!JSON.stringify(vb).includes(a.email.split("@")[0]));
    const infos = vb.chat!.messages.filter((m) => m.kind === "info").map((m) => m.text);
    assert.equal(infos.filter((t) => /anonymous again/.test(t)).length, 1, "repeated toggle must log once");
    va = await pollState(a, null, null, 0);
    assert.equal(va.chat!.iAmAnonymous, true);
  });

  it("long-poll wakes up as soon as something happens", async () => {
    const [a, b] = await pair();
    const v0 = await pollState(b, null, null, 0);
    const lastId = v0.chat!.messages.at(-1)!.id;
    const started = Date.now();
    const waiting = pollState(b, v0.token, v0.chat!.id, lastId);
    setTimeout(() => void sendMessage(a, "ping"), 400);
    const v1 = await waiting;
    assert.ok(Date.now() - started < 3_000, "should return within ~1s of the message");
    assert.deepEqual(v1.chat!.messages.map((m) => m.text), ["ping"], "only new messages are returned");
    assert.notEqual(v1.token, v0.token);
  });

  it("a searching long-poll resolves when someone else matches them", async () => {
    const a = await signUp("boy");
    const b = await signUp("girl");
    await joinQueue(a, "girl");
    const va = await pollState(a, null, null, 0);
    assert.equal(va.status, "searching");
    const waiting = pollState(a, va.token, null, 0);
    setTimeout(() => void joinQueue(b, "boy"), 300);
    const v = await waiting;
    assert.equal(v.status, "chatting");
  });

  it("leaving ends the chat for both, then deletes the messages once both are gone", async () => {
    const [a, b] = await pair();
    await sendMessage(a, "secret");
    await leaveChat(a.id);

    assert.equal((await fresh(a)).chat_id, null);
    const vb = await pollState(b, null, null, 0);
    assert.equal(vb.status, "chatting");
    assert.equal(vb.chat!.ended, true);
    assert.ok(vb.chat!.messages.some((m) => m.text === "Your partner left the chat."));
    await rejects(sendMessage(b, "anyone there?"), 409);
    await rejects(setAnonymous(b, false), 409);

    const chatId = vb.chat!.id;
    assert.ok((await all("SELECT 1 FROM messages WHERE chat_id = ?", [chatId])).length > 0);
    await leaveChat(b.id);
    assert.equal((await all("SELECT 1 FROM messages WHERE chat_id = ?", [chatId])).length, 0, "messages gone");
    assert.equal((await pollState(await fresh(b), null, null, 0)).status, "idle");
  });

  it("reported chats keep their messages for review", async () => {
    const [a, b] = await pair();
    await sendMessage(b, "something nasty");
    await reportChat(a, "harassment");
    await reportChat(a, "harassment"); // idempotent
    const chatId = a.chat_id!;
    await leaveChat(a.id);
    await leaveChat(b.id);
    assert.ok((await all("SELECT 1 FROM messages WHERE chat_id = ? AND body = 'something nasty'", [chatId])).length > 0);
    const report = await one<{ reporter_id: number; reported_id: number; reason: string }>("SELECT * FROM reports WHERE chat_id = ?", [chatId]);
    assert.deepEqual([report!.reporter_id, report!.reported_id, report!.reason], [a.id, b.id, "harassment"]);
    assert.equal((await all("SELECT 1 FROM reports WHERE chat_id = ?", [chatId])).length, 1);
  });

  it("validates messages and rate-limits floods", async () => {
    const [a] = await pair();
    await rejects(sendMessage(a, "   "), 400);
    await rejects(sendMessage(a, "x".repeat(1001)), 400);
    await rejects(sendMessage(await signUp("boy"), "hi"), 409); // not in a chat
    for (let i = 0; i < 12; i++) await sendMessage(a, `m${i}`);
    await rejects(sendMessage(a, "one too many"), 429);
  });

  it("cleanup removes day-old unreported chats but keeps reported ones", async () => {
    const [a, b] = await pair();
    const [c, d] = await pair();
    await sendMessage(a, "old");
    await reportChat(c, "x");
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await run("UPDATE chats SET updated_at = ? WHERE id IN (?, ?)", [old, a.chat_id, c.chat_id]);
    await cleanup();
    assert.equal((await all("SELECT 1 FROM chats WHERE id = ?", [a.chat_id])).length, 0);
    assert.equal((await all("SELECT 1 FROM messages WHERE chat_id = ?", [a.chat_id])).length, 0);
    assert.equal((await fresh(a)).chat_id, null);
    assert.equal((await fresh(b)).chat_id, null);
    assert.equal((await all("SELECT 1 FROM chats WHERE id = ?", [c.chat_id])).length, 1);
    assert.equal((await fresh(d)).chat_id, c.chat_id);
  });
});

describe("online count", () => {
  it("counts signed-in people seen in the last minute, including ones just sitting on the home screen", async () => {
    const before = await onlineCount();
    const user = await signUp("boy"); // signed in, but no page has checked in yet
    assert.equal(await onlineCount(), before);

    assert.equal((await pollState(user, null, null, 0)).status, "idle"); // the home screen's poll
    assert.equal(await onlineCount(), before + 1);

    await run("UPDATE users SET last_seen = ? WHERE id = ?", [Date.now() - 120_000, user.id]); // closed the tab 2 min ago
    assert.equal(await onlineCount(), before);
  });
});

import {
  adminLogin, deleteChat, deletePublicMessage, deleteUser, isAdminUsername, listPublicMessages, dismissReport, endUserChat, isAdmin, listReports, listUsers, overview, reportDetail, setBlocked,
  setUserGender, signOutEverywhere, userDetail,
} from "../src/lib/admin";
import { migrate } from "../src/lib/db";
import { reportEmail } from "../src/lib/report-mail";

describe("admin", () => {
  const PASS = "correct-horse-battery";
  before(() => {
    process.env.ADMIN_USERNAME = "boss";
    process.env.ADMIN_PASSWORD = PASS;
  });
  const count = async (sql: string, args: (string | number)[] = []) => (await one<{ n: number }>(sql, args))!.n;

  it("signs in with the right username and password only", () => {
    assert.ok(isAdmin(adminLogin("boss", PASS)));
    assert.ok(isAdmin(adminLogin("  boss ", PASS)), "surrounding spaces in the username are ignored");
    for (const [u, p] of [["boss", "wrong"], ["nope", PASS], ["", ""], [undefined, undefined], [1, 2]]) {
      assert.throws(() => adminLogin(u, p), (e) => e instanceof ApiError && e.status === 401);
    }
  });

  it("refuses forged, expired and outdated cookies", () => {
    const cookie = adminLogin("boss", PASS);
    assert.equal(isAdmin(undefined), false);
    assert.equal(isAdmin("garbage"), false);
    assert.equal(isAdmin(cookie.slice(0, -2) + "xx"), false, "tampered signature");
    const [exp, sig] = cookie.split(".");
    assert.equal(isAdmin(`${Number(exp) + 99999999}.${sig}`), false, "extended expiry");

    const realNow = Date.now;
    Date.now = () => realNow() + 9 * 60 * 60 * 1000; // 9 hours later: past the 8 hour limit
    try {
      assert.equal(isAdmin(cookie), false, "expired");
    } finally {
      Date.now = realNow;
    }
    process.env.ADMIN_PASSWORD = "a-different-password";
    assert.equal(isAdmin(cookie), false, "changing the password signs everyone out");
    process.env.ADMIN_PASSWORD = PASS;
    assert.ok(isAdmin(cookie));
  });

  it("stays off unless both values are set and the password is long enough", () => {
    process.env.ADMIN_PASSWORD = "short";
    assert.throws(() => adminLogin("boss", "short"), (e) => e instanceof ApiError && e.status === 503);
    process.env.ADMIN_PASSWORD = PASS;
    delete process.env.ADMIN_USERNAME;
    assert.throws(() => adminLogin("", PASS), (e) => e instanceof ApiError && e.status === 503);
    process.env.ADMIN_USERNAME = "boss";
  });

  it("shows a report with the conversation labelled by who said what, and builds the email", async () => {
    const [reporter, reported] = await pair();
    await sendMessage(reporter, "hi");
    await sendMessage(reported, "something rude");
    await setAnonymous(reported, false);
    const before = (await overview()).openReports;
    const id = (await reportChat(reporter, "he was rude"))!;
    assert.ok(id > 0);
    assert.equal(await reportChat(reporter, "again"), null, "a second report on the same chat is ignored");
    assert.equal((await overview()).openReports, before + 1);

    assert.ok((await listReports(false)).some((r) => r.id === id));
    assert.ok(!(await listReports(true)).some((r) => r.id === id));

    const d = await reportDetail(id);
    assert.equal(d.reason, "he was rude");
    assert.equal(d.reporter.email, reporter.email);
    assert.equal(d.reported.email, reported.email);
    assert.equal(d.chat?.status, "active");
    assert.deepEqual(d.timeline.filter((m) => m.kind === "msg").map((m) => [m.who, m.text]), [["reporter", "hi"], ["reported", "something rude"]]);
    assert.ok(d.timeline.some((m) => m.kind === "info" && m.text === "Reported turned anonymity off"));

    const mail = reportEmail(d, "https://texttox.fewinfos.com");
    assert.match(mail.subject, /^\[Text to X\] New report #\d+: he was rude/);
    for (const part of ["he was rude", reporter.email, reported.email, "Reported: something rude", `https://texttox.fewinfos.com/admin#report=${id}`]) {
      assert.ok(mail.text.includes(part), `email should contain "${part}"`);
    }
  });

  it("dismiss closes the report and deletes the saved conversation once both have left", async () => {
    const [a, b] = await pair();
    await sendMessage(b, "evidence");
    const id = (await reportChat(a, "x"))!;
    const chatId = a.chat_id!;
    await leaveChat(a.id);
    await leaveChat(b.id);
    assert.ok((await count("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", [chatId])) > 0, "kept while the report is open");

    await dismissReport(id);
    assert.equal(await count("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", [chatId]), 0, "gone after dismiss");
    assert.ok((await listReports(true)).some((r) => r.id === id && r.status === "dismissed"));
    assert.ok(!(await listReports(false)).some((r) => r.id === id));
    assert.equal((await reportDetail(id)).chat?.status, "ended", "the report itself remains for the record");
  });

  it("block ends the chat, signs the person out, closes the report; unblock lets them back", async () => {
    const [a, b] = await pair();
    const id = (await reportChat(a, "abuse"))!;
    assert.ok((await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [b.id])) > 0);

    await setBlocked(b.id, true, id);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [b.id]), 0);
    assert.equal((await fresh(b)).chat_id, null);
    assert.equal((await pollState(await fresh(a), null, null, 0)).chat!.ended, true, "the other person sees the chat end");
    assert.equal((await reportDetail(id)).status, "actioned");
    assert.equal((await reportDetail(id)).reported.blocked, true);
    assert.ok((await listUsers("", "blocked")).some((u) => u.id === b.id), "shows up under the Blocked filter");
    await setBlocked(b.id, false);
    assert.equal((await userDetail(b.id)).blocked, false);
  });

  it("sign-out-everywhere and end-chat work", async () => {
    const [a, b] = await pair();
    await signOutEverywhere(a.id);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [a.id]), 0);
    await endUserChat(b.id);
    assert.equal((await fresh(b)).chat_id, null);
    assert.equal((await pollState(await fresh(a), null, null, 0)).chat!.ended, true);
  });

  it("sets a missing gender, and a real change ends the chat and the search", async () => {
    const u = await signUp(null);
    assert.ok((await listUsers("", "unset")).some((x) => x.id === u.id), "listed under Gender not set");
    await assert.rejects(joinQueue(u, "girl"), (e) => e instanceof ApiError && e.status === 400, "can't search without one");

    await setUserGender(u.id, "boy");
    assert.equal((await userDetail(u.id)).gender, "boy");
    assert.ok(!(await listUsers("", "unset")).some((x) => x.id === u.id), "no longer listed");
    await joinQueue(await fresh(u), "girl");
    assert.ok(await one("SELECT 1 FROM queue WHERE user_id = ?", [u.id]), "searching with the new gender");

    await setUserGender(u.id, "boy"); // same value: nothing happens
    assert.ok(await one("SELECT 1 FROM queue WHERE user_id = ?", [u.id]), "an unchanged value leaves the search alone");
    await setUserGender(u.id, "girl");
    assert.equal(await one("SELECT 1 FROM queue WHERE user_id = ?", [u.id]), undefined, "a change takes them out of the search");

    const [a, b] = await pair();
    await setUserGender(a.id, a.gender === "boy" ? "girl" : "boy");
    assert.equal((await fresh(a)).chat_id, null, "their chat ends");
    assert.equal((await pollState(await fresh(b), null, null, 0)).chat!.ended, true, "and the other person sees it end");
  });

  it("clearing a gender makes the person choose again, once", async () => {
    const u = await signUp("girl");
    await setUserGender(u.id, null);
    const poll = await pollState(await fresh(u), null, null, 0);
    assert.equal(poll.me.gender, null, "the site asks them to choose");
    await setGender(await fresh(u), "boy");
    assert.equal((await userDetail(u.id)).gender, "boy");
    await assert.rejects(setUserGender(999_999, "boy"), (e) => e instanceof ApiError && e.status === 404);
  });

  it("deletes a person completely and leaves their partner untouched", async () => {
    const [victim, partner] = await pair();
    await sendMessage(victim, "hello");
    await sendMessage(partner, "hi");
    const reportId = (await reportChat(partner, "meh"))!;
    await skipCooldown(); // they signed up a moment ago
    await codeFor(victim.email, "reset", "9.9.9.9"); // leaves a login code and rate-limit counters behind
    assert.ok((await count("SELECT COUNT(*) AS n FROM otps WHERE email = ?", [victim.email])) > 0);
    const chatId = victim.chat_id!;

    await deleteUser(victim.id);

    for (const [what, sql, arg] of [
      ["the account", "SELECT COUNT(*) AS n FROM users WHERE id = ?", victim.id],
      ["sessions", "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", victim.id],
      ["queue entry", "SELECT COUNT(*) AS n FROM queue WHERE user_id = ?", victim.id],
      ["login code", "SELECT COUNT(*) AS n FROM otps WHERE email = ?", victim.email],
      ["rate limit counter", "SELECT COUNT(*) AS n FROM rate_limits WHERE key = ?", `otp:email:${victim.email}`],
      ["chats", "SELECT COUNT(*) AS n FROM chats WHERE id = ?", chatId],
      ["messages", "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", chatId],
      ["reports", "SELECT COUNT(*) AS n FROM reports WHERE id = ?", reportId],
    ] as const) {
      assert.equal(await count(sql, [arg]), 0, `${what} should be gone`);
    }
    const p = await fresh(partner);
    assert.ok(p, "the partner's account survives");
    assert.equal(p.chat_id, null, "and is sent back to the home screen");
    assert.equal((await pollState(p, null, null, 0)).status, "idle");
    await assert.rejects(userDetail(victim.id), (e) => e instanceof ApiError && e.status === 404);
  });

  it("deleting a conversation removes it and its reports", async () => {
    const [a, b] = await pair();
    await sendMessage(a, "x");
    await reportChat(b, "y");
    const chatId = a.chat_id!;
    await deleteChat(chatId);
    assert.equal(await count("SELECT COUNT(*) AS n FROM chats WHERE id = ?", [chatId]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", [chatId]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM reports WHERE chat_id = ?", [chatId]), 0);
    assert.equal((await fresh(a)).chat_id, null);
    assert.equal((await fresh(b)).chat_id, null);
  });

  it("finds users by search text (with wildcards treated literally) and by filter", async () => {
    const u = await signUp("girl");
    const tag = u.email.split("@")[0];
    assert.deepEqual((await listUsers(tag.toUpperCase(), "all")).map((x) => x.id), [u.id]);
    assert.equal((await listUsers("%", "all")).length, 0, "% is not a wildcard");
    const withUnderscore = await count("SELECT COUNT(*) AS n FROM users WHERE instr(email, '_') > 0 OR instr(username, '_') > 0");
    assert.equal((await listUsers("_", "all")).length, withUnderscore, "_ matches only a real underscore, not any character");
    assert.deepEqual((await listUsers(u.username!.toUpperCase(), "all")).map((x) => x.id), [u.id], "search also finds usernames");
    await pollState(u, null, null, 0);
    assert.ok((await listUsers("", "online")).some((x) => x.id === u.id && x.online));
    const detail = await userDetail(u.id);
    assert.equal(detail.gender, "girl");
    assert.equal(detail.reportsAgainst, 0);
  });

  it("upgrades tables from before reports had a status and users had passwords", async () => {
    const db = await getDb();
    const columns = async (table: string) => (await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
    await db.execute("ALTER TABLE reports DROP COLUMN status");
    await db.execute("ALTER TABLE users DROP COLUMN password_hash");
    await db.execute("ALTER TABLE otps DROP COLUMN verified");
    await db.execute("DROP INDEX idx_users_username");
    await db.execute("ALTER TABLE users DROP COLUMN username");
    assert.ok(!(await columns("users")).includes("password_hash"), "the test starts from the old shape");

    await migrate(db);
    await migrate(db); // twice is fine
    assert.ok((await columns("reports")).includes("status"));
    assert.ok((await columns("users")).includes("password_hash"));
    assert.ok((await columns("otps")).includes("verified"));
    assert.ok((await columns("users")).includes("username"), "accounts from before usernames get the column, empty");
    assert.ok((await count("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NULL")) > 0, "existing people simply have no password yet");
    assert.ok((await count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'")) >= 0);
  });
});

describe("non-specific (random) chat", () => {
  it("pairs two people who both chose random, whatever their gender and even with none set", async () => {
    const boy = await signUp("boy");
    const girl = await signUp("girl");
    const unset = await signUp(null);
    await joinQueue(boy, "any");
    assert.equal((await fresh(boy)).chat_id, null);
    await joinQueue(unset, "any"); // no gender needed for this kind of chat
    const [b, u] = [await fresh(boy), await fresh(unset)];
    assert.ok(b.chat_id);
    assert.equal(b.chat_id, u.chat_id);
    assert.equal((await fresh(girl)).chat_id, null);

    await joinQueue(girl, "any");
    await joinQueue(await signUp("girl"), "any");
    assert.ok((await fresh(girl)).chat_id, "girl and girl pair too");
  });

  it("never mixes with the specific chat", async () => {
    const wantsGirl = await signUp("boy");
    const wantsBoy = await signUp("girl");
    const random = await signUp(null);
    await joinQueue(wantsGirl, "girl");
    await joinQueue(random, "any");
    assert.equal((await fresh(wantsGirl)).chat_id, null);
    assert.equal((await fresh(random)).chat_id, null, "a random searcher is not handed to someone who wants a girl");
    await joinQueue(wantsBoy, "boy");
    assert.equal((await fresh(wantsGirl)).chat_id, (await fresh(wantsBoy)).chat_id);
    assert.equal((await fresh(random)).chat_id, null);
    await cancelSearch(random.id);
  });

  it("the specific chat still needs a gender, and the choice must be one of three", async () => {
    const unset = await signUp(null);
    await rejects(joinQueue(unset, "girl"), 400);
    await rejects(joinQueue(unset, "everyone"), 400);
    await rejects(joinQueue(unset, undefined), 400);
  });

  it("shows the search as 'any' to the client, and chats work like any other", async () => {
    const a = await signUp(null);
    const b = await signUp(null);
    await joinQueue(a, "any");
    assert.equal((await pollState(a, null, null, 0)).want, "any");
    await joinQueue(b, "any");
    await sendMessage(await fresh(a), "hello stranger");
    const v = await pollState(await fresh(b), null, null, 0);
    assert.equal(v.status, "chatting");
    assert.ok(v.chat!.messages.some((m) => m.kind === "msg" && m.text === "hello stranger" && !m.mine));
    assert.equal(v.chat!.partner.handle, null, "still anonymous");
  });
});

describe("public room", () => {
  const count = async (sql: string) => (await one<{ n: number }>(sql))!.n;
  const texts = (r: { messages: { text: string }[] }) => r.messages.map((m) => m.text);

  it("shows what everybody posts, tells you which are yours, and never says who wrote them", async () => {
    const a = await signUp(null);
    const b = await signUp(null);
    const sent = await sendPublic(a, "  hello room  ");
    await sendPublic(b, "hi a");

    const seenByA = await pollPublic(a, 0);
    const seenByB = await pollPublic(b, 0);
    assert.deepEqual(texts(seenByA).slice(-2), ["hello room", "hi a"]);
    assert.deepEqual(seenByA.messages.slice(-2).map((m) => m.mine), [true, false]);
    assert.deepEqual(seenByB.messages.slice(-2).map((m) => m.mine), [false, true]);
    assert.ok(sent.id > 0);
    for (const [view, other] of [[seenByA, b], [seenByB, a]] as const) {
      const json = JSON.stringify(view);
      assert.ok(!json.includes(other.email), "email leaked");
      assert.ok(!json.includes(other.username!), "username leaked");
      assert.deepEqual(Object.keys(view.messages[0]).sort(), ["at", "id", "mine", "text"], "only text, time, id and mine are sent");
    }
  });

  it("only returns what is newer than the last message you have, and answers empty once the wait is over", { timeout: 40_000 }, async () => {
    const a = await signUp(null);
    const first = await sendPublic(a, "first");
    assert.deepEqual(texts(await pollPublic(a, first.id)), []);
  });

  it("wakes up a waiting reader as soon as someone posts", async () => {
    const a = await signUp(null);
    const b = await signUp(null);
    const last = (await sendPublic(a, "anchor")).id;
    const started = Date.now();
    const waiting = pollPublic(b, last);
    setTimeout(() => void sendPublic(a, "news!"), 300);
    assert.deepEqual(texts(await waiting), ["news!"]);
    assert.ok(Date.now() - started < 8_000, "answered long before the 20 s limit");
  });

  it("messages are only visible for 48 hours, and cleanup removes them", async () => {
    const a = await signUp(null);
    const old = (await sendPublic(a, "ancient")).id;
    await sendPublic(a, "recent");
    await run("UPDATE public_messages SET created_at = ? WHERE id = ?", [Date.now() - 48 * 3600_000 - 1000, old]);
    assert.ok(!texts(await pollPublic(a, 0)).includes("ancient"), "hidden even before cleanup runs");
    assert.ok(texts(await pollPublic(a, 0)).includes("recent"));

    await cleanup();
    assert.equal(await count("SELECT COUNT(*) AS n FROM public_messages WHERE id = " + old), 0);
    assert.ok(texts(await pollPublic(a, 0)).includes("recent"), "recent messages survive cleanup");
  });

  it("validates and rate-limits posts", async () => {
    const a = await signUp(null);
    await rejects(sendPublic(a, "   "), 400);
    await rejects(sendPublic(a, 5), 400);
    await rejects(sendPublic(a, "x".repeat(501)), 400);
    for (let i = 0; i < 12; i++) await sendPublic(a, `msg ${i}`);
    await rejects(sendPublic(a, "one too many"), 429);
  });

  it("counts people in the room as online", async () => {
    const a = await signUp(null);
    await run("UPDATE users SET last_seen = 0 WHERE id = ?", [a.id]);
    await pollPublic(a, 0);
    assert.ok((await fresh(a)).last_seen > Date.now() - 10_000);
  });

  it("lets the admin see authors and delete a message, and deleting a user removes their messages", async () => {
    const a = await signUp(null);
    const b = await signUp(null);
    const m1 = (await sendPublic(a, "rude one")).id;
    await sendPublic(b, "nice one");

    const row = (await listPublicMessages()).find((m) => m.id === m1)!;
    assert.equal(row.userId, a.id);
    assert.equal(row.username, a.username);
    assert.equal(row.email, a.email);

    await deletePublicMessage(m1);
    assert.ok(!texts(await pollPublic(b, 0)).includes("rude one"));
    await assert.rejects(deletePublicMessage(m1), (e) => e instanceof ApiError && e.status === 404);

    await deleteUser(b.id);
    assert.ok(!texts(await pollPublic(a, 0)).includes("nice one"));
  });
});

describe("signing in as the admin from the ordinary form", () => {
  it("recognises only the admin's own username (no @), and only when admin is set up", () => {
    process.env.ADMIN_USERNAME = "boss";
    process.env.ADMIN_PASSWORD = "a long admin password";
    assert.equal(isAdminUsername("boss"), true);
    assert.equal(isAdminUsername("  boss "), true);
    assert.equal(isAdminUsername("Boss"), false, "same exact-match rule as the admin page");
    assert.equal(isAdminUsername("boss@example.com"), false);
    assert.equal(isAdminUsername("someone"), false);
    assert.equal(isAdminUsername(undefined), false);
    process.env.ADMIN_PASSWORD = "short";
    assert.equal(isAdminUsername("boss"), false, "admin is off, so it is just a username");
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
  });
});
