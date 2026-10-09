import { one, run } from "./db";

/** How long a public-room message lives, in hours. The admin picks one of these; 48 is where it starts. */
export const PUBLIC_TTL_OPTIONS = [12, 24, 36, 48] as const;
export type PublicTtlHours = (typeof PUBLIC_TTL_OPTIONS)[number];
export const DEFAULT_PUBLIC_TTL_HOURS: PublicTtlHours = 48;

const KEY = "public_ttl_hours";
// Read often (every public-room poll), changed rarely. Each server instance remembers it briefly, so a change
// made in the admin panel reaches every instance within CACHE_MS.
const CACHE_MS = 10_000;
let cached: { hours: PublicTtlHours; at: number } | undefined;

export const isPublicTtl = (v: unknown): v is PublicTtlHours => PUBLIC_TTL_OPTIONS.includes(v as PublicTtlHours);

export async function getPublicTtlHours(): Promise<PublicTtlHours> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.hours;
  const row = await one<{ value: string }>("SELECT value FROM settings WHERE key = ?", [KEY]);
  const n = Number(row?.value);
  const hours = isPublicTtl(n) ? n : DEFAULT_PUBLIC_TTL_HOURS;
  cached = { hours, at: Date.now() };
  return hours;
}

export const publicTtlMs = async (): Promise<number> => (await getPublicTtlHours()) * 60 * 60 * 1000;

/** Stores the new value. Callers that shorten it also delete what is now too old (see setPublicTtl in admin.ts). */
export async function storePublicTtlHours(hours: PublicTtlHours): Promise<void> {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [KEY, String(hours)]);
  cached = { hours, at: Date.now() };
}
