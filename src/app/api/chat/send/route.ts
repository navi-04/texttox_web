import { sendMessage } from "@/lib/chat";
import { authed, readBody } from "@/lib/http";

export const POST = authed(async (req, user) => {
  const { text } = await readBody(req);
  return sendMessage(user, text);
});
