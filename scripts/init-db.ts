import { getDb } from "../src/lib/db";

// The app creates its own tables on first use; this just proves the credentials work and shows what is there.
async function main() {
  const db = await getDb(); // connects and creates any missing tables

  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  console.log("Database ready. Tables:", tables.rows.map((r) => r.name).join(", "));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("db:init failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
