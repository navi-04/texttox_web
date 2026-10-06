import { listReports, reportDetail } from "@/lib/admin";
import { ApiError } from "@/lib/errors";
import { adminOnly } from "@/lib/http";

export const dynamic = "force-dynamic";

// ?id=12 -> one report with its conversation; otherwise ?status=open (default) or ?status=closed
export const GET = adminOnly(async (req) => {
  const q = req.nextUrl.searchParams;
  const id = q.get("id");
  if (id !== null) {
    if (!/^\d+$/.test(id)) throw new ApiError(400, "Bad report id.");
    return reportDetail(Number(id));
  }
  return { reports: await listReports(q.get("status") === "closed") };
});
