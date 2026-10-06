import { cancelSearch } from "@/lib/chat";
import { authed } from "@/lib/http";

export const POST = authed(async (_req, user) => {
  await cancelSearch(user.id);
});
