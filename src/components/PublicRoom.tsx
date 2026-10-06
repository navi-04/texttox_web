"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { messageOf, post } from "@/lib/client";
import type { PublicMessageView } from "@/lib/public";
import { ArrowUp, Back, Group } from "./Icons";

const MAX = 500;
const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const time = (at: number) => {
  const d = new Date(at);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return Date.now() - at < DAY && new Date().getDate() === d.getDate() ? t : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${t}`;
};

/** The public room: one anonymous group chat. Messages are kept for 48 hours, then they are gone. */
export default function PublicRoom({ onBack, onSignedOut }: { onBack: () => void; onSignedOut: () => void }) {
  const [messages, setMessages] = useState<PublicMessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const after = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [epoch, setEpoch] = useState(0); // bump to make the poll answer straight away

  const add = (incoming: PublicMessageView[]) => {
    if (incoming.length === 0) return;
    after.current = incoming.reduce((max, m) => Math.max(max, m.id), after.current);
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-300);
    });
  };

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      while (!ctl.signal.aborted) {
        try {
          const res = await fetch(`/api/public?after=${after.current}`, { signal: ctl.signal, cache: "no-store" });
          if (res.status === 401) return onSignedOut();
          if (!res.ok) throw new Error(String(res.status));
          const data: { messages: PublicMessageView[] } = await res.json();
          setOffline(false);
          setLoaded(true);
          add(data.messages);
        } catch {
          if (ctl.signal.aborted) return;
          setOffline(true);
          await sleep(3000);
        }
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  // Phones freeze background tabs; catch up as soon as the page is back.
  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && setEpoch((n) => n + 1);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const sent = await post<{ id: number; at: number }>("/api/public/send", { text });
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      stick.current = true;
      // Not moving the cursor: the poll fetches anything that arrived before this message, in order.
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, { id: sent.id, mine: true, text, at: sent.at }].sort((a, b) => a.id - b.id)));
      setEpoch((n) => n + 1);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="x-chat">
      <header className="x-chat-bar">
        <button className="x-icon-btn" aria-label="Leave the public room" onClick={onBack}>
          <Back />
        </button>
        <span className="x-avatar" aria-hidden>
          <Group size={22} />
        </span>
        <div className="x-chat-id">
          <strong>Public room</strong>
          <span className="x-status">
            <i className={offline ? "" : "on"} />
            {offline ? "Reconnecting…" : "Everyone is anonymous · gone after 48 h"}
          </span>
        </div>
      </header>

      <div
        className="x-log"
        ref={listRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {!loaded && <div className="x-spinner" role="status" aria-label="Loading" style={{ alignSelf: "center", margin: "28px 0" }} />}
        {loaded && messages.length === 0 && <p className="x-chip">Nobody has said anything yet. Be the first.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`x-b ${m.mine ? "mine" : "theirs"}`}>
            {m.text}
            <time>{time(m.at)}</time>
          </div>
        ))}
      </div>

      {error && (
        <p className="x-error" role="alert" style={{ margin: "0 14px 10px" }}>
          {error}
        </p>
      )}

      <form
        className="x-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={MAX}
          placeholder="Say something to everyone"
          aria-label="Message"
          enterKeyHint="send"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="x-send" aria-label="Send" disabled={!draft.trim() || sending}>
          <ArrowUp />
        </button>
      </form>
    </div>
  );
}
