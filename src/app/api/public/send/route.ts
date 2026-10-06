import { authed, readBody } from "@/lib/http";
import { maybeCleanup } from "@/lib/maintenance";
import { sendPublic } from "@/lib/public";

export const POST = authed(async (req, user) => {
  const { text } = await readBody(req);
  const sent = await sendPublic(user, text);
  await maybeCleanup(50);
  return sent;
});
