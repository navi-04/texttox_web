import { listUsers, userDetail } from "@/lib/admin";
import { ApiError } from "@/lib/errors";
import { adminOnly } from "@/lib/http";

export const dynamic = "force-dynamic";

// ?id=5 -> one user in detail; otherwise ?q=search text&filter=all|online|blocked|reported|unset
export const GET = adminOnly(async (req) => {
  const q = req.nextUrl.searchParams;
  const id = q.get("id");
  if (id !== null) {
    if (!/^\d+$/.test(id)) throw new ApiError(400, "Bad user id.");
    return userDetail(Number(id));
  }
  return { users: await listUsers((q.get("q") ?? "").slice(0, 100), q.get("filter") ?? "all") };
});
