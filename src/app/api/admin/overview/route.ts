import { overview } from "@/lib/admin";
import { adminOnly } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = adminOnly(async () => overview());
