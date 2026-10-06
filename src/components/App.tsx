"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "@/lib/client";
import type { MessageView, StateView } from "@/lib/state";
import Chat from "./Chat";
import Login from "./Login";
import PublicRoom from "./PublicRoom";
import { Home, Searching, type Want } from "./Screens";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function merge(prev: MessageView[], next: MessageView[]): MessageView[] {
  if (next.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of next) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-500);
}

export default function App() {
  const [view, setView] = useState<StateView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [offline, setOffline] = useState(false);
  const [inPublic, setInPublic] = useState(false);
  // Bumping this restarts the poll loop, which answers immediately instead of waiting for news.
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => setEpoch((n) => n + 1), []);

  // What the server last told us about the chat on screen.
  const chatId = useRef<string | null>(null);
  const after = useRef(0);

  const apply = useCallback((v: StateView) => {
    const chat = v.chat;
    if (!chat) {
      chatId.current = null;
      after.current = 0;
      setMessages((prev) => (prev.length ? [] : prev));
    } else {
      if (chat.id !== chatId.current) {
        chatId.current = chat.id;
        after.current = 0;
        setMessages(chat.messages);
      } else {
        setMessages((prev) => merge(prev, chat.messages));
      }
      // Only server responses move the cursor; a message we sent ourselves must not make us skip the partner's.
      after.current = chat.messages.reduce((max, m) => Math.max(max, m.id), after.current);
    }
    setView(v);
  }, []);

  useEffect(() => {
    if (signedOut || inPublic) return; // the public room does its own polling
    const ctl = new AbortController();
    (async () => {
      let token: string | null = null;
      while (!ctl.signal.aborted) {
        try {
          const q = new URLSearchParams({ after: String(after.current) });
          if (token) q.set("t", token);
          if (chatId.current) q.set("c", chatId.current);
          const res = await fetch(`/api/poll?${q}`, { signal: ctl.signal, cache: "no-store" });
          if (res.status === 401) {
            setSignedOut(true);
            return;
          }
          if (!res.ok) throw new Error(String(res.status));
          const v: StateView = await res.json();
          token = v.token;
          setOffline(false);
          apply(v);
        } catch {
          if (ctl.signal.aborted) return;
          setOffline(true);
          await sleep(3000);
        }
      }
    })();
    return () => ctl.abort();
  }, [epoch, signedOut, inPublic, apply]);

  // Phones freeze background tabs; catch up as soon as the page is back.
  useEffect(() => {
    const wake = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  async function logout() {
    await post("/api/auth/logout").catch(() => {});
    setView(null);
    setMessages([]);
    chatId.current = null;
    after.current = 0;
    setInPublic(false);
    setSignedOut(true);
  }

  async function start(want: Want) {
    await post("/api/match/join", { want });
    refresh();
  }

  async function leaveChat() {
    await post("/api/chat/leave");
    refresh();
  }

  let screen: React.ReactNode;
  if (signedOut) {
    screen = (
      <Login
        onDone={() => {
          setSignedOut(false);
          refresh();
        }}
      />
    );
  } else if (!view) {
    screen = (
      <main className="page">
        <div className="spinner" role="status" aria-label="Loading" />
      </main>
    );
  } else if (inPublic) {
    screen = <PublicRoom onBack={() => setInPublic(false)} onSignedOut={() => { setInPublic(false); setSignedOut(true); }} />;
  } else if (view.status === "chatting" && view.chat) {
    screen = (
      <Chat
        // a fresh chat starts with fresh local state
        key={view.chat.id}
        chat={view.chat}
        messages={messages}
        myHandle={view.me.handle}
        onSent={(m) => setMessages((prev) => merge(prev, [m]))}
        onChanged={refresh}
        onLeave={leaveChat}
      />
    );
  } else if (view.status === "searching") {
    screen = (
      <Searching
        want={view.want}
        onCancel={async () => {
          await post("/api/match/cancel").catch(() => {});
          refresh();
        }}
      />
    );
  } else {
    screen = (
      <Home
        handle={view.me.handle}
        gender={view.me.gender}
        onStart={start}
        onPublic={() => setInPublic(true)}
        onGenderSaved={refresh}
        onLogout={logout}
      />
    );
  }

  return (
    <>
      {screen}
      {offline && !signedOut && (
        <div className="offline" role="status">
          Reconnecting…
        </div>
      )}
    </>
  );
}
