"use client";

import { useEffect, useState } from "react";
import { messageOf, post } from "@/lib/client";
import { Logo } from "./Icons";

/** signin = username or email + password. signup and reset both go: email -> emailed code -> choose a password (signup also a username). */
type Mode = "signin" | "signup" | "reset";
type Step = "email" | "code" | "password";

const STEP_NO: Record<Step, number> = { email: 1, code: 2, password: 3 };

function Steps({ step }: { step: Step }) {
  return (
    <div className="x-steps" role="img" aria-label={`Step ${STEP_NO[step]} of 3`}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= STEP_NO[step] ? "on" : ""} />
      ))}
    </div>
  );
}

export default function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>("email");
  const [id, setId] = useState(""); // sign-in: a username or an email. sign-up / reset: an email
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const email = () => id.trim().toLowerCase();

  function go(next: Mode) {
    setMode(next);
    setStep("email");
    setError("");
    setPassword("");
    setRepeat("");
    setCode("");
    setTicket("");
    if (next === "signin") setUsername("");
  }

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !id.trim() || !password) return;
    void attempt(async () => {
      const res = await post<{ admin?: boolean }>("/api/auth/login", { identifier: id.trim(), password });
      if (res.admin) window.location.assign("/admin"); // the admin signs in here too
      else onDone();
    });
  };

  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !id.trim()) return;
    void attempt(async () => {
      await post("/api/auth/request", { email: email(), purpose: mode });
      setStep("code");
      setCode("");
      setWait(60);
    });
  };

  const verify = (value: string) => {
    if (busy) return;
    void attempt(async () => {
      try {
        const res = await post<{ ticket: string }>("/api/auth/verify", { email: email(), code: value });
        setTicket(res.ticket);
        setStep("password");
      } catch (e) {
        setCode("");
        throw e;
      }
    });
  };

  const savePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "signup" && !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) return setError("Choose a username of 3 to 20 letters, numbers or underscores.");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== repeat) return setError("The two passwords don't match.");
    void attempt(async () => {
      await post("/api/auth/password", { email: email(), ticket, password, username: mode === "signup" ? username.trim() : undefined });
      onDone();
    });
  };

  const errorBox = error && (
    <p className="x-error" role="alert">
      {error}
    </p>
  );

  let body: React.ReactNode;

  if (mode === "signin") {
    body = (
      <form className="x-form" onSubmit={signIn} noValidate>
        <h1 className="x-h">Sign in</h1>
        <label className="x-lab">
          <span>Username or email</span>
          <input
            className="x-input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="x-lab">
          <span>Password</span>
          <input
            className="x-input"
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {errorBox}
        <button className="x-btn" disabled={busy || !id.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="x-links">
          <button type="button" className="x-link" onClick={() => go("reset")}>
            Forgot password?
          </button>
          <button type="button" className="x-link strong" onClick={() => go("signup")}>
            Create account
          </button>
        </div>
      </form>
    );
  } else if (step === "email") {
    body = (
      <form className="x-form" onSubmit={sendCode} noValidate>
        <Steps step="email" />
        <div className="x-stack" style={{ gap: 6 }}>
          <h1 className="x-h">{mode === "signup" ? "Create account" : "Reset password"}</h1>
          <p className="x-sub">
            {mode === "signup"
              ? "Enter your email. We'll send a code, just this once, so you can pick a username and a password."
              : "Enter your email and we'll send a code so you can choose a new password."}
          </p>
        </div>
        <label className="x-lab">
          <span>Email</span>
          <input
            className="x-input"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="you@example.com"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        {errorBox}
        <button className="x-btn" disabled={busy || !id.trim()}>
          {busy ? "Sending…" : "Send code"}
        </button>
        <div className="x-links center">
          <button type="button" className="x-link" onClick={() => go("signin")}>
            Back to sign in
          </button>
        </div>
      </form>
    );
  } else if (step === "code") {
    body = (
      <div className="x-form">
        <Steps step="code" />
        <div className="x-stack" style={{ gap: 6 }}>
          <h1 className="x-h">Check your email</h1>
          <p className="x-sub">
            If <strong style={{ color: "var(--fg)" }}>{email()}</strong> can be used here, a 6-digit code is on its way. It may take a minute; check spam too.
          </p>
        </div>
        <input
          className="x-input x-code"
          aria-label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="······"
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) verify(v);
          }}
        />
        {errorBox}
        <button className="x-btn" disabled={busy || code.length !== 6} onClick={() => verify(code)}>
          {busy ? "Checking…" : "Continue"}
        </button>
        <div className="x-links">
          <button
            className="x-link"
            onClick={() => {
              setStep("email");
              setError("");
            }}
          >
            Different email
          </button>
          <button className="x-link strong" disabled={wait > 0 || busy} onClick={() => sendCode()}>
            {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <form className="x-form" onSubmit={savePassword} noValidate>
        <Steps step="password" />
        <div className="x-stack" style={{ gap: 6 }}>
          <h1 className="x-h">{mode === "signup" ? "Username & password" : "New password"}</h1>
          <p className="x-sub">
            {mode === "signup"
              ? "Your username is how you sign in, and what you can choose to show in a chat. It can’t be changed later."
              : "Use something you haven’t used anywhere else."}
          </p>
        </div>
        {mode === "signup" && (
          <label className="x-lab">
            <span>Username</span>
            <input
              className="x-input"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              placeholder="letters, numbers, _"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        )}
        <label className="x-lab">
          <span>Password</span>
          <input
            className="x-input"
            type="password"
            autoComplete="new-password"
            placeholder="at least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="x-lab">
          <span>Repeat password</span>
          <input className="x-input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {errorBox}
        <button className="x-btn" disabled={busy || !password || !repeat || (mode === "signup" && !username.trim())}>
          {busy ? "Saving…" : mode === "signup" ? "Create account" : "Save password"}
        </button>
        {mode === "reset" && <p className="x-small" style={{ textAlign: "center" }}>This signs you out on any other device.</p>}
      </form>
    );
  }

  return (
    <main className="x-screen">
      <div className="x-hero">
        <Logo size={mode === "signin" || step === "email" ? 76 : 56} />
        <h2 className="x-title">Text to X</h2>
        <p className="x-tagline">Anonymous chat. One to one, random, or everyone.</p>
      </div>
      {body}
    </main>
  );
}
