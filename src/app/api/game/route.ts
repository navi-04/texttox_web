import { drawPrompt, finishTurn, pickKind, skipTurn, writePrompt } from "@/lib/game";
import { ApiError } from "@/lib/errors";
import { authed, readBody } from "@/lib/http";

// One endpoint for the five moves of Truth or Dare: { action: "pick" | "draw" | "ask" | "done" | "skip", kind?, text? }.
export const POST = authed(async (req, user) => {
  const { action, kind, text } = await readBody(req);
  switch (action) {
    case "pick":
      return pickKind(user, kind);
    case "draw":
      return drawPrompt(user);
    case "ask":
      return writePrompt(user, text);
    case "done":
      return finishTurn(user);
    case "skip":
      return skipTurn(user);
    default:
      throw new ApiError(400, "Invalid request.");
  }
});
