"use client";

import { useState } from "react";
import { messageOf, post } from "@/lib/client";

export default function DeleteAccountForm() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !id.trim() || !password || !sure) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/account/delete", { identifier: id.trim(), password, confirm: "DELETE" });
      setPassword("");
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="x-form" role="status">
        <h2 style={{ margin: 0 }}>Your account has been deleted</h2>
        <p className="x-sub">
          Your email, username, password, chats, public room messages and reports have been permanently removed. You can close this page. You are welcome to create a
          new account at any time.
        </p>
      </div>
    );
  }

  return (
    <form className="x-form" onSubmit={submit} noValidate>
      <label className="x-lab">
        <span>Username or email</span>
        <input
          className="x-input"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label className="x-lab">
        <span>Password</span>
        <input className="x-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="x-check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        <span>I understand that my account and everything tied to it will be deleted permanently and can&rsquo;t be recovered.</span>
      </label>
      {error && (
        <p className="x-error" role="alert">
          {error}
        </p>
      )}
      <button className="x-btn" disabled={busy || !id.trim() || !password || !sure}>
        {busy ? "Deleting…" : "Delete my account permanently"}
      </button>
    </form>
  );
}
