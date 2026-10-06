"use client";

import { useEffect, useState } from "react";
import { messageOf, post } from "@/lib/client";
import { Back, Chevron, Group, Lock, Logo, Person, Shuffle } from "./Icons";

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
  return n > 0 ? <span className="x-pill">{n} online</span> : <span />;
}

/** Top bar: the app mark and name on the left, who is online on the right. */
export function TopBar() {
  return (
    <header className="x-bar">
      <div className="x-brand">
        <Logo size={34} />
        <span>Text to X</span>
      </div>
      <OnlineCount />
    </header>
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
      <div className="x-stack" style={{ gap: 8 }}>
        <h1 className="x-h">I am a&hellip;</h1>
        <p className="x-sub">Only used to match you in a specific chat. It can&rsquo;t be changed later.</p>
      </div>
      <div className="x-picks">
        {(["boy", "girl"] as const).map((g) => (
          <button key={g} className="x-pick" aria-pressed={gender === g} onClick={() => setGender(g)}>
            <span className="x-ico">
              <Person />
            </span>
            {g === "boy" ? "Boy" : "Girl"}
          </button>
        ))}
      </div>
      {error && (
        <p className="x-error" role="alert">
          {error}
        </p>
      )}
      <button className="x-btn" style={{ marginTop: "auto" }} disabled={!gender || busy} onClick={save}>
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
    <p className="x-error" role="alert">
      {error}
    </p>
  );

  if (section === "specific") {
    return (
      <main className="x-screen">
        <header className="x-bar">
          <button className="x-icon-btn" aria-label="Back" onClick={() => setSection("menu")}>
            <Back />
          </button>
          <span className="x-brand">Specific chat</span>
          <span style={{ width: 40 }} />
        </header>
        {!gender ? (
          <GenderPick onDone={onGenderSaved} />
        ) : (
          <>
            <div className="x-stack" style={{ gap: 8 }}>
              <h1 className="x-h">Talk to a&hellip;</h1>
              <p className="x-sub">You&rsquo;ll be paired with someone online right now who wants to talk to someone like you.</p>
            </div>
            <div className="x-picks">
              {(["boy", "girl"] as const).map((g) => (
                <button key={g} className="x-pick" disabled={busy !== null} onClick={() => start(g)}>
                  <span className="x-ico">
                    <Person />
                  </span>
                  {g === "boy" ? "A boy" : "A girl"}
                </button>
              ))}
            </div>
            {errorBox}
          </>
        )}
      </main>
    );
  }

  const cards = [
    { icon: <Lock />, title: "Specific chat", text: "Choose a boy or a girl. Private, one to one.", go: () => setSection("specific") },
    { icon: <Shuffle />, title: "Random chat", text: "Paired with anyone else who picked this.", go: () => start("any") },
    { icon: <Group />, title: "Public room", text: "One anonymous room for everyone. Gone after 48 hours.", go: onPublic },
  ];

  return (
    <main className="x-screen">
      <TopBar />
      <div className="x-greet">
        <p className="x-dim">Hi, @{handle}</p>
        <h1 className="x-h">How do you want to talk?</h1>
      </div>
      <div className="x-cards">
        {cards.map((c) => (
          <button key={c.title} className="x-card" disabled={busy !== null} onClick={c.go}>
            <span className="x-ico">{c.icon}</span>
            <span className="x-card-b">
              <strong>{c.title}</strong>
              <span>{c.text}</span>
            </span>
            <Chevron className="x-chev" />
          </button>
        ))}
      </div>
      {errorBox}
      <p className="x-note">Nobody knows who you are unless you choose to show your username. Private chats aren&rsquo;t saved. Be kind; you can report anyone who isn&rsquo;t.</p>
      <div className="x-foot">
        <span>Signed in as @{handle}</span>
        <button className="x-link" onClick={onLogout}>
          Log out
        </button>
      </div>
    </main>
  );
}

export function Searching({ want, onCancel }: { want: Want | null; onCancel: () => void }) {
  const who = want === "girl" ? "a girl" : want === "boy" ? "a boy" : "someone";
  return (
    <main className="x-screen x-center">
      <div className="x-radar" role="status" aria-label="Searching">
        <i />
        <i />
        <i />
        <Logo size={64} />
      </div>
      <h1 className="x-h">Looking for {who}…</h1>
      <p className="x-sub" style={{ maxWidth: "30ch" }}>
        This can take a moment if not many people are online. Keep this page open.
      </p>
      <button className="x-btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </main>
  );
}
