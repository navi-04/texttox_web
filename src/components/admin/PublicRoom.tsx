"use client";

import { useState } from "react";
import type { PublicMessageRow } from "@/lib/admin";
import { apost, Unauthorized, useLoad } from "./api";
import { ago, Chip, Confirm } from "./common";

type Props = { onLost: () => void; onChanged: () => void };

type Pending = { kind: "block"; m: PublicMessageRow } | { kind: "all" } | { kind: "ttl"; hours: number } | null;

/** Moderation for the public room: remove a message, block whoever wrote it, or clear the whole room. Only the admin can see authors. */
export default function PublicRoom({ onLost, onChanged }: Props) {
  const { data, error, reload } = useLoad<{ messages: PublicMessageRow[]; ttlHours: number; options: number[] }>("/api/admin/public", onLost);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setFailure("");
    try {
      await apost("/api/admin/act", body);
      setPending(null);
      onChanged();
      reload();
    } catch (e) {
      if (e instanceof Unauthorized) onLost();
      else setFailure(e instanceof Error ? e.message : "Failed.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const blocking = pending?.kind === "block" ? pending.m : null;
  const ttl = data?.ttlHours ?? 48;
  // Longer is applied straight away; shorter first asks, because it deletes what is now too old.
  const chooseTtl = (hours: number) => (hours === ttl ? undefined : hours > ttl ? void act({ action: "setpublicttl", hours }) : setPending({ kind: "ttl", hours }));

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="muted small">Messages disappear after</span>
        <div className="seg" role="tablist" aria-label="How long public messages stay">
          {(data?.options ?? [12, 24, 36, 48]).map((h) => (
            <button key={h} role="tab" aria-selected={ttl === h} disabled={busy || !data} onClick={() => chooseTtl(h)}>
              {h} h
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="muted small" style={{ flex: "1 1 260px" }}>
          Others see messages with no name at all; the author is shown here for moderation only.
        </p>
        <button className="btn ghost" disabled={busy || !data || data.messages.length === 0} onClick={() => setPending({ kind: "all" })}>
          Delete all
        </button>
      </div>
      {(error || failure) && <p className="error">{error || failure}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.messages.length === 0 && <p className="muted">No messages in the last {ttl} hours.</p>}
      <div className="a-list">
        {data?.messages.map((m) => (
          <div key={m.id} className="a-item" style={{ cursor: "default" }}>
            <span className="a-item-main">
              <strong style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</strong>
              <span className="muted small">
                {m.username ?? m.email} · {ago(m.at)}
              </span>
            </span>
            <span className="a-chips">
              {m.blocked && <Chip strong>Blocked</Chip>}
              <button className="link" disabled={busy} onClick={() => act({ action: "deletepublic", messageId: m.id })}>
                Delete
              </button>
              {!m.blocked && (
                <button className="link" disabled={busy} onClick={() => setPending({ kind: "block", m })}>
                  Block author
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {data && data.messages.length === 200 && <p className="muted small">Showing the newest 200. &ldquo;Delete all&rdquo; removes every message, not just these.</p>}

      <Confirm
        open={blocking !== null}
        title={`Block ${blocking?.username ?? blocking?.email ?? "this user"}?`}
        confirmLabel="Block"
        busy={busy}
        onConfirm={() => blocking && act({ action: "block", userId: blocking.userId })}
        onCancel={() => setPending(null)}
      >
        <p>They are signed out everywhere and can&rsquo;t sign in again until you unblock them. Their messages stay until you delete them.</p>
      </Confirm>

      <Confirm
        open={pending?.kind === "ttl"}
        title={`Keep messages for ${pending?.kind === "ttl" ? pending.hours : ""} hours?`}
        confirmLabel="Shorten and delete old messages"
        busy={busy}
        onConfirm={() => pending?.kind === "ttl" && act({ action: "setpublicttl", hours: pending.hours })}
        onCancel={() => setPending(null)}
      >
        <p>
          Every message older than that is deleted right now, and cannot come back even if you make the time longer again. New messages will disappear after the
          shorter time.
        </p>
      </Confirm>

      <Confirm
        open={pending?.kind === "all"}
        title="Delete every public message?"
        confirmLabel="Delete all messages"
        requireText="DELETE"
        busy={busy}
        onConfirm={() => act({ action: "deleteallpublic", confirm: "DELETE" })}
        onCancel={() => setPending(null)}
      >
        <p>
          The whole public room is emptied for good: every message from everyone, including ones older than what is listed here. Accounts are not touched.
          People who have the room open keep seeing what was already on their screen until they leave and come back.
        </p>
      </Confirm>
    </section>
  );
}
