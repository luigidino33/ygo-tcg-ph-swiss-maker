"use client";

import { useEffect, useState } from "react";

type TournamentHistoryEntry = {
  id: string;
  name: string;
  created_at: string;
  player_count: number;
};

type PlayerStat = {
  name: string;
  tournaments: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_omw: number;
};

type MetagameEntry = {
  archetype: string;
  count: number;
  share: number;
  wins: number;
  losses: number;
  win_rate: number;
};

const fetchJSON = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch {}
  if (!res.ok) throw new Error(data?.error || text || `${res.status}`);
  return data;
};

const PIE_COLORS = ['#64b5f6','#81c784','#ff9800','#ef5350','#ce93d8','#4dd0e1','#ffb74d','#a5d6a7','#f48fb1','#90caf9'];

export default function PlayersPage() {
  const [tab, setTab] = useState<"history" | "leaderboard" | "metagame">("history");
  const [history, setHistory] = useState<TournamentHistoryEntry[]>([]);
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [metagame, setMetagame] = useState<MetagameEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [h, p, m] = await Promise.all([
          fetchJSON("/api/tournament-history"),
          fetchJSON("/api/all-player-stats"),
          fetchJSON("/api/global-metagame"),
        ]);
        setHistory(h.tournaments || []);
        setPlayers(p.players || []);
        setMetagame(m.metagame || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h1>YGO Swiss Tournament</h1>
          <a href="/" style={{ textDecoration: "none" }}>
            <button className="secondary" style={{ fontSize: 12 }}>Home</button>
          </a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["history", "leaderboard", "metagame"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab === t ? "" : "secondary"}
            style={{ flex: 1, minWidth: 120 }}
          >
            {t === "history" && "📜 Tournaments"}
            {t === "leaderboard" && "🏆 Leaderboard"}
            {t === "metagame" && "📊 Metagame"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><p>Loading...</p></div>
      ) : (
        <>
          {tab === "history" && <HistoryTab history={history} />}
          {tab === "leaderboard" && <LeaderboardTab players={players} />}
          {tab === "metagame" && <MetagameTab metagame={metagame} />}
        </>
      )}
    </main>
  );
}

function HistoryTab({ history }: { history: TournamentHistoryEntry[] }) {
  if (history.length === 0) {
    return <div className="card"><p style={{ color: "#94a3b8" }}>No tournaments found.</p></div>;
  }
  return (
    <div className="card">
      <h2>Tournament History</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {history.map((h) => (
          <div
            key={h.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 12,
              background: "rgba(26, 35, 126, 0.4)",
              border: "2px solid #5c6bc0",
              borderRadius: 8,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold", fontSize: 14 }}>{h.name}</div>
              <div style={{ fontSize: 12, color: "#90caf9" }}>
                {h.player_count} players
                {h.created_at ? ` \u2022 ${new Date(h.created_at).toLocaleDateString()}` : ""}
              </div>
            </div>
            <a href={`/view/${h.id}`} style={{ textDecoration: "none" }}>
              <button style={{ fontSize: 12, padding: "6px 14px" }}>View</button>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardTab({ players }: { players: PlayerStat[] }) {
  if (players.length === 0) {
    return <div className="card"><p style={{ color: "#94a3b8" }}>No player data yet.</p></div>;
  }
  return (
    <div className="card">
      <h2>All-Time Leaderboard</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Player</th>
              <th style={{ width: 60 }}>T</th>
              <th style={{ width: 60 }}>W</th>
              <th style={{ width: 60 }}>L</th>
              <th style={{ width: 80 }}>Win%</th>
              <th style={{ width: 80 }}>OMW%</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={p.name} className={i < 3 ? `rank-${i + 1}` : ""}>
                <td style={{ textAlign: "center", fontWeight: "bold", fontSize: 16 }}>
                  {i === 0 && "\u{1F947} "}
                  {i === 1 && "\u{1F948} "}
                  {i === 2 && "\u{1F949} "}
                  {i + 1}
                </td>
                <td style={{ fontWeight: "bold" }}>{p.name}</td>
                <td style={{ textAlign: "center" }}>{p.tournaments}</td>
                <td style={{ textAlign: "center", color: "#81c784" }}>{p.wins}</td>
                <td style={{ textAlign: "center", color: "#ef5350" }}>{p.losses}</td>
                <td style={{ textAlign: "center", fontWeight: "bold" }}>{p.win_rate}%</td>
                <td style={{ textAlign: "center" }}>{p.avg_omw}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetagameTab({ metagame }: { metagame: MetagameEntry[] }) {
  if (metagame.length === 0) {
    return (
      <div className="card">
        <p style={{ color: "#94a3b8" }}>No deck data yet. Tag player decks in the admin panel first.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Top Archetypes</h2>

      {/* Pie chart */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <svg viewBox="-1.1 -1.1 2.2 2.2" width={220} height={220}>
          {(() => {
            const total = metagame.reduce((s, m) => s + m.count, 0);
            let cumAngle = -Math.PI / 2;
            return metagame.map((m, i) => {
              const angle = (m.count / total) * 2 * Math.PI;
              const x1 = Math.cos(cumAngle);
              const y1 = Math.sin(cumAngle);
              cumAngle += angle;
              const x2 = Math.cos(cumAngle);
              const y2 = Math.sin(cumAngle);
              const largeArc = angle > Math.PI ? 1 : 0;
              const d = `M0,0 L${x1},${y1} A1,1 0 ${largeArc},1 ${x2},${y2} Z`;
              return <path key={i} d={d} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#0c1445" strokeWidth={0.02} />;
            });
          })()}
        </svg>
      </div>

      {/* Stats table */}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>Archetype</th>
              <th style={{ width: 60 }}>Count</th>
              <th style={{ width: 70 }}>Share</th>
              <th style={{ width: 80 }}>Record</th>
              <th style={{ width: 80 }}>Win%</th>
            </tr>
          </thead>
          <tbody>
            {metagame.map((m, i) => (
              <tr key={m.archetype}>
                <td style={{ textAlign: "center" }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block" }} />
                </td>
                <td style={{ fontWeight: "bold" }}>{m.archetype}</td>
                <td style={{ textAlign: "center" }}>{m.count}</td>
                <td style={{ textAlign: "center" }}>{m.share}%</td>
                <td style={{ textAlign: "center" }}>{m.wins}W-{m.losses}L</td>
                <td style={{ textAlign: "center", fontWeight: "bold", color: m.win_rate >= 50 ? "#81c784" : "#ef5350" }}>
                  {m.win_rate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
