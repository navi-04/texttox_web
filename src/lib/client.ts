/** Small fetch helpers for the browser side. */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiFailure(0, "No connection. Check your internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(res.status, typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
  return data as T;
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
