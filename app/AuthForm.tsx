"use client";

import { useEffect, useState } from "react";

// Only same-site paths, so ?next= can't send people to another website.
export const safeNext = (raw: string | null) => (raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/");

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const isRegister = mode === "register";
  const other = isRegister ? "/login" : "/register";
  const otherHref = next === "/" ? other : `${other}?next=${encodeURIComponent(next)}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isRegister && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { username, password, player_name: playerName } : { username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
      window.location.href = next;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", paddingTop: 24 }}>
      <form className="card" onSubmit={submit}>
        <h1>{isRegister ? "Create Account" : "Log In"}</h1>
        <p style={{ color: "#86b4e6", fontSize: 13, marginBottom: 18 }}>
          {isRegister
            ? "One account for registering, submitting decks and your player profile."
            : "Log in to register for tournaments and submit your decks."}
        </p>

        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          maxLength={20}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        {isRegister && (
          <>
            <label htmlFor="player_name">Player name</label>
            <input
              id="player_name"
              type="text"
              value={playerName}
              maxLength={40}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="As shown in standings"
              required
              style={{ marginBottom: 6 }}
            />
            <p style={{ color: "#86b4e6", fontSize: 12, marginBottom: 16 }}>
              If you've played before, use the exact name from past standings to keep your history.
            </p>
          </>
        )}

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          minLength={isRegister ? 8 : undefined}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {isRegister && (
          <>
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </>
        )}

        {error && <p style={{ color: "#ff8a80", fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <button type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Please wait..." : isRegister ? "Create Account" : "Log In"}
        </button>

        <p style={{ textAlign: "center", fontSize: 13, marginTop: 16, color: "#86b4e6" }}>
          {isRegister ? "Already have an account? " : "New here? "}
          <a href={otherHref}>{isRegister ? "Log in" : "Create an account"}</a>
        </p>
        {!isRegister && (
          <p style={{ textAlign: "center", fontSize: 12, marginTop: 6, color: "#86b4e6" }}>
            Forgot your password? Ask the tournament organizer to reset it.
          </p>
        )}
      </form>
    </main>
  );
}
