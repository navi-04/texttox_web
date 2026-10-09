"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiFailure, messageOf, post } from "@/lib/client";
import type { PublicMessageView, PublicReplyView } from "@/lib/public";
import { ArrowUp, Back, Close, Group, Reply } from "./Icons";

const MAX = 500;
const DAY = 24 * 60 * 60 * 1000;
const SWIPE_TO_REPLY = 60; // how far a message must be dragged right
const HINT_KEY = "ttx_reply_hint";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const time = (at: number) => {
  const d = new Date(at);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return Date.now() - at < DAY && new Date().getDate() === d.getDate() ? t : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${t}`;
};

const snippet = (text: string) => (text.length > 140 ? text.slice(0, 140).trimEnd() + "…" : text);

// Remembering that the "how to reply" hint was shown is a nicety: private mode or blocked storage just means it shows again.
const hintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};
const markHintSeen = () => {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* fine */
  }
};

type BubbleProps = { m: PublicMessageView; onReply: (m: PublicMessageView) => void; onJump: (id: number) => void };

/** One message. Drag it to the right (or press the arrow beside it on a desktop) to reply to it, like in a WhatsApp group. */
const Bubble = memo(function Bubble({ m, onReply, onJump }: BubbleProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean; dx: number } | null>(null);
  const [pull, setPull] = useState(0);

  const finish = (reply: boolean) => {
    const row = rowRef.current;
    if (row) {
      row.style.transition = "";
      row.style.transform = "";
    }
    drag.current = null;
    setPull(0);
    if (reply) {
      try {
        navigator.vibrate?.(12);
      } catch {
        /* not every phone can */
      }
      onReply(m);
    }
  };

  return (
    <div id={`pm-${m.id}`} className={`x-brow ${m.mine ? "mine" : "theirs"}`} ref={rowRef}
      onTouchStart={(e) => {
        const t = e.touches[0];
        drag.current = { x: t.clientX, y: t.clientY, active: false, dx: 0 };
      }}
      onTouchMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const t = e.touches[0];
        const dx = t.clientX - d.x;
        const dy = t.clientY - d.y;
        if (!d.active) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            drag.current = null; // it is a scroll, not a swipe
            return;
          }
          if (dx > 10 && dx > Math.abs(dy)) d.active = true;
          else return;
        }
        d.dx = Math.max(0, Math.min(dx, 80));
        const row = rowRef.current;
        if (row) {
          row.style.transition = "none";
          row.style.transform = `translateX(${d.dx}px)`;
        }
        setPull(Math.min(1, d.dx / SWIPE_TO_REPLY));
      }}
      onTouchEnd={() => finish(!!drag.current?.active && drag.current.dx >= SWIPE_TO_REPLY)}
      onTouchCancel={() => finish(false)}
    >
      <span className="x-pull" style={{ opacity: pull, transform: `translateY(-50%) scale(${0.6 + 0.4 * pull})` }} aria-hidden>
        <Reply />
      </span>
      <div className={`x-b ${m.mine ? "mine" : "theirs"}`}>
        {m.reply && (
          <button type="button" className={`x-quote${m.reply.text === null ? " gone" : ""}`} disabled={m.reply.text === null} onClick={() => onJump(m.reply!.id)}>
            <strong>{m.reply.mine ? "You" : "Anonymous"}</strong>
            <span>{m.reply.text ?? "This message was deleted"}</span>
          </button>
        )}
        {m.text}
        <time>{time(m.at)}</time>
      </div>
      <button type="button" className="x-rbtn" aria-label="Reply to this message" onClick={() => onReply(m)}>
        <Reply />
      </button>
    </div>
  );
});

/** The public room: one anonymous group chat. Messages are kept for the number of hours the admin chose (12 to 48), then they are gone. */
export default function PublicRoom({ onBack, onSignedOut }: { onBack: () => void; onSignedOut: () => void }) {
  const [messages, setMessages] = useState<PublicMessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [ttlHours, setTtlHours] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; text: string; mine: boolean } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [touch, setTouch] = useState(false);

  const after = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [epoch, setEpoch] = useState(0); // bump to make the poll answer straight away

  useEffect(() => {
    setTouch(window.matchMedia("(hover: none)").matches);
    setShowHint(!hintSeen());
  }, []);

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
          const data: { messages: PublicMessageView[]; ttlHours?: number } = await res.json();
          if (data.ttlHours) setTtlHours(data.ttlHours);
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

  // A short, self-clearing message (for example when the quoted message is out of reach).
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 2500);
    return () => clearTimeout(t);
  }, [note]);

  function startReply(m: PublicMessageView) {
    setReplyTo({ id: m.id, text: snippet(m.text), mine: m.mine });
    setShowHint(false);
    markHintSeen();
    inputRef.current?.focus();
  }

  function jumpTo(id: number) {
    const el = document.getElementById(`pm-${id}`);
    if (!el) return setNote("That message is further up than what is loaded.");
    stick.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("x-flash");
    void el.offsetWidth; // restart the highlight if it is pressed twice
    el.classList.add("x-flash");
    setTimeout(() => el.classList.remove("x-flash"), 1300);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const sent = await post<{ id: number; at: number; reply?: PublicReplyView }>("/api/public/send", { text, replyTo: replyTo?.id });
      setDraft("");
      setReplyTo(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
      stick.current = true;
      // Not moving the cursor: the poll fetches anything that arrived before this message, in order.
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, { id: sent.id, mine: true, text, at: sent.at, reply: sent.reply }].sort((a, b) => a.id - b.id)));
      setEpoch((n) => n + 1);
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiFailure && e.status === 409) setReplyTo(null); // the message being answered is gone: send it as a normal message instead
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
            {offline ? "Reconnecting…" : ttlHours ? `Everyone is anonymous · gone after ${ttlHours} h` : "Everyone is anonymous"}
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
        {showHint && messages.length > 0 && (
          <p className="x-chip">{touch ? "Tip: swipe a message to the right to reply to it" : "Tip: hover a message and press the arrow to reply to it"}</p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onReply={startReply} onJump={jumpTo} />
        ))}
      </div>

      {(error || note) && (
        <p className={error ? "x-error" : "x-chip"} role={error ? "alert" : "status"} style={error ? { margin: "0 14px 10px" } : { margin: "0 auto 8px" }}>
          {error || note}
        </p>
      )}

      {replyTo && (
        <div className="x-replybar">
          <div className="x-replybar-b">
            <strong>Replying to {replyTo.mine ? "yourself" : "Anonymous"}</strong>
            <span>{replyTo.text}</span>
          </div>
          <button type="button" className="x-icon-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
            <Close />
          </button>
        </div>
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
          placeholder={replyTo ? "Write your reply" : "Say something to everyone"}
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
            if (e.key === "Escape" && replyTo) setReplyTo(null);
          }}
        />
        <button className="x-send" aria-label="Send" disabled={!draft.trim() || sending}>
          <ArrowUp />
        </button>
      </form>
    </div>
  );
}
