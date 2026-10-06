import { joinQueue } from "@/lib/chat";
import { authed, readBody } from "@/lib/http";
import { maybeCleanup } from "@/lib/maintenance";

export const POST = authed(async (req, user) => {
  const { want } = await readBody(req);
  await joinQueue(user, want);
  await maybeCleanup();
});
