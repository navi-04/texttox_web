import { authed } from "@/lib/http";
import { pollPublic } from "@/lib/public";

export const dynamic = "force-dynamic";
// Held open for up to 20s (PUBLIC_HOLD_MS); leave headroom for the final query.
export const maxDuration = 30;

// ?after=<id of the newest message you have> -> newer messages (waits for some); omit it for the latest ones.
export const GET = authed(async (req, user) => {
  const after = Number(req.nextUrl.searchParams.get("after"));
  return pollPublic(user, Number.isFinite(after) && after > 0 ? after : 0, req.signal);
});
