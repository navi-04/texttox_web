"use client";

import { useEffect, useState } from "react";

/** The admin cookie is missing or expired. */
export class Unauthorized extends Error {}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Unauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong.");
  return data as T;
}

export const aget = <T,>(path: string) => fetch(path, { cache: "no-store" }).then((r) => parse<T>(r));

export const apost = <T = { ok: true }>(path: string, body: unknown = {}) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => parse<T>(r));

/** Loads `path` (and again whenever `reload()` is called). Pass null to load nothing. */
export function useLoad<T>(path: string | null, onLost: () => void) {
  const [state, setState] = useState<{ path: string; value: T } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError("");
    aget<T>(path).then(
      (value) => alive && setState({ path, value }),
      (e) => {
        if (!alive) return;
        if (e instanceof Unauthorized) onLost();
        else setError(e instanceof Error ? e.message : "Could not load.");
      },
    );
    return () => {
      alive = false;
    };
  }, [path, tick, onLost]);

  return { data: state && state.path === path ? state.value : null, error, reload: () => setTick((n) => n + 1) };
}
