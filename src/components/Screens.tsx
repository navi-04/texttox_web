"use client";

import { useEffect, useState } from "react";
import { messageOf, post } from "@/lib/client";

type Gender = "boy" | "girl";
export type Want = Gender | "any";

/** "12 online": signed-in people with the site open. Hidden until there is someone to count. */
function OnlineCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/online");
        if (res.ok && alive) setN((await res.json()).online ?? 0);
      } catch {
        /* keep the last number */
      }
    };
    void load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return n > 0 ? <span className="online">{n} online</span> : null;
}

/** The wordmark: "Text to X", with the X in the accent colour. */
export function Brand() {
  return (
    <p className="brand">
      Text to <span className="brand-x">X</span>
    </p>
  );
}

/** Brand name on the left, live online count on the right. */
export function TopLine() {
  return (
    <div className="topline">
      <Brand />
      <OnlineCount />
    </div>
  );
}

/** Who am I? Only the specific chat needs it, so it is asked the first time someone picks that chat. */
function GenderPick({ onDone }: { onDone: () => void }) {
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!gender) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/profile", { gender });
      onDone();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <h1>One quick thing</h1>
        <p className="muted">I am a&hellip; This is only used to match you with the right person in a specific chat, and it can&rsquo;t be changed later.</p>
      </div>
      <div className="row">
        {(["boy", "girl"] as const).map((g) => (
          <button key={g} className="choice" aria-pressed={gender === g} onClick={() => setGender(g)}>
            {g === "boy" ? "Boy" : "Girl"}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" disabled={!gender || busy} onClick={save}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </>
  );
}

type HomeProps = {
  handle: string;
  gender: Gender | null;
  onStart: (want: Want) => Promise<void>;
  onPublic: () => void;
  onGenderSaved: () => void;
  onLogout: () => void;
};

export function Home({ handle, gender, onStart, onPublic, onGenderSaved, onLogout }: HomeProps) {
  const [section, setSection] = useState<"menu" | "specific">("menu");
  const [busy, setBusy] = useState<Want | null>(null);
  const [error, setError] = useState("");

  async function start(want: Want) {
    setBusy(want);
    setError("");
    try {
      await onStart(want);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const errorBox = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  let body: React.ReactNode;
  if (section === "specific" && !gender) {
    body = (
      <>
        <GenderPick onDone={onGenderSaved} />
        <button className="link" onClick={() => setSection("menu")}>
          &larr; Back
        </button>
      </>
    );
  } else if (section === "specific") {
    body = (
      <>
        <div className="stack" style={{ gap: 8 }}>
          <h1>Who do you want to chat with?</h1>
          <p className="muted">You&rsquo;ll be paired with someone who&rsquo;s online right now and wants to talk to someone like you.</p>
        </div>
        <div className="row">
          <button className="choice" disabled={busy !== null} onClick={() => start("boy")}>
            A boy
          </button>
          <button className="choice" disabled={busy !== null} onClick={() => start("girl")}>
            A girl
          </button>
        </div>
        {errorBox}
        <button className="link" onClick={() => setSection("menu")}>
          &larr; Back
        </button>
      </>
    );
  } else {
    body = (
      <>
        <div className="stack" style={{ gap: 8 }}>
          <h1>How do you want to chat?</h1>
          <p className="muted">Whichever you pick, nobody will know who you are unless you choose to show your username.</p>
        </div>
        <div className="stack">
          <button className="mode" disabled={busy !== null} onClick={() => setSection("specific")}>
            <strong>Specific chat</strong>
            <span className="muted small">Choose to talk to a boy or a girl. One-to-one and private.</span>
          </button>
          <button className="mode" disabled={busy !== null} onClick={() => start("any")}>
            <strong>Random chat</strong>
            <span className="muted small">Get paired with anyone else who picked this. Boy or girl, no filter.</span>
          </button>
          <button className="mode" disabled={busy !== null} onClick={onPublic}>
            <strong>Public room</strong>
            <span className="muted small">Everyone in one anonymous group chat. Messages vanish after 48 hours.</span>
          </button>
        </div>
        {errorBox}
        <p className="muted small">
          Private chats aren&rsquo;t saved &mdash; they&rsquo;re deleted once both of you leave. Be kind; you can report anyone who isn&rsquo;t.
        </p>
      </>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <TopLine />
        {body}
        <div className="footer muted small">
          <span>Signed in as {handle}</span>
          <button className="link" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </main>
  );
}

export function Searching({ want, onCancel }: { want: Want | null; onCancel: () => void }) {
  const who = want === "girl" ? "a girl" : want === "boy" ? "a boy" : "someone";
  return (
    <main className="page">
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="spinner" role="status" aria-label="Searching" />
        <div className="stack" style={{ gap: 8 }}>
          <h1>Looking for {who}…</h1>
          <p className="muted">This can take a moment if not many people are online. Keep this page open.</p>
        </div>
        <button className="btn ghost" onClick={onCancel} style={{ minWidth: 140 }}>
          Cancel
        </button>
      </div>
    </main>
  );
}
