import { setAnonymous } from "@/lib/chat";
import { authed, readBody } from "@/lib/http";

export const POST = authed(async (req, user) => {
  const { anonymous } = await readBody(req);
  await setAnonymous(user, anonymous);
});
