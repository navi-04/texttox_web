"use client";

import { useEffect, useState } from "react";
import { messageOf, post } from "@/lib/client";
import { TopLine } from "./Screens";

/** signin = username or email + password. signup and reset both go: email -> emailed code -> choose a password (signup also a username). */
type Mode = "signin" | "signup" | "reset";
type Step = "email" | "code" | "password";

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

  const idField = (
    <input
      className="field"
      type={mode === "signin" ? "text" : "email"}
      inputMode={mode === "signin" ? "text" : "email"}
      autoComplete="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      placeholder={mode === "signin" ? "Username or email" : "you@example.com"}
      aria-label={mode === "signin" ? "Username or email" : "Email"}
      value={id}
      onChange={(e) => setId(e.target.value)}
      autoFocus
    />
  );
  const errorBox = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  let body: React.ReactNode;

  if (mode === "signin") {
    body = (
      <form className="stack" onSubmit={signIn} noValidate style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1>Talk to anyone, anonymously.</h1>
          <p className="muted">Sign in with your username or email, and your password.</p>
        </div>
        {idField}
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {errorBox}
        <button className="btn" disabled={busy || !id.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="footer">
          <button type="button" className="link" onClick={() => go("reset")}>
            Forgot password?
          </button>
          <button type="button" className="link" onClick={() => go("signup")}>
            Create account
          </button>
        </div>
      </form>
    );
  } else if (step === "email") {
    body = (
      <form className="stack" onSubmit={sendCode} noValidate style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1>{mode === "signup" ? "Create your account" : "Reset your password"}</h1>
          <p className="muted">
            {mode === "signup"
              ? "Enter your email. We'll send you a code, just this once, so you can pick a username and a password."
              : "Enter your email and we'll send you a code so you can choose a new password."}
          </p>
        </div>
        {idField}
        {errorBox}
        <button className="btn" disabled={busy || !id.trim()}>
          {busy ? "Sending…" : "Send code"}
        </button>
        <div className="footer">
          <button type="button" className="link" onClick={() => go("signin")}>
            Back to sign in
          </button>
        </div>
      </form>
    );
  } else if (step === "code") {
    body = (
      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1>Check your email</h1>
          <p className="muted">
            If <strong style={{ color: "var(--fg)" }}>{email()}</strong> can be used here, a 6-digit code is on its way. It may take a minute; check spam too.
          </p>
        </div>
        <input
          className="field code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="······"
          aria-label="6-digit code"
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) verify(v);
          }}
          autoFocus
        />
        {errorBox}
        <button className="btn" disabled={busy || code.length !== 6} onClick={() => verify(code)}>
          {busy ? "Checking…" : "Continue"}
        </button>
        <div className="footer">
          <button className="link" onClick={() => { setStep("email"); setError(""); }}>
            Use a different email
          </button>
          <button className="link" disabled={wait > 0 || busy} onClick={() => sendCode()}>
            {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
          </button>
        </div>
        <p className="muted small">
          {mode === "signup" ? "Already have an account? " : "No account yet? "}
          <button className="link" onClick={() => go(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Sign in instead" : "Create one"}
          </button>
        </p>
      </div>
    );
  } else {
    body = (
      <form className="stack" onSubmit={savePassword} noValidate style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1>{mode === "signup" ? "Pick a username and password" : "Choose a new password"}</h1>
          <p className="muted">
            {mode === "signup"
              ? "Your username is how you sign in, and what you can choose to show in a chat. It can’t be changed later."
              : "Use something you haven’t used anywhere else."}
          </p>
        </div>
        {mode === "signup" && (
          <input
            className="field"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            placeholder="Username (letters, numbers, _)"
            aria-label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        )}
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="Password (at least 8 characters)"
          aria-label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={mode !== "signup"}
        />
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat password"
          aria-label="Repeat password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        {errorBox}
        <button className="btn" disabled={busy || !password || !repeat || (mode === "signup" && !username.trim())}>
          {busy ? "Saving…" : mode === "signup" ? "Create account" : "Save password"}
        </button>
        {mode === "reset" && <p className="muted small">This signs you out on any other device.</p>}
      </form>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <TopLine />
        {body}
      </div>
    </main>
  );
}
