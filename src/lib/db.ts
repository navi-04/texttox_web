import type { Client, InValue } from "@libsql/client";
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

/** SQLite has no "ADD COLUMN IF NOT EXISTS", so look first. */
async function ensureColumn(client: Client, table: string, column: string, ddl: string) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  if (info.rows.some((r) => r.name === column)) return;
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  } catch (e) {
    if (!/duplicate column/i.test(String(e))) throw e; // another server instance just added it
  }
}

/** Creates missing tables and columns. Idempotent, so it is safe on every cold start. */
export async function migrate(client: Client): Promise<void> {
  await client.batch(SCHEMA, "write");
  // Added after the first release: databases created back then lack it.
  await ensureColumn(client, "reports", "status", "TEXT NOT NULL DEFAULT 'open'");
  await ensureColumn(client, "users", "password_hash", "TEXT");
  await ensureColumn(client, "otps", "verified", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(client, "users", "username", "TEXT");
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

export async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const db = await getDb();
  const res = await db.execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function one<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

/** Runs a write and returns how many rows it changed. */
export async function run(sql: string, args: InValue[] = []): Promise<number> {
  const db = await getDb();
  return (await db.execute({ sql, args })).rowsAffected;
}
