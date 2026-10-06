import { after } from "next/server";
import { requestCode } from "@/lib/auth";
import { clientIp, open, readBody } from "@/lib/http";
import { maybeCleanup } from "@/lib/maintenance";

export const POST = open(async (req) => {
  const { email, purpose } = await readBody(req);
  const send = await requestCode(email, purpose, clientIp(req));
  // The reply is identical whether or not an email goes out, so it must not wait for the mail server either.
  if (send) after(send);
  await maybeCleanup();
  return { ok: true };
});
