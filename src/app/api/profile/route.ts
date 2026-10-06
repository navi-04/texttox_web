import { setGender } from "@/lib/auth";
import { authed, readBody } from "@/lib/http";

export const POST = authed(async (req, user) => {
  const { gender } = await readBody(req);
  await setGender(user, gender);
});
