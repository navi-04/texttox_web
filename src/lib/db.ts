import type { Client, InStatement, InValue, ResultSet } from "@libsql/client";
import { SCHEMA } from "./schema";

const g = globalThis as unknown as { __db?: Promise<Client> };

async function open(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  if (url.includes("your-database-name")) throw new Error("TURSO_DATABASE_URL still has the placeholder value - put your real libsql:// URL in .env");

  if (url.startsWith("file:")) {
    // Local sqlite file for offline development and tests (native build).
    const { createClient } = await import("@libsql/client");
    return createClient({ url });
  }
  // Remote Turso: the web build is plain fetch (no native code) and works on Vercel.
  const { createClient } = await import("@libsql/client/web");
  return createClient({ url: url.replace(/^libsql:/, "https:"), authToken });
}

/** SQLite has no "ADD COLUMN IF NOT EXISTS", so look first. One look per table, not per column: every cold start runs this. */
async function ensureColumns(client: Client, table: string, columns: Record<string, string>) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const have = new Set(info.rows.map((r) => String(r.name)));
  for (const [column, ddl] of Object.entries(columns)) {
    if (have.has(column)) continue;
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (e) {
      if (!/duplicate column/i.test(String(e))) throw e; // another server instance just added it
    }
  }
}

/** Creates missing tables and columns. Idempotent, so it is safe on every cold start. */
export async function migrate(client: Client): Promise<void> {
  await client.batch(SCHEMA, "write");
  // Added after the first release: databases created back then lack it.
  await ensureColumns(client, "reports", { status: "TEXT NOT NULL DEFAULT 'open'" });
  await ensureColumns(client, "otps", { verified: "INTEGER NOT NULL DEFAULT 0" });
  await ensureColumns(client, "users", { password_hash: "TEXT", username: "TEXT" });
  await ensureColumns(client, "public_messages", { reply_to: "INTEGER" });
  await ensureColumns(client, "chats", {
    mode: "TEXT NOT NULL DEFAULT 'chat'",
    turn_user: "INTEGER",
    phase: "TEXT",
    pick: "TEXT",
    custom: "INTEGER NOT NULL DEFAULT 0",
    skips_a: "INTEGER NOT NULL DEFAULT 0",
    skips_b: "INTEGER NOT NULL DEFAULT 0",
  });
  // After the column exists. Several NULLs are fine in a unique index, so old accounts without a username don't clash.
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)");
}

async function connect(): Promise<Client> {
  const client = await open();
  await migrate(client);
  return client;
}

export function getDb(): Promise<Client> {
  g.__db ??= connect().catch((e) => {
    g.__db = undefined; // let the next request retry
    throw e;
  });
  return g.__db;
}

export type Row = Record<string, string | number | null>;

/**
 * The tables are created once, when the connection is first opened. A server that was already running when a newer
 * version added a table or column (a dev server that hot-reloads, say) would then fail with "no such table". So if a
 * query hits exactly that, run the (idempotent) setup again, once, and retry. Other errors pass straight through.
 */
let healing: Promise<void> | undefined;
async function withRepair<T>(work: (db: Client) => Promise<T>): Promise<T> {
  const db = await getDb();
  try {
    return await work(db);
  } catch (e) {
    if (!/no such (table|column)|has no column named/i.test(String(e))) throw e;
    healing ??= migrate(db).finally(() => {
      healing = undefined;
    });
    await healing;
    return work(db);
  }
}

export async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const res = await withRepair((db) => db.execute({ sql, args }));
  return res.rows as unknown as T[];
}

export async function one<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

/** Several writes as one atomic transaction (a failed one changes nothing, so retrying after a repair is safe). */
export async function batch(statements: InStatement[]): Promise<ResultSet[]> {
  return withRepair((db) => db.batch(statements, "write"));
}

/** Runs a write and returns how many rows it changed. */
export async function run(sql: string, args: InValue[] = []): Promise<number> {
  return (await withRepair((db) => db.execute({ sql, args }))).rowsAffected;
}
