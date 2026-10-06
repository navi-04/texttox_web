import { NextResponse } from "next/server";
import { endSession, SESSION_COOKIE } from "@/lib/auth";
import { cancelSearch } from "@/lib/chat";
import { authed, sessionCookie } from "@/lib/http";

export const POST = authed(async (req, user) => {
  await endSession(req.cookies.get(SESSION_COOKIE)?.value);
  await cancelSearch(user.id);
  const res = NextResponse.json({ ok: true });
  sessionCookie(res, "", 0);
  return res;
});
