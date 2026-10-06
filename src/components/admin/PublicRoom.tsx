"use client";

import { useState } from "react";
import type { PublicMessageRow } from "@/lib/admin";
import { apost, Unauthorized, useLoad } from "./api";
import { ago, Chip, Confirm } from "./common";

type Props = { onLost: () => void; onChanged: () => void };

/** Moderation for the public room: remove a message, or block whoever wrote it. Only the admin can see authors. */
export default function PublicRoom({ onLost, onChanged }: Props) {
  const { data, error, reload } = useLoad<{ messages: PublicMessageRow[] }>("/api/admin/public", onLost);
  const [pending, setPending] = useState<{ kind: "block"; m: PublicMessageRow } | null>(null);
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

  return (
    <section className="stack" style={{ gap: 16 }}>
      <p className="muted small">Messages stay for 48 hours. Others see them with no name at all; the author is shown here for moderation only.</p>
      {(error || failure) && <p className="error">{error || failure}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.messages.length === 0 && <p className="muted">No messages in the last 48 hours.</p>}
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
      {data && data.messages.length === 200 && <p className="muted small">Showing the newest 200.</p>}

      <Confirm
        open={pending !== null}
        title={`Block ${pending?.m.username ?? pending?.m.email ?? "this user"}?`}
        confirmLabel="Block"
        busy={busy}
        onConfirm={() => pending && act({ action: "block", userId: pending.m.userId })}
        onCancel={() => setPending(null)}
      >
        <p>They are signed out everywhere and can&rsquo;t sign in again until you unblock them. Their messages stay until you delete them.</p>
      </Confirm>
    </section>
  );
}
