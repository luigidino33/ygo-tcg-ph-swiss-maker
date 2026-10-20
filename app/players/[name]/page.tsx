"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Result = {
  tournament_id: string;
  tournament_name: string;
  date: string;
  format: "standard" | "retro";
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  omw: number;
  rank: number | null;
  total_players: number;
  rounds_played: number;
  total_rounds: number;
  deck: string;
  dropped: boolean;
};
type Profile = { name: string; tournaments: number; tournament_results: Result[] };
type Filter = "all" | "standard" | "retro";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export default function PlayerProfilePage() {
  const { name } = useParams<{ name: string }>();
  const playerName = decodeURIComponent(name);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch(`/api/player-stats?name=${encodeURIComponent(playerName)}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.statusText);
        setProfile(data);
      })
      .catch((e) => setError(e.message || "Failed to load player"));
  }, [playerName]);

  const rows = useMemo(
    () => (profile?.tournament_results || []).filter((r) => filter === "all" || r.format === filter),
    [profile, filter]
  );

  const summary = useMemo(() => {
    const w = rows.reduce((s, r) => s + r.wins, 0);
    const l = rows.reduce((s, r) => s + r.losses, 0);
    const d = rows.reduce((s, r) => s + r.draws, 0);
    const ranked = rows.filter((r) => r.rank && r.rounds_played > 0);
    const best = ranked.length ? Math.min(...ranked.map((r) => r.rank as number)) : null;
    const tops = ranked.filter((r) => (r.rank as number) <= Math.max(4, Math.floor(r.total_players / 4))).length;
    const decks: Record<string, number> = {};
    rows.forEach((r) => { if (r.deck) decks[r.deck] = (decks[r.deck] || 0) + 1; });
    return {
      events: rows.filter((r) => r.rounds_played > 0).length, w, l, d,
      winRate: pct(w, w + l + d),
      best,
      tops,
      wins1st: ranked.filter((r) => r.rank === 1).length,
      decks: Object.entries(decks).sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  const hasRetro = profile?.tournament_results.some((r) => r.format === "retro");
  const hasStandard = profile?.tournament_results.some((r) => r.format === "standard");

  if (error || !profile) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto" }}>
        <div className="card">
          <h1>{playerName}</h1>
          <p>{error ? `Could not load player: ${error}` : "Loading..."}</p>
        </div>
      </main>
    );
  }

  if (!profile.tournaments) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto" }}>
        <div className="card">
          <h1>{playerName}</h1>
          <p style={{ marginBottom: 16 }}>No tournament history found for this player.</p>
          <a href="/players?tab=leaderboard"><button className="secondary">Back to Ranking</button></a>
        </div>
      </main>
    );
  }

  const tile = (label: string, value: string | number, accent?: string) => (
    <div style={{ flex: "1 1 120px", padding: "12px 14px", border: "1px solid rgba(70,160,255,0.45)", borderRadius: 3, background: "rgba(4,22,52,0.7)" }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#86b4e6", fontFamily: "Rajdhani, sans-serif", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "Rajdhani, sans-serif", color: accent || "#eaf4ff" }}>{value}</div>
    </div>
  );

  return (
    <main style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <h1 style={{ marginBottom: 0 }}>{profile.name}</h1>
          <a href="/players?tab=leaderboard"><button className="secondary" style={{ fontSize: 13 }}>Ranking</button></a>
        </div>

        {hasRetro && hasStandard && (
          <div className="nv-tabs" style={{ marginBottom: 16 }}>
            {(["all", "standard", "retro"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? "All Formats" : f === "standard" ? "Standard" : "Retro"}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {tile("Events", summary.events)}
          {tile("Record", `${summary.w}-${summary.l}${summary.d ? `-${summary.d}` : ""}`)}
          {tile("Win Rate", `${summary.winRate}%`, "#7fe0ff")}
          {tile("Best Finish", summary.best ? `#${summary.best}` : "—")}
          {tile("Top Cuts", summary.tops)}
          {tile("Event Wins", summary.wins1st, summary.wins1st ? "#ffd54f" : undefined)}
        </div>
      </div>

      {summary.decks.length > 0 && (
        <div className="card">
          <h2>Decks Played</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {summary.decks.map(([deck, n]) => (
              <span key={deck} style={{ padding: "6px 14px", borderRadius: 999, border: "1px solid rgba(127,224,255,0.6)", background: "rgba(4,22,52,0.7)", fontSize: 14 }}>
                {deck} <span style={{ color: "#86b4e6" }}>×{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Tournament History</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const started = r.rounds_played > 0;
            const podium = !started ? "#3b5575" : r.rank === 1 ? "#ffd54f" : r.rank === 2 ? "#cfd8dc" : r.rank === 3 ? "#ffb74d" : "#3aa0ff";
            return (
              <a
                key={r.tournament_id}
                href={`/view/${r.tournament_id}`}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", textDecoration: "none", color: "inherit",
                  background: "linear-gradient(180deg, rgba(14,64,128,0.7), rgba(6,30,66,0.85))", border: "1px solid rgba(70,160,255,0.25)",
                  borderLeft: `3px solid ${podium}`, borderRadius: 2 }}
              >
                <div style={{ minWidth: 54, textAlign: "center", fontFamily: "Rajdhani, sans-serif", fontWeight: 700 }}>
                  <div style={{ fontSize: 22, color: podium }}>{started && r.rank ? `#${r.rank}` : "—"}</div>
                  <div style={{ fontSize: 11, color: "#86b4e6" }}>{started ? `of ${r.total_players}` : "Not started"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.tournament_name}</div>
                  <div style={{ fontSize: 12, color: "#86b4e6" }}>
                    {r.date ? new Date(r.date).toLocaleDateString() : ""} • {r.format === "retro" ? "Retro" : "Standard"}
                    {started && r.rounds_played < r.total_rounds ? ` • In progress (Round ${r.rounds_played}/${r.total_rounds})` : ""}
                    {r.byes ? ` • ${r.byes} bye${r.byes > 1 ? "s" : ""}` : ""}
                    {r.dropped ? " • Dropped" : ""}
                  </div>
                  {r.deck && <div style={{ fontSize: 12, color: "#7fe0ff", marginTop: 2 }}>{r.deck}</div>}
                </div>
                <div style={{ textAlign: "right", fontFamily: "Rajdhani, sans-serif", fontWeight: 700, fontSize: 18, whiteSpace: "nowrap" }}>
                  <span style={{ color: "#81c784" }}>{r.wins}</span>-<span style={{ color: "#ef5350" }}>{r.losses}</span>
                  {r.draws ? <>-<span style={{ color: "#ffb74d" }}>{r.draws}</span></> : null}
                  <div style={{ fontSize: 11, color: "#86b4e6", fontWeight: 600 }}>OMW {r.omw}%</div>
                </div>
              </a>
            );
          })}
          {rows.length === 0 && <p style={{ color: "#86b4e6" }}>No events in this format.</p>}
        </div>
      </div>
    </main>
  );
}
