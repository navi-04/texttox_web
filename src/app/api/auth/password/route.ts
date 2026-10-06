import { NextResponse } from "next/server";
import { SESSION_TTL_MS, setPassword } from "@/lib/auth";
import { clientIp, open, readBody, sessionCookie } from "@/lib/http";

// Final step of creating an account (email, username, password) or resetting a password; signs the person in.
export const POST = open(async (req) => {
  const { email, ticket, password, username } = await readBody(req);
  const { token } = await setPassword(email, ticket, password, clientIp(req), username);
  const res = NextResponse.json({ ok: true });
  sessionCookie(res, token, SESSION_TTL_MS / 1000);
  return res;
});
