import { after } from "next/server";
import { reportChat } from "@/lib/chat";
import { authed, readBody } from "@/lib/http";
import { notifyReport } from "@/lib/report-mail";

export const POST = authed(async (req, user) => {
  const { reason } = await readBody(req);
  const reportId = await reportChat(user, reason);
  // Email the admin after the response has gone out, so the reporter isn't kept waiting on the mail server.
  if (reportId) after(() => notifyReport(reportId, req.nextUrl.origin));
});
