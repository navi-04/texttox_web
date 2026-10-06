import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdmin } from "./admin";
import { getUserByToken, SESSION_COOKIE, type User } from "./auth";
import { ApiError } from "./errors";

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

/** Body of a JSON request as a plain object (empty if missing or malformed). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// Browsers always send Origin on cross-site POSTs; refuse any that is not this site.
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

type Handler<U> = (req: NextRequest, user: U) => Promise<unknown>;

type Mode = "public" | "user" | "admin";

function wrap<U extends User | null>(mode: Mode, handler: Handler<U>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) throw new ApiError(403, "Forbidden.");
      let user = null as User | null;
      if (mode === "user") {
        user = (await getUserByToken(req.cookies.get(SESSION_COOKIE)?.value)) ?? null;
        if (!user) throw new ApiError(401, "Please sign in.");
      } else if (mode === "admin" && !isAdmin(req.cookies.get(ADMIN_COOKIE)?.value)) {
        throw new ApiError(401, "Admin sign-in required.");
      }
      const result = await handler(req, user as U);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const noStore = { headers: { "Cache-Control": "no-store" } };
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status, ...noStore });
      console.error(`${req.method} ${req.nextUrl.pathname} failed:`, e);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500, ...noStore });
    }
  };
}

/** API route that needs a signed-in user. */
export const authed = (handler: Handler<User>) => wrap<User>("user", handler);
/** API route open to everyone. */
export const open = (handler: Handler<null>) => wrap<null>("public", handler);
/** API route for the admin only (valid admin cookie). */
export const adminOnly = (handler: Handler<null>) => wrap<null>("admin", handler);

export function sessionCookie(res: NextResponse, token: string, maxAgeSeconds: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function adminCookie(res: NextResponse, value: string, maxAgeSeconds: number) {
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}
