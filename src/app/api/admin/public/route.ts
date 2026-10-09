import { listPublicMessages } from "@/lib/admin";
import { adminOnly } from "@/lib/http";
import { getPublicTtlHours, PUBLIC_TTL_OPTIONS } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The public room's live messages, newest first, with who posted them (admin only), and how long they live.
export const GET = adminOnly(async () => ({
  messages: await listPublicMessages(),
  ttlHours: await getPublicTtlHours(),
  options: PUBLIC_TTL_OPTIONS,
}));
