import { listPublicMessages } from "@/lib/admin";
import { adminOnly } from "@/lib/http";

export const dynamic = "force-dynamic";

// The public room's live messages, newest first, with who posted them (admin only).
export const GET = adminOnly(async () => ({ messages: await listPublicMessages() }));
