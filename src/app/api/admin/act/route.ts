import { deleteAllPublicMessages, deleteChat, deletePublicMessage, deleteUser, dismissReport, endUserChat, setBlocked, setPublicTtl, setUserGender, signOutEverywhere } from "@/lib/admin";
import { ApiError } from "@/lib/errors";
import { adminOnly, readBody } from "@/lib/http";

const id = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new ApiError(400, `Missing ${what}.`);
  return v;
};

// One endpoint for every admin action: { action, userId?, reportId?, chatId?, confirm? }
export const POST = adminOnly(async (req) => {
  const b = await readBody(req);
  switch (b.action) {
    case "block":
    case "unblock":
      return setBlocked(id(b.userId, "user"), b.action === "block", b.reportId === undefined ? undefined : id(b.reportId, "report"));
    case "signout":
      return signOutEverywhere(id(b.userId, "user"));
    case "endchat":
      return endUserChat(id(b.userId, "user"));
    case "setgender":
      // "boy" or "girl" sets it; null clears it so the person chooses again.
      if (b.gender !== null && b.gender !== "boy" && b.gender !== "girl") throw new ApiError(400, "Choose boy, girl or not set.");
      return setUserGender(id(b.userId, "user"), b.gender);
    case "dismiss":
      return dismissReport(id(b.reportId, "report"));
    case "deletechat":
      if (typeof b.chatId !== "string" || !b.chatId) throw new ApiError(400, "Missing conversation.");
      return deleteChat(b.chatId);
    case "deletepublic":
      return deletePublicMessage(id(b.messageId, "message"));
    case "setpublicttl":
      // { hours: 12 | 24 | 36 | 48 }: how long public-room messages live. Anything older than that is deleted now.
      return setPublicTtl(b.hours);
    case "deleteallpublic":
      // Same rule as deleting a user: the screen asks for DELETE, and the server checks it too.
      if (b.confirm !== "DELETE") throw new ApiError(400, "Type DELETE to confirm.");
      return { removed: await deleteAllPublicMessages() };
    case "deleteuser":
      // The screen asks the admin to type DELETE; check here too so a stray request can't remove anyone.
      if (b.confirm !== "DELETE") throw new ApiError(400, "Type DELETE to confirm.");
      return deleteUser(id(b.userId, "user"));
    default:
      throw new ApiError(400, "Unknown action.");
  }
});
