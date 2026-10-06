"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { messageOf, post } from "@/lib/client";
import type { ChatView, MessageView } from "@/lib/state";
import Modal from "./Modal";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

type Props = {
  chat: ChatView;
  messages: MessageView[];
  myHandle: string;
  onSent: (m: MessageView) => void;
  onChanged: () => void;
  onLeave: () => Promise<void>;
};

export default function Chat({ chat, messages, myHandle, onSent, onChanged, onLeave }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState(false);
  const [dialog, setDialog] = useState<"reveal" | "report" | "leave" | null>(null);
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // keep the view pinned to the newest message unless the user scrolled up

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const { partner, ended, iAmAnonymous } = chat;
  const hasReported = reported || chat.reportedByMe;

  async function send() {
    const text = draft.trim();
    if (!text || ended) return;
    setDraft("");
    setError("");
    stick.current = true;
    if (inputRef.current) inputRef.current.style.height = "auto";
    try {
      const sent = await post<{ id: number; at: number }>("/api/chat/send", { text });
      onSent({ id: sent.id, kind: "msg", mine: true, text, at: sent.at });
    } catch (e) {
      setDraft(text);
      setError(messageOf(e));
      onChanged(); // the chat may have ended
    }
  }

  async function setAnonymous(anonymous: boolean) {
    setToggling(true);
    setDialog(null);
    setError("");
    try {
      await post("/api/chat/anonymous", { anonymous });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setToggling(false);
      onChanged();
    }
  }

  async function report() {
    setBusy(true);
    try {
      await post("/api/chat/report", { reason });
      setReported(true);
      setDialog(null);
    } catch (e) {
      setError(messageOf(e));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setDialog(null);
    try {
      await onLeave();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  const status = ended ? "Chat ended" : `${partner.revealed ? "Username visible" : "Anonymous"} · ${partner.online ? "online" : "offline"}`;

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="chat-top">
          <div className="who">
            <strong>{partner.revealed ? partner.handle : "Stranger"}</strong>
            <span className="muted small">{status}</span>
          </div>
          <div className="actions">
            <button className="link" disabled={hasReported} onClick={() => setDialog("report")}>
              {hasReported ? "Reported" : "Report"}
            </button>
            {!ended && (
              <button className="link" onClick={() => setDialog("leave")}>
                Leave
              </button>
            )}
          </div>
        </div>
        {!ended && (
          <div className="privacy">
            <span id="anon-label">{iAmAnonymous ? "You are anonymous" : "Your username is visible to them"}</span>
            <button
              className="switch"
              role="switch"
              aria-checked={iAmAnonymous}
              aria-labelledby="anon-label"
              disabled={toggling}
              onClick={() => (iAmAnonymous ? setDialog("reveal") : setAnonymous(true))}
            />
          </div>
        )}
      </header>

      {hasReported && <div className="notice">Reported. Thanks for letting us know.</div>}

      <div
        className="messages"
        ref={listRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.map((m) =>
          m.kind === "info" ? (
            <p key={m.id} className="info">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className={`bubble ${m.mine ? "mine" : "theirs"}`}>
              {m.text}
              <time>{time(m.at)}</time>
            </div>
          ),
        )}
      </div>

      {error && (
        <p className="error" role="alert" style={{ margin: "0 16px 8px" }}>
          {error}
        </p>
      )}

      {ended ? (
        <div className="ended">
          <p className="muted small">This chat has ended.</p>
          <button className="btn" disabled={busy} onClick={leave} style={{ minWidth: 200 }}>
            Start a new chat
          </button>
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            className="field"
            rows={1}
            maxLength={1000}
            placeholder="Type a message"
            aria-label="Message"
            value={draft}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="btn" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      )}

      <Modal open={dialog === "reveal"} onClose={() => setDialog(null)} title="Show your username?">
        <p className="muted">
          Your partner will see <strong style={{ color: "var(--fg)" }}>{myHandle}</strong>, which tells them who you are. You can switch back to
          anonymous, but they will already have seen it.
        </p>
        <div className="stack">
          <button className="btn" onClick={() => setAnonymous(false)}>
            Yes, show it
          </button>
          <button className="btn ghost" onClick={() => setDialog(null)}>
            Stay anonymous
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "report"} onClose={() => setDialog(null)} title="Report this chat">
        <p className="muted">The conversation, and who is in it, is sent to the site admin to review. Your partner isn&rsquo;t told.</p>
        <div className="stack">
          <textarea
            className="field"
            rows={3}
            maxLength={300}
            placeholder="What happened? (optional)"
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn" disabled={busy} onClick={report}>
            Send report
          </button>
          <button className="btn ghost" onClick={() => setDialog(null)}>
            Cancel
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "leave"} onClose={() => setDialog(null)} title="Leave this chat?">
        <p className="muted">The chat ends for both of you and can&rsquo;t be opened again.</p>
        <div className="stack">
          <button className="btn" disabled={busy} onClick={leave}>
            Leave chat
          </button>
          <button className="btn ghost" onClick={() => setDialog(null)}>
            Stay
          </button>
        </div>
      </Modal>
    </div>
  );
}
