"use client";

import { useEffect, useRef, useState } from "react";

type User = { username: string; player_name: string };

export default function AccountChip() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (user === undefined) return null;

  const here = () => window.location.pathname + window.location.search;

  if (!user) {
    return (
      <div className="nv-account">
        <a className="nv-account-btn" href="/login" onClick={(e) => { e.preventDefault(); window.location.href = `/login?next=${encodeURIComponent(here())}`; }}>
          Log in
        </a>
      </div>
    );
  }

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  return (
    <div className="nv-account" ref={ref}>
      <button className="nv-account-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`Logged in as ${user.username}`}>
        {user.player_name}
      </button>
      {open && (
        <div className="nv-account-menu">
          <div style={{ fontSize: 11, color: "#86b4e6", padding: "4px 10px 8px" }}>@{user.username}</div>
          <a href="/decks">My decks</a>
          <a href={`/players/${encodeURIComponent(user.player_name)}`}>My profile</a>
          <button onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}
