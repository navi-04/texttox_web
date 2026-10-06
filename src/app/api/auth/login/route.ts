import { NextResponse } from "next/server";
import { ADMIN_TTL_MS, adminLogin, isAdminUsername } from "@/lib/admin";
import { BAD_LOGIN, loginWithPassword, SESSION_TTL_MS } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { adminCookie, clientIp, open, readBody, sessionCookie } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

// One sign-in form for everybody. `identifier` is a username or an email address; the admin types the admin
// username and is signed in as admin (`admin: true` in the answer tells the page to open /admin).
export const POST = open(async (req) => {
  const body = await readBody(req);
  const identifier = body.identifier ?? body.email;
  const { password } = body;
  const ip = clientIp(req);

  if (isAdminUsername(identifier)) {
    if (!(await allow(`admin:login:${ip}`, 8, 15 * 60 * 1000))) throw new ApiError(429, "Too many attempts. Try again in 15 minutes.");
    let value: string;
    try {
      value = adminLogin(identifier, password);
    } catch (e) {
      // Same words as for any other wrong password, so the form doesn't say which name is the admin's.
      throw e instanceof ApiError && e.status === 401 ? new ApiError(401, BAD_LOGIN) : e;
    }
    const res = NextResponse.json({ ok: true, admin: true });
    adminCookie(res, value, ADMIN_TTL_MS / 1000);
    return res;
  }

  const { token } = await loginWithPassword(identifier, password, ip);
  const res = NextResponse.json({ ok: true });
  sessionCookie(res, token, SESSION_TTL_MS / 1000);
  return res;
});
