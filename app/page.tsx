"use client";

import { useEffect, useMemo, useState } from "react";

type Pair = { table: number; a: string; b: string; match_id: string };
type StandRow = {
  rank: number;
  player: string;
  pts: number;
  mw: number;
  omw: number;
  oomw: number;
  ddd: string;
  kts: string;
};
type TournamentInfo = { id: string; name: string; total_rounds: number; round: number };

const fetchJSON = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let data: any = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch {}
  if (!res.ok) {
    const msg = data?.error || data?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
};


export default function Page() {
  const [tid, setTid] = useState<string | null>(null);
  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [standings, setStandings] = useState<StandRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [playersText, setPlayersText] = useState("");
  const [name, setName] = useState("BDC Weekly");
  const [rounds, setRounds] = useState(4);

  // match results map: match_id -> "A" | "B" | "TIE"
  const [results, setResults] = useState<Record<string, "A" | "B" | "TIE">>({});

  // Load saved tid
  useEffect(() => {
    const saved = localStorage.getItem("tid");
    if (saved) setTid(saved);
  }, []);

  // Fetch tournament info & standings periodically
  useEffect(() => {
    if (!tid) return;
    const load = async () => {
      try {
        const i = await fetchJSON(`/api/tournaments/${tid}`);
        setInfo(i);
        const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
        setStandings(s.standings);
      } catch (e) {
        console.error(e);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [tid]);

  const canPairMore = useMemo(() => {
    if (!info) return false;
    return info.round < info.total_rounds;
  }, [info]);

  const createTournament = async () => {
    setCreating(true);
    try {
      const players = playersText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!players.length) {
        alert("Add at least one player (one per line).");
        return;
      }
      const data = await fetchJSON(`/api/tournaments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, total_rounds: rounds, players }),
      });
      localStorage.setItem("tid", data.tournament_id);
      setTid(data.tournament_id);
      setPairs([]);
      setResults({});
    } catch (e) {
      console.error(e);
      alert("Failed to create tournament.");
    } finally {
      setCreating(false);
    }
  };

  const loadExisting = async () => {
    const t = prompt("Enter tournament_id:");
    if (!t) return;
    localStorage.setItem("tid", t);
    setTid(t);
    setPairs([]);
    setResults({});
  };

  const forgetTournament = () => {
    localStorage.removeItem("tid");
    setTid(null);
    setInfo(null);
    setStandings([]);
    setPairs([]);
    setResults({});
  };

  const pairNext = async () => {
    if (!tid) return;
    setPairing(true);
    try {
      const data = await fetchJSON(`/api/tournaments/${tid}/pair-next`, { method: "POST" });
      if (!data.ok) {
        alert(data.message || "Pairing refused.");
        return;
      }
      setPairs(data.pairs);
      setResults({});
      // refresh info (round advanced)
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      // BYE gives points immediately; show standings now
      const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
      setStandings(s.standings);
    } catch (e) {
      console.error(e);
      alert("Failed to pair.");
    } finally {
      setPairing(false);
    }
  };

  const finalizeRound = async () => {
    if (!tid) return;
    // Build payload: skip BYE matches
    const payload = {
      results: pairs
        .filter((p) => p.b !== "BYE")
        .map((p) => {
          const outcome = results[p.match_id];
          if (!outcome) throw new Error(`Missing result for table ${p.table}`);
          return { match_id: p.match_id, outcome };
        }),
    };
    setFinalizing(true);
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/finalize-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStandings(res.standings);
      setPairs([]);
      setResults({});
      // refresh round count
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
    } catch (e) {
      console.error(e);
      alert("Finalize failed.");
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <main>
      <h1>🃏 BDC Swiss — Admin</h1>

      {!tid ? (
        <>
          <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
            <h3>Create Tournament</h3>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                Name:
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
              </label>
              <label>
                Rounds:
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={rounds}
                  onChange={(e) => setRounds(parseInt(e.target.value || "1"))}
                />
              </label>
              <label>
                Players (one per line):
                <textarea
                  value={playersText}
                  onChange={(e) => setPlayersText(e.target.value)}
                  placeholder="Alice&#10;Bob&#10;Carmen"
                  style={{ width: "100%", height: 160 }}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={createTournament} disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </button>
                <button onClick={loadExisting} style={{ opacity: 0.7 }}>
                  Load existing by ID
                </button>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section style={{ marginTop: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <strong>Tournament ID:</strong>
              <code>{tid}</code>
              <button onClick={forgetTournament} style={{ marginLeft: 8 }}>Forget</button>
            </div>
            {info && (
              <p style={{ marginTop: 8 }}>
                <b>{info.name}</b> — Round <b>{info.round}</b> / <b>{info.total_rounds}</b>
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={pairNext} disabled={!canPairMore || pairing}>
                {pairing ? "Pairing..." : "Pair Next Round"}
              </button>
              <button onClick={finalizeRound} disabled={!pairs.length || finalizing}>
                {finalizing ? "Finalizing..." : "Finalize Round"}
              </button>
            </div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3>Current Pairings</h3>
              {!pairs.length ? (
                <p style={{ color: "#777" }}>No active pairings. Click <b>Pair Next Round</b>.</p>
              ) : (
                <div>
                  {pairs.map((p) => (
                    <div key={p.match_id} style={{ border: "1px solid #ddd", padding: 12, borderRadius: 12, margin: "8px 0" }}>
                      <b>Table {p.table}</b>
                      <div>{p.a} vs {p.b}</div>
                      {p.b === "BYE" ? (
                        <div style={{ color: "#555", fontStyle: "italic" }}>BYE is auto-recorded.</div>
                      ) : (
                        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                          <label>
                            <input
                              type="radio"
                              name={p.match_id}
                              onChange={() =>
                                setResults((r) => ({ ...r, [p.match_id]: "A" }))
                              }
                              checked={results[p.match_id] === "A"}
                            />{" "}
                            {p.a} wins
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={p.match_id}
                              onChange={() =>
                                setResults((r) => ({ ...r, [p.match_id]: "B" }))
                              }
                              checked={results[p.match_id] === "B"}
                            />{" "}
                            {p.b} wins
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={p.match_id}
                              onChange={() =>
                                setResults((r) => ({ ...r, [p.match_id]: "TIE" }))
                              }
                              checked={results[p.match_id] === "TIE"}
                            />{" "}
                            Tie
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3>Standings</h3>
              {!standings.length ? (
                <p style={{ color: "#777" }}>No standings yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Rank", "Player", "Pts", "MW%", "OMW%", "OOMW%", "DDD", "KTS"].map((h) => (
                          <th key={h} style={{ border: "1px solid #ddd", padding: 8, background: "#f7f7f7", textAlign: "left" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((r) => (
                        <tr key={`${r.rank}-${r.player}`}>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.rank}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.player}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.pts}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.mw.toFixed(1)}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.omw.toFixed(1)}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.oomw.toFixed(1)}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.ddd}</td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.kts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
