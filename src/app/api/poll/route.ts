import { authed } from "@/lib/http";
import { pollState } from "@/lib/state";

export const dynamic = "force-dynamic";
// The request is held open for up to HOLD_MS (20s); leave headroom for the final queries.
export const maxDuration = 30;

export const GET = authed(async (req, user) => {
  const q = req.nextUrl.searchParams;
  const after = Number(q.get("after"));
  return pollState(user, q.get("t"), q.get("c"), Number.isFinite(after) && after > 0 ? after : 0, req.signal);
});
