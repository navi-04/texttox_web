import { NextResponse } from "next/server";
import { ADMIN_TTL_MS, adminLogin } from "@/lib/admin";
import { ApiError } from "@/lib/errors";
import { adminCookie, clientIp, open, readBody } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const POST = open(async (req) => {
  // Slow down guessing: 8 tries per 15 minutes from one address.
  if (!(await allow(`admin:login:${clientIp(req)}`, 8, 15 * 60 * 1000))) {
    throw new ApiError(429, "Too many attempts. Try again in 15 minutes.");
  }
  const { username, password } = await readBody(req);
  const value = adminLogin(username, password);
  const res = NextResponse.json({ ok: true });
  adminCookie(res, value, ADMIN_TTL_MS / 1000);
  return res;
});
