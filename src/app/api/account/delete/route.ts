import { NextResponse } from "next/server";
import { deleteOwnAccount } from "@/lib/account";
import { clientIp, open, readBody, sessionCookie } from "@/lib/http";

// Public on purpose: the page at /delete-account works without being signed in, so someone who has uninstalled
// the app or forgotten they are signed in can still delete their account. The password is what proves it is them.
export const POST = open(async (req) => {
  const { identifier, password, confirm } = await readBody(req);
  await deleteOwnAccount(identifier, password, confirm, clientIp(req));
  const res = NextResponse.json({ ok: true });
  sessionCookie(res, "", 0); // if this browser was signed in to that account, forget it
  return res;
});
