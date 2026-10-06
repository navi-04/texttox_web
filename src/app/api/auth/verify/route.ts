import { verifyCode } from "@/lib/auth";
import { clientIp, open, readBody } from "@/lib/http";

// Checks the emailed code and hands back a one-time ticket for choosing the password.
export const POST = open(async (req) => {
  const { email, code } = await readBody(req);
  return verifyCode(email, code, clientIp(req));
});
