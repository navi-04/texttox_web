"use client";

import { useEffect, useState } from "react";
import type { ReportRow, UserDetail, UserRow } from "@/lib/admin";
import { apost, Unauthorized, useLoad } from "./api";
import { ago, Chip, Confirm, DeleteUserDialog, shortName, UserChips, when } from "./common";
import type { View } from "./AdminApp";

type Props = { id?: number; go: (v: View) => void; onLost: () => void; onChanged: () => void };

const FILTERS = [
  ["all", "Everyone"],
  ["online", "Online"],
  ["blocked", "Blocked"],
  ["reported", "Reported"],
  ["unset", "Gender not set"],
] as const;

export default function Users({ id, go, onLost, onChanged }: Props) {
  return id ? <Detail id={id} go={go} onLost={onLost} onChanged={onChanged} /> : <List go={go} onLost={onLost} />;
}

function List({ go, onLost }: Pick<Props, "go" | "onLost">) {
  const [text, setText] = useState("");
  const [q, setQ] = useState(""); // what we actually search for, a moment after typing stops
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { data, error } = useLoad<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}&filter=${filter}`, onLost);

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div className="a-search">
        <input
          className="field"
          type="search"
          placeholder="Search by username or email"
          aria-label="Search users"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select className="field" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          {FILTERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.users.length === 0 && <p className="muted">No users match.</p>}
      <div className="a-list">
        {data?.users.map((u) => (
          <button key={u.id} className="a-item" onClick={() => go({ tab: "users", id: u.id })}>
            <span className="a-item-main">
              <strong>{u.username ?? u.email}</strong>
              <span className="muted small">
                {u.username ? `${u.email} · ` : ""}{u.gender ?? "gender not set"} · last seen {u.lastSeen ? ago(u.lastSeen) : "never"}
              </span>
            </span>
            <span className="a-chips">
              <UserChips u={u} />
            </span>
          </button>
        ))}
      </div>
      {data && data.users.length === 50 && <p className="muted small">Showing the first 50. Search to narrow it down.</p>}
    </section>
  );
}

type Pending = "block" | "unblock" | "signout" | "endchat" | "gender" | "delete" | null;
type GenderChoice = "boy" | "girl" | "none";

function Detail({ id, go, onLost, onChanged }: { id: number } & Pick<Props, "go" | "onLost" | "onChanged">) {
  const { data: u, error: loadError, reload } = useLoad<UserDetail>(`/api/admin/users?id=${id}`, onLost);
  const [pending, setPending] = useState<Pending>(null);
  const [choice, setChoice] = useState<GenderChoice>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(body: Record<string, unknown>, after: "stay" | "list") {
    setBusy(true);
    setError("");
    try {
      await apost("/api/admin/act", body);
      setPending(null);
      onChanged();
      if (after === "list") go({ tab: "users" });
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
    <button className="link" onClick={() => go({ tab: "users" })}>
      ← All users
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
  if (!u) {
    return (
      <section className="stack">
        {back}
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const reportLine = (r: ReportRow, other: "reporter" | "reported") => (
    <button key={r.id} className="a-item" onClick={() => go({ tab: "reports", id: r.id })}>
      <span className="a-item-main">
        <strong>
          #{r.id} · {r.reason || "No reason given"}
        </strong>
        <span className="muted small">
          {other === "reporter" ? `by ${shortName(r.reporter)}` : `about ${shortName(r.reported)}`} · {ago(r.at)}
        </span>
      </span>
      <span className="a-chips">
        <Chip strong={r.status === "open"}>{r.status === "open" ? "Open" : r.status === "dismissed" ? "Dismissed" : "Action taken"}</Chip>
      </span>
    </button>
  );

  return (
    <section className="stack" style={{ gap: 20 }}>
      {back}
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="a-title">{u.username ? `${u.username} · ${u.email}` : u.email}</h1>
        <span className="a-chips">
          <UserChips u={u} />
        </span>
      </div>

      <dl className="a-facts">
        <div>
          <dt>Gender</dt>
          <dd>{u.gender ?? "not set"}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{when(u.createdAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{u.lastSeen ? `${ago(u.lastSeen)} (${when(u.lastSeen)})` : "never"}</dd>
        </div>
        <div>
          <dt>Chats so far</dt>
          <dd>{u.chatsCount}</dd>
        </div>
      </dl>

      {error && <p className="error">{error}</p>}
      <div className="a-actions">
        {u.blocked ? (
          <button className="btn" disabled={busy} onClick={() => setPending("unblock")}>
            Unblock
          </button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => setPending("block")}>
            Block
          </button>
        )}
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => {
            setChoice(u.gender ?? "none");
            setPending("gender");
          }}
        >
          {u.gender ? "Change gender…" : "Set gender…"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => setPending("signout")}>
          Sign out everywhere
        </button>
        {u.inChat && (
          <button className="btn ghost" disabled={busy} onClick={() => setPending("endchat")}>
            End their chat
          </button>
        )}
        <button className="btn ghost" disabled={busy} onClick={() => setPending("delete")}>
          Delete user…
        </button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h2 className="a-sub">Reports about them ({u.reportsAgainstList.length})</h2>
        {u.reportsAgainstList.length === 0 ? <p className="muted">None.</p> : <div className="a-list">{u.reportsAgainstList.map((r) => reportLine(r, "reporter"))}</div>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <h2 className="a-sub">Reports they made ({u.reportsByList.length})</h2>
        {u.reportsByList.length === 0 ? <p className="muted">None.</p> : <div className="a-list">{u.reportsByList.map((r) => reportLine(r, "reported"))}</div>}
      </div>

      <Confirm
        open={pending === "block"}
        title={`Block ${u.email}?`}
        confirmLabel="Block"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "block", userId: u.id }, "stay")}
      >
        They are signed out everywhere, their current chat ends, and they can&rsquo;t log in again until you unblock them.
      </Confirm>
      <Confirm
        open={pending === "unblock"}
        title={`Unblock ${u.email}?`}
        confirmLabel="Unblock"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "unblock", userId: u.id }, "stay")}
      >
        They will be able to log in again.
      </Confirm>
      <Confirm
        open={pending === "signout"}
        title="Sign out everywhere?"
        confirmLabel="Sign out"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "signout", userId: u.id }, "stay")}
      >
        Every device they are signed in on is logged out. They can sign in again with their password.
      </Confirm>
      <Confirm
        open={pending === "gender"}
        title={u.gender ? "Change gender?" : "Set gender?"}
        confirmLabel="Save"
        busy={busy}
        disabled={choice === (u.gender ?? "none")}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "setgender", userId: u.id, gender: choice === "none" ? null : choice }, "stay")}
      >
        <p>
          Matching depends on this. <strong style={{ color: "var(--fg)" }}>Not set</strong> makes them choose again the next time they open the site.
          {u.gender && " Changing it ends their current chat and search."}
        </p>
        <select className="field" aria-label="Gender" style={{ marginTop: 12 }} value={choice} onChange={(e) => setChoice(e.target.value as GenderChoice)}>
          <option value="boy">Boy</option>
          <option value="girl">Girl</option>
          <option value="none">Not set (let them choose)</option>
        </select>
      </Confirm>
      <Confirm
        open={pending === "endchat"}
        title="End their chat?"
        confirmLabel="End chat"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "endchat", userId: u.id }, "stay")}
      >
        The chat ends for both people. Nobody&rsquo;s messages are shown to you.
      </Confirm>
      <DeleteUserDialog
        email={pending === "delete" ? u.email : null}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => act({ action: "deleteuser", userId: u.id, confirm: "DELETE" }, "list")}
      />
    </section>
  );
}
