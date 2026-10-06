import { removeUser } from "./admin";
import { verifyCredentials } from "./auth";
import { one, run } from "./db";
import { ApiError } from "./errors";

/**
 * Lets someone delete their own account with their username (or email) and password.
 * Everything tied to the account goes at once: see removeUser (account, sessions, chats, public messages, reports).
 * The admin activity log is cleaned too, so the email does not survive there. Blocked accounts can't use this,
 * otherwise deleting would be a way to shake off a block.
 */
export async function deleteOwnAccount(rawId: unknown, rawPassword: unknown, rawConfirm: unknown, ip: string): Promise<void> {
  if (rawConfirm !== "DELETE") throw new ApiError(400, "Please confirm that you want to delete your account.");
  const { id } = await verifyCredentials(rawId, rawPassword, ip);

  const user = await one<{ email: string }>("SELECT email FROM users WHERE id = ?", [id]);
  if (!user) throw new ApiError(404, "Account not found.");

  await removeUser(id, user.email);
  // Older admin log lines can mention the email as plain text ("email" or "email: something").
  const like = `${user.email.replace(/[\\%_]/g, "\\$&")}: %`;
  await run("DELETE FROM admin_log WHERE detail = ? OR detail LIKE ? ESCAPE '\\'", [user.email, like]);
}
