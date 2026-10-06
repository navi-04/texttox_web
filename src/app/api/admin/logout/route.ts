import { NextResponse } from "next/server";
import { adminCookie, open } from "@/lib/http";

export const POST = open(async () => {
  const res = NextResponse.json({ ok: true });
  adminCookie(res, "", 0);
  return res;
});
