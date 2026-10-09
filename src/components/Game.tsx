"use client";

import { useState } from "react";
import { messageOf, post } from "@/lib/client";
import type { GameView } from "@/lib/state";

const MAX = 200;

type Props = { game: GameView; partner: string; onChanged: () => void };

/**
 * The Truth or Dare controls, between the chat and the message box. Which buttons show depends on whose turn it is and
 * on the round's step; the server decides all of it, so a refresh or a second phone shows the same thing.
 * "Player" = the one being asked this round; "asker" = the other person, who alone picks (draws or writes) the prompt.
 */
export default function Game({ game, partner, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post("/api/game", body);
      setWriting(false);
      setText("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      onChanged(); // the other person's phone hears about it through the normal poll
    }
  }

  const word = game.pick === "dare" ? "dare" : "truth";
  let body: React.ReactNode;

  if (game.phase === "choose") {
    body = game.myTurn ? (
      <>
        <p className="x-game-t">Your turn. Truth or dare?</p>
        <div className="x-game-row">
          <button className="x-btn" disabled={busy} onClick={() => act({ action: "pick", kind: "truth" })}>
            Truth
          </button>
          <button className="x-btn" disabled={busy} onClick={() => act({ action: "pick", kind: "dare" })}>
            Dare
          </button>
        </div>
      </>
    ) : (
      <p className="x-game-t dim">{partner} is choosing truth or dare…</p>
    );
  } else if (game.phase === "ask") {
    // The player has no say in what they get: that is the asker's job, so they only wait.
    body = game.myTurn ? (
      <p className="x-game-t dim">You chose {word}. {partner} is picking one for you…</p>
    ) : writing ? (
      <>
        <p className="x-game-t">Write a {word} for {partner}</p>
        <textarea
          className="x-text"
          rows={2}
          maxLength={MAX}
          placeholder={word === "dare" ? "A fun dare that can be done in the chat" : "A fun question"}
          aria-label={`Your ${word}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <p className="x-small">Keep it fun. No personal details, links or anything that could hurt. They can skip it, and report it.</p>
        <div className="x-game-row">
          <button className="x-btn ghost" disabled={busy} onClick={() => setWriting(false)}>
            Back
          </button>
          <button className="x-btn" disabled={busy || text.trim().length < 5} onClick={() => act({ action: "ask", text })}>
            Send
          </button>
        </div>
      </>
    ) : (
      <>
        <p className="x-game-t">{partner} chose {word}. Give them one:</p>
        <div className="x-game-row">
          <button className="x-btn" disabled={busy} onClick={() => act({ action: "draw" })}>
            Draw one
          </button>
          <button className="x-btn ghost" disabled={busy} onClick={() => setWriting(true)}>
            Write my own
          </button>
        </div>
      </>
    );
  } else {
    body = game.myTurn ? (
      <>
        <p className="x-game-t">{game.answered ? "Tap Done to pass the turn." : "Send your answer in the chat first."}</p>
        <div className="x-game-row">
          <button className="x-btn ghost" disabled={busy || (!game.custom && game.skipsLeft === 0)} onClick={() => act({ action: "skip" })}>
            {game.custom ? "Skip" : `Skip (${game.skipsLeft} left)`}
          </button>
          {/* Locked until the player has actually sent something in the chat. The server checks this too. */}
          <button className="x-btn" disabled={busy || !game.answered} onClick={() => act({ action: "done" })}>
            Done
          </button>
        </div>
      </>
    ) : (
      <p className="x-game-t dim">Waiting for {partner} to answer…</p>
    );
  }

  return (
    <div className="x-game" role="group" aria-label="Truth or Dare">
      {body}
      {error && (
        <p className="x-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
