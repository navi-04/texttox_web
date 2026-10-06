"use client";

import { useState } from "react";
import type { ReportDetail, ReportRow } from "@/lib/admin";
import { apost, Unauthorized, useLoad } from "./api";
import { ago, Chip, clock, Confirm, DeleteUserDialog, shortName, UserChips, when } from "./common";
import type { View } from "./AdminApp";

type Props = { id?: number; go: (v: View) => void; onLost: () => void; onChanged: () => void };

const STATUS: Record<string, string> = { open: "Open", dismissed: "Dismissed", actioned: "Action taken" };

export default function Reports({ id, go, onLost, onChanged }: Props) {
  return id ? <Detail id={id} go={go} onLost={onLost} onChanged={onChanged} /> : <List go={go} onLost={onLost} />;
}

function List({ go, onLost }: Pick<Props, "go" | "onLost">) {
  const [closed, setClosed] = useState(false);
  const { data, error } = useLoad<{ reports: ReportRow[] }>(`/api/admin/reports?status=${closed ? "closed" : "open"}`, onLost);

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={!closed} onClick={() => setClosed(false)}>
          Open
        </button>
        <button role="tab" aria-selected={closed} onClick={() => setClosed(true)}>
          Closed
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.reports.length === 0 && <p className="muted">{closed ? "No closed reports." : "No open reports. Nothing needs your attention."}</p>}
      <div className="a-list">
        {data?.reports.map((r) => (
          <button key={r.id} className="a-item" onClick={() => go({ tab: "reports", id: r.id })}>
            <span className="a-item-main">
              <strong>
                #{r.id} · {r.reason || "No reason given"}
              </strong>
              <span className="muted small">
                {shortName(r.reporter)} reported {shortName(r.reported)} · {ago(r.at)}
              </span>
            </span>
            <span className="a-chips">
              {r.status !== "open" && <Chip>{STATUS[r.status]}</Chip>}
              {r.reported.blocked && <Chip strong>Blocked</Chip>}
              {r.timesReported > 1 && <Chip>{r.timesReported}× reported</Chip>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

type Pending = "block" | "unblock" | "dismiss" | "deletechat" | "deleteuser" | null;

function Detail({ id, go, onLost, onChanged }: { id: number } & Pick<Props, "go" | "onLost" | "onChanged">) {
  const { data: r, error: loadError, reload } = useLoad<ReportDetail>(`/api/admin/reports?id=${id}`, onLost);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(body: Record<string, unknown>, after: "stay" | "list") {
    setBusy(true);
    setError("");
    try {
      await apost("/api/admin/act", body);
      setPending(null);
      onChanged();
      if (after === "list") go({ tab: "reports" });
      else reload();
    } catch (e) {
      if (e instanceof Unauthorized) onLost();
      else setError(e instanceof Error ? e.message : "Failed.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <button className="link" onClick={() => go({ tab: "reports" })}>
      ← All reports
    </button>
  );
  if (loadError) {
    return (
      <section className="stack">
        {back}
        <p className="error">{loadError}</p>
      </section>
    );
  }
  if (!r) {
    return (
      <section className="stack">
        {back}
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const reportedName = shortName(r.reported);

  return (
    <section className="stack" style={{ gap: 20 }}>
      {back}
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="a-title">
          Report #{r.id} <Chip strong={r.status === "open"}>{STATUS[r.status]}</Chip>
        </h1>
        <p>{r.reason || <span className="muted">No reason given.</span>}</p>
        <p className="muted small">Sent {when(r.at)}</p>
      </div>

      <div className="a-two">
        {(
          [
            ["Reporter", r.reporterInfo],
            ["Reported", r.reportedInfo],
          ] as const
        ).map(([label, u]) => (
          <div key={label} className="a-card">
            <span className="muted small">{label}</span>
            <button className="link a-name" onClick={() => go({ tab: "users", id: u.id })}>
              {u.username ? `${u.username} · ${u.email}` : u.email}
            </button>
            <span className="muted small">
              {u.gender ?? "gender not set"} · joined {when(u.createdAt)}
            </span>
            <span className="a-chips">
              <UserChips u={u} />
            </span>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="a-actions">
        {r.reported.blocked ? (
          <button className="btn ghost" disabled={busy} onClick={() => setPending("unblock")}>
            Unblock {reportedName}
          </button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => setPending("block")}>
            Block {reportedName}
          </button>
        )}
        {r.status === "open" && (
          <button className="btn ghost" disabled={busy} onClick={() => setPending("dismiss")}>
            Dismiss report
          </button>
        )}
        {r.chat && (
          <button className="btn ghost" disabled={busy} onClick={() => setPending("deletechat")}>
            Delete conversation
          </button>
        )}
        <button className="btn ghost" disabled={busy} onClick={() => setPending("deleteuser")}>
          Delete {reportedName}…
        </button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h2 className="a-sub">
          Conversation{" "}
          {r.chat && <span className="muted small">{r.chat.status === "active" ? "· still going" : "· ended"}</span>}
        </h2>
        {!r.chat || r.timeline.length === 0 ? (
          <p className="muted">The conversation is no longer stored.</p>
        ) : (
          <div className="a-timeline">
            {r.timeline.map((m) =>
              m.kind === "info" ? (
                <p key={m.id} className="info">
                  {m.text} · {clock(m.at)}
                </p>
              ) : (
                <div key={m.id} className={`bubble ${m.who === "reporter" ? "mine" : "theirs"}`}>
                  <span className="bubble-label">{m.who === "reporter" ? "Reporter" : "Reported"}</span>
                  {m.text}
                  <time>{clock(m.at)}</time>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <Confirm
        open={pending === "block"}
        title={`Block ${r.reported.email}?`}
        confirmLabel="Block"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "block", userId: r.reported.id, reportId: r.id }, "stay")}
      >
        They are signed out everywhere, their current chat ends, and they can&rsquo;t log in again until you unblock them. This report is marked &ldquo;action taken&rdquo;.
      </Confirm>
      <Confirm
        open={pending === "unblock"}
        title={`Unblock ${r.reported.email}?`}
        confirmLabel="Unblock"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "unblock", userId: r.reported.id }, "stay")}
      >
        They will be able to log in again.
      </Confirm>
      <Confirm
        open={pending === "dismiss"}
        title="Dismiss this report?"
        confirmLabel="Dismiss"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "dismiss", reportId: r.id }, "list")}
      >
        The report is closed with no action. If both people have already left the chat, the saved conversation is deleted.
      </Confirm>
      <Confirm
        open={pending === "deletechat"}
        title="Delete this conversation?"
        confirmLabel="Delete conversation"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "deletechat", chatId: r.chatId }, "list")}
      >
        The messages and every report about this conversation are deleted for good. Anyone still inside it goes back to the home screen.
      </Confirm>
      <DeleteUserDialog
        email={pending === "deleteuser" ? r.reported.email : null}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "deleteuser", userId: r.reported.id, confirm: "DELETE" }, "list")}
      />
    </section>
  );
}
