"use client";

import { useState } from "react";
import type { UserRow } from "@/lib/admin";
import Modal from "../Modal";

export const when = (ms: number) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const handleOf = (email: string) => email.split("@")[0];
/** A short name for someone: their username, or (older accounts) the start of their email. */
export const shortName = (u: { username: string | null; email: string }) => u.username ?? handleOf(u.email);

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export const Chip = ({ children, strong }: { children: React.ReactNode; strong?: boolean }) => (
  <span className={strong ? "chip strong" : "chip"}>{children}</span>
);

export function UserChips({ u }: { u: UserRow }) {
  return (
    <>
      {u.blocked && <Chip strong>Blocked</Chip>}
      {u.online && <Chip>Online</Chip>}
      {u.inChat && <Chip>In chat</Chip>}
      {u.searching && <Chip>Searching</Chip>}
      {u.reportsAgainst > 0 && <Chip>Reported {u.reportsAgainst}×</Chip>}
    </>
  );
}

export function Confirm(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  /** The admin must type this exact word before the button works. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const ready = !props.requireText || typed === props.requireText;
  return (
    <Modal open={props.open} onClose={props.onCancel} title={props.title}>
      <div className="muted">{props.children}</div>
      <div className="stack">
        {props.requireText && (
          <input
            className="field"
            placeholder={`Type ${props.requireText} to confirm`}
            aria-label="Confirmation"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        )}
        <button
          className="btn"
          disabled={!ready || props.busy || props.disabled}
          onClick={() => {
            props.onConfirm();
            setTyped("");
          }}
        >
          {props.busy ? "Working…" : props.confirmLabel}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setTyped("");
            props.onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function DeleteUserDialog(props: { email: string | null; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Confirm
      open={props.email !== null}
      title="Delete this user completely?"
      confirmLabel="Delete permanently"
      requireText="DELETE"
      busy={props.busy}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    >
      <p>
        <strong style={{ color: "var(--fg)" }}>{props.email}</strong> is removed for good: the account, their sessions, every conversation they were in (the other person
        just goes back to the home screen) and all reports about or by them. This can&rsquo;t be undone.
      </p>
      <p style={{ marginTop: 8 }}>They can sign up again with the same email. To keep someone out, use Block instead.</p>
    </Confirm>
  );
}
