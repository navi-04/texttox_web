// All timestamps are milliseconds since the epoch.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE,            -- canonical form, see parseEmail()
    username    TEXT,                               -- lowercase, unique (index added in migrate()); NULL only for accounts made before usernames existed
    password_hash TEXT,                             -- scrypt; NULL until the person has chosen a password
    gender      TEXT    CHECK (gender IN ('boy', 'girl')),
    chat_id     TEXT,                               -- the one chat this user is in (NULL = none)
    banned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL DEFAULT 0
  )`,

  // "Who is online" counts users seen in the last minute.
  `CREATE INDEX IF NOT EXISTS idx_users_seen ON users (last_seen)`,

  // One live code (or, once verified, one ticket for choosing a password) per email.
  `CREATE TABLE IF NOT EXISTS otps (
    email       TEXT    PRIMARY KEY,
    code_hash   TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    sent_at     INTEGER NOT NULL,
    verified    INTEGER NOT NULL DEFAULT 0              -- 1 = code checked; code_hash then holds the one-time ticket
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  )`,

  // Users who are searching right now. One row per user, so nobody can queue twice.
  `CREATE TABLE IF NOT EXISTS queue (
    user_id     INTEGER PRIMARY KEY,
    gender      TEXT    NOT NULL,                   -- who I am
    want        TEXT    NOT NULL,                   -- who I want to talk to
    joined_at   INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_queue_match ON queue (gender, want, joined_at)`,

  // a_open / b_open = 1 means that user turned anonymity OFF (the other side can see their username).
  `CREATE TABLE IF NOT EXISTS chats (
    id          TEXT    PRIMARY KEY,
    user_a      INTEGER NOT NULL,
    user_b      INTEGER NOT NULL,
    a_open      INTEGER NOT NULL DEFAULT 0,
    b_open      INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'active',  -- active | ended
    ended_by    INTEGER,
    version     INTEGER NOT NULL DEFAULT 0,         -- bumped on every change, drives long-polling
    reported    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    ended_at    INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chats_a ON chats (user_a, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_b ON chats (user_b, created_at)`,

  // kind: msg | connected | anon_on | anon_off | ended   (sender_id says who it is about)
  `CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT    NOT NULL,
    sender_id   INTEGER,
    kind        TEXT    NOT NULL DEFAULT 'msg',
    body        TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id)`,

  `CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id      TEXT    NOT NULL,
    reporter_id  INTEGER NOT NULL,
    reported_id  INTEGER NOT NULL,
    reason       TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'open',   -- open | dismissed | actioned
    created_at   INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once ON reports (chat_id, reporter_id)`,

  // The public room. Messages are only ever shown for PUBLIC_TTL_MS; user_id is for moderation and is never sent to browsers.
  `CREATE TABLE IF NOT EXISTS public_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    body        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_public_created ON public_messages (created_at)`,

  // What the admin did, newest first on the admin overview.
  `CREATE TABLE IF NOT EXISTS admin_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    action      TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS rate_limits (
    key         TEXT    PRIMARY KEY,
    count       INTEGER NOT NULL,
    reset_at    INTEGER NOT NULL
  )`,
];
