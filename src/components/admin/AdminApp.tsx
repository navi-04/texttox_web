"use client";

import { useCallback, useEffect, useState } from "react";
import type { Overview } from "@/lib/admin";
import { aget, apost, Unauthorized } from "./api";
import { ago } from "./common";
import PublicRoom from "./PublicRoom";
import Reports from "./Reports";
import Users from "./Users";

export type View = { tab: "overview" } | { tab: "reports"; id?: number } | { tab: "users"; id?: number } | { tab: "public" };

const hashFor = (v: View) => (v.tab === "overview" ? "" : "id" in v && v.id ? `#${v.tab === "reports" ? "report" : "user"}=${v.id}` : `#${v.tab}`);

function viewFromHash(hash: string): View {
  const m = /^#(report|user)=(\d+)$/.exec(hash);
  if (m) return { tab: m[1] === "report" ? "reports" : "users", id: Number(m[2]) };
  if (hash === "#reports") return { tab: "reports" };
  if (hash === "#users") return { tab: "users" };
  if (hash === "#public") return { tab: "public" };
  return { tab: "overview" };
}

export default function AdminApp() {
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking");
  const [stats, setStats] = useState<Overview | null>(null);
  const [view, setView] = useState<View>({ tab: "overview" });

  const lost = useCallback(() => setAuth("out"), []);

  const refresh = useCallback(async () => {
    try {
      setStats(await aget<Overview>("/api/admin/overview"));
      setAuth("in");
    } catch (e) {
      if (e instanceof Unauthorized) setAuth("out");
      else setAuth((a) => (a === "checking" ? "out" : a)); // a network hiccup after sign-in shouldn't log anyone out
    }
  }, []);

  useEffect(() => {
    setView(viewFromHash(window.location.hash)); // e.g. the link in the report email: /admin#report=12
    void refresh();
  }, [refresh]);

  // Following a #report=12 link while already on this page (replaceState below does not trigger this).
  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (auth !== "in") return;
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [auth, refresh]);

  const go = useCallback((v: View) => {
    setView(v);
    window.history.replaceState(null, "", window.location.pathname + hashFor(v));
    window.scrollTo(0, 0);
  }, []);

  async function logout() {
    await apost("/api/admin/logout").catch(() => {});
    setStats(null);
    setAuth("out");
  }

  if (auth === "checking") {
    return (
      <main className="page">
        <div className="spinner" role="status" aria-label="Loading" />
      </main>
    );
  }
  if (auth === "out") return <Login onDone={refresh} />;

  const tabs = [
    ["overview", "Overview"],
    ["reports", stats && stats.openReports > 0 ? `Reports (${stats.openReports})` : "Reports"],
    ["users", "Users"],
    ["public", "Public room"],
  ] as const;

  return (
    <div className="a-wrap">
      <header className="a-head">
        <strong>Text to X · Admin</strong>
        <nav aria-label="Sections">
          {tabs.map(([tab, label]) => (
            <button key={tab} aria-current={view.tab === tab ? "page" : undefined} onClick={() => go({ tab })}>
              {label}
            </button>
          ))}
        </nav>
        <button className="link" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="a-main">
        {view.tab === "overview" && stats && <OverviewPanel s={stats} go={go} />}
        {view.tab === "reports" && <Reports id={view.id} go={go} onLost={lost} onChanged={refresh} />}
        {view.tab === "public" && <PublicRoom onLost={lost} onChanged={refresh} />}
        {view.tab === "users" && <Users id={view.id} go={go} onLost={lost} onChanged={refresh} />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apost("/api/admin/login", { username, password });
      onDone();
    } catch (err) {
      // a 401 from the login endpoint means wrong credentials (everywhere else it means the session expired)
      setError(err instanceof Unauthorized ? "Wrong username or password." : err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <form className="card" onSubmit={submit}>
        <p className="brand">Text to X</p>
        <h1>Admin sign-in</h1>
        <input
          className="field"
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          className="field"
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function OverviewPanel({ s, go }: { s: Overview; go: (v: View) => void }) {
  const tiles: [string, number, View | null][] = [
    ["Open reports", s.openReports, { tab: "reports" }],
    ["Online now", s.online, null],
    ["Searching now", s.searching, null],
    ["Active chats", s.activeChats, null],
    ["Users", s.users, { tab: "users" }],
    ["New in 24 h", s.newToday, null],
    ["Blocked", s.blocked, { tab: "users" }],
  ];
  return (
    <section className="stack" style={{ gap: 24 }}>
      <div className="a-stats">
        {tiles.map(([label, value, target]) => {
          const inner = (
            <>
              <span className="a-num">{value}</span>
              <span className="muted small">{label}</span>
            </>
          );
          return target ? (
            <button key={label} className="a-tile" onClick={() => go(target)}>
              {inner}
            </button>
          ) : (
            <div key={label} className="a-tile">
              {inner}
            </div>
          );
        })}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <h2 className="a-sub">Recent admin activity</h2>
        {s.activity.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="a-log">
            {s.activity.map((a) => (
              <li key={a.id}>
                <span>
                  {a.action} <span className="muted">{a.detail}</span>
                </span>
                <span className="muted small">{ago(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
