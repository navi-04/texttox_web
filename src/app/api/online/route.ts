import { NextResponse } from "next/server";
import { open } from "@/lib/http";
import { onlineCount } from "@/lib/state";

export const dynamic = "force-dynamic";

// Public on purpose (the sign-in page shows it too). Vercel's CDN keeps the answer for 10 seconds, so
// any number of visitors costs the database at most one count query per 10 seconds.
export const GET = open(async () =>
  NextResponse.json(
    { online: await onlineCount() },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=10" } },
  ),
);
