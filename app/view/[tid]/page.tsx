"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Pair = { table: number; a: string; b: string; match_id: string };
type StandRow = {
  rank: number;
  player: string;
  player_id: string;
  pts: number;
  mw: number;
  omw: number;
  oomw: number;
  ddd: string;
  kts: string;
  dropped: boolean;
};

type MatchHistoryEntry = {
  round: number;
  opponent: string;
  result: string;
  match_id: string;
};

const fetchJSON = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch {}
  if (!res.ok) throw new Error(data?.error || text || `${res.status}`);
  return data;
};

export default function ViewPage() {
  const params = useParams();
  const tid = params?.tid as string;

  const [info, setInfo] = useState<any>(null);
  const [standings, setStandings] = useState<StandRow[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Match history modal
  const [historyPlayer, setHistoryPlayer] = useState<{ name: string; id: string } | null>(null);
  const [historyData, setHistoryData] = useState<MatchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!tid) return;
    const load = async () => {
      try {
        const [i, s, a] = await Promise.all([
          fetchJSON(`/api/tournaments/${tid}`),
          fetchJSON(`/api/tournaments/${tid}/standings`),
          fetchJSON(`/api/tournaments/${tid}/active`),
        ]);
        setInfo(i);
        setStandings(s.standings);
        setPairs(a.pairs || []);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Failed to load tournament");
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [tid]);

  const loadHistory = async (playerId: string, playerName: string) => {
    setHistoryPlayer({ name: playerName, id: playerId });
    setHistoryLoading(true);
    setHistoryData([]);
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/player-history/${playerId}`);
      setHistoryData(res.history || []);
    } catch (e) {
      console.error(e);
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", paddingTop: 48 }}>
        <div className="card">
          <h1>Tournament Not Found</h1>
          <p style={{ color: "#ef5350" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div className="card">
        <h1>{info?.name || "Tournament"}</h1>
        {info && (
          <p style={{ color: "#cbd5e1", fontSize: 14, fontWeight: 500 }}>
            Round {info.round} of {info.total_rounds} &bull; {info.players?.length || 0} Duelists
          </p>
        )}
        <p style={{ color: "#90caf9", fontSize: 12, marginTop: 4 }}>
          Live view &mdash; auto-refreshes every 8 seconds &bull; Click a player name to see match history
        </p>
      </div>

      {pairs.length > 0 && (
        <div className="card">
          <h2>Active Pairings</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pairs.map((p) => {
              const isBye = p.b === "BYE";
              return (
                <div
                  key={p.match_id}
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
                  <div
                    style={{
                      background: "linear-gradient(135deg, #64b5f6, #90caf9)",
                      color: "#0c1445",
                      fontWeight: 900,
                      fontSize: 16,
                      padding: "6px 12px",
                      borderRadius: 6,
                      minWidth: 45,
                      textAlign: "center",
                    }}
                  >
                    #{p.table}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: "bold", color: "#e8eaf6" }}>
                      {p.a}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: "bold",
                        color: isBye ? "#94a3b8" : "#e8eaf6",
                        opacity: isBye ? 0.6 : 1,
                      }}
                    >
                      {p.b}
                    </div>
                  </div>
                  {isBye && (
                    <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: "bold" }}>
                      BYE
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {standings.length > 0 && (
        <div className="card">
          <h2>Standings</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Rank</th>
                  <th>Duelist</th>
                  <th style={{ width: 80 }}>Points</th>
                  <th style={{ width: 80 }}>MW%</th>
                  <th style={{ width: 80 }}>OMW%</th>
                  <th style={{ width: 80 }}>OOMW%</th>
                  <th style={{ width: 120 }}>KTS</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r) => (
                  <tr key={r.rank} className={`rank-${r.rank}`} style={{ opacity: r.dropped ? 0.5 : 1 }}>
                    <td style={{ textAlign: "center", fontWeight: "bold", fontSize: 18 }}>
                      {r.rank === 1 && "\u{1F947} "}
                      {r.rank === 2 && "\u{1F948} "}
                      {r.rank === 3 && "\u{1F949} "}
                      {r.rank}
                    </td>
                    <td>
                      <span
                        onClick={() => loadHistory(r.player_id, r.player)}
                        style={{ fontWeight: "bold", cursor: "pointer", borderBottom: "1px dashed #5c6bc0" }}
                        title="View match history"
                      >
                        {r.player}
                      </span>
                      {r.dropped && (
                        <span style={{ color: "#ef5350", fontSize: 11, marginLeft: 8 }}>
                          DROPPED
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", fontWeight: "bold", fontSize: 16 }}>{r.pts}</td>
                    <td style={{ textAlign: "center" }}>{r.mw.toFixed(1)}</td>
                    <td style={{ textAlign: "center" }}>{r.omw.toFixed(1)}</td>
                    <td style={{ textAlign: "center" }}>{r.oomw.toFixed(1)}</td>
                    <td style={{ textAlign: "center", fontSize: 12 }}>{r.kts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match History Modal */}
      {historyPlayer && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setHistoryPlayer(null); }}>
          <div className="modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2>📋 {historyPlayer.name}&apos;s Match History</h2>
              <button onClick={() => setHistoryPlayer(null)} className="secondary">✕ Close</button>
            </div>
            {historyLoading ? (
              <p>Loading...</p>
            ) : historyData.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No match history found.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Round</th>
                    <th>Opponent</th>
                    <th style={{ width: 120 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.map((h) => {
                    const color =
                      h.result === "Win" || h.result === "BYE (Win)"
                        ? "#81c784"
                        : h.result === "Loss"
                        ? "#ef5350"
                        : h.result === "Double Loss"
                        ? "#ff9800"
                        : "#94a3b8";
                    return (
                      <tr key={h.match_id}>
                        <td style={{ textAlign: "center", fontWeight: "bold" }}>R{h.round}</td>
                        <td style={{ fontWeight: "bold" }}>{h.opponent}</td>
                        <td style={{ textAlign: "center", fontWeight: "bold", color }}>{h.result}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
