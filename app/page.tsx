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

type Player = { id: string; name: string };

type TournamentInfo = {
  id: string;
  name: string;
  total_rounds: number;
  round: number;
  players?: Player[];
};

type LocalPair = {
  table: number;
  a_id: string;
  b_id: string | null;
};

// Helper: extract a readable message from unknown errors
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const fetchJSON = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) {
    const msg = data?.error || data?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
};

export default function Page() {
  const [tid, setTid] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [standings, setStandings] = useState<StandRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [creating, setCreating] = useState(false);

  // Admin edit result panel
  const [showEdit, setShowEdit] = useState(false);
  const [editMatchId, setEditMatchId] = useState<string>("");
  const [editResult, setEditResult] = useState<string>("PENDING");

  // Admin manual pair editor
  const [showPairEditor, setShowPairEditor] = useState(false);

  const [pairing, setPairing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [playersText, setPlayersText] = useState("");
  const [name, setName] = useState("BDC Weekly");
  const [rounds, setRounds] = useState(4);
  const [results, setResults] = useState<Record<string, "A" | "B" | "TIE">>({});

  useEffect(() => {
    const saved = localStorage.getItem("tid");
    if (saved) setTid(saved);
  }, []);

  useEffect(() => {
    if (!tid) return;
    const load = async () => {
      try {
        const i = await fetchJSON(`/api/tournaments/${tid}`);
        setInfo(i);
        setPlayers(i.players || []);
        const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
        setStandings(s.standings);
        const a = await fetchJSON(`/api/tournaments/${tid}/active`);
        setPairs(a.pairs || []);
        if (!a.pairs || a.pairs.length === 0) setResults({});
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
    return info.round < info.total_rounds && pairs.length === 0;
  }, [info, pairs.length]);

  const createTournament = async () => {
    setCreating(true);
    try {
      const playersList = playersText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!playersList.length) {
        alert("Add at least one player (one per line).");
        return;
      }
      const data = await fetchJSON(`/api/tournaments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, total_rounds: rounds, players: playersList }),
      });
      localStorage.setItem("tid", data.tournament_id);
      setTid(data.tournament_id);
      if (data.info) setInfo(data.info);
      setPairs([]);
      setPlayers([]);
      setResults({});
    } catch (e) {
      console.error(e);
      alert(`Failed to create tournament: ${errMsg(e)}`);
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
    setPlayers([]);
    setResults({});
    setShowEdit(false);
    setShowPairEditor(false);
  };

  const pairNext = async () => {
    if (!tid) return;
    if (pairs.length > 0) {
      alert('Finish the current round first. Click "Finalize Round".');
      return;
    }
    setPairing(true);
    try {
      let data: any = null;
      let lastErr = "";
      for (let i = 0; i < 8; i++) {
        try {
          data = await fetchJSON(`/api/tournaments/${tid}/pair-next`, { method: "POST" });
          break;
        } catch (e) {
          const msg = errMsg(e);
          lastErr = msg;
          if (msg.includes("read-after-write") || msg.includes("not found")) {
            await new Promise((res) => setTimeout(res, 750));
            continue;
          }
          throw e;
        }
      }
      if (!data) throw new Error(lastErr || "Pairing failed");

      if (!data.ok) {
        alert(data.message || "Pairing refused.");
        return;
      }
      setPairs(data.pairs);
      setResults({});

      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
      const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
      setStandings(s.standings);
    } catch (e) {
      console.error(e);
      alert(`Failed to pair: ${errMsg(e)}`);
    } finally {
      setPairing(false);
    }
  };

  const finalizeRound = async () => {
    if (!tid) return;
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
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
    } catch (e) {
      console.error(e);
      alert(`Finalize failed: ${errMsg(e)}`);
    } finally {
      setFinalizing(false);
    }
  };

  const editResultSave = async () => {
    if (!tid || !editMatchId) return;
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/edit-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: editMatchId, result: editResult }),
      });
      if (!res.ok) throw new Error(res.message || "Edit failed");
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
      const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
      setStandings(s.standings);
      setShowEdit(false);
      setEditMatchId("");
      setEditResult("PENDING");
      alert("✅ Result updated and standings reflowed.");
    } catch (e) {
      console.error(e);
      alert(`Edit failed: ${errMsg(e)}`);
    }
  };

  const matchOptions = useMemo(() => {
    try {
      return (pairs || []).map((m: any) => ({
        id: m.match_id || m.id,
        label: `Table ${m.table}: ${m.a} vs ${m.b}`,
      }));
    } catch {
      return [];
    }
  }, [pairs]);

  const initialManualPairs = useMemo<LocalPair[]>(() => {
    if (!players || !pairs) return [];
    return pairs.map((p) => ({
      table: p.table,
      a_id: players.find((pl) => pl.name === p.a)?.id || "",
      b_id: p.b === "BYE" ? null : (players.find((pl) => pl.name === p.b)?.id || null),
    }));
  }, [pairs, players]);

  const handleSavePairings = async (pairsToSave: LocalPair[]) => {
    if (!tid) return;
    try {
      await fetchJSON(`/api/tournaments/${tid}/manual-pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: pairsToSave }),
      });
      alert("✅ Pairings updated successfully!");
      setShowPairEditor(false);
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
      const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
      setStandings(s.standings);
      const a = await fetchJSON(`/api/tournaments/${tid}/active`);
      setPairs(a.pairs || []);
    } catch (e) {
      console.error(e);
      alert(`Failed to save pairings: ${errMsg(e)}`);
    }
  };

  if (!tid) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", paddingTop: 48 }}>
        <div className="card">
          <h1>⚔️ YGO Swiss Tournament</h1>
          <div>
            <label>Tournament Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., BDC Weekly"
            />
          </div>
          <div>
            <label>Number of Rounds</label>
            <input
              type="number"
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              min={1}
              max={20}
            />
          </div>
          <div>
            <label>Players (one per line)</label>
            <textarea
              value={playersText}
              onChange={(e) => setPlayersText(e.target.value)}
              rows={10}
              placeholder="John Doe&#10;Jane Smith&#10;Alex Johnson"
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button onClick={createTournament} disabled={creating} style={{ flex: 1 }}>
              {creating ? "Creating..." : "⚔️ Create Tournament"}
            </button>
            <button onClick={loadExisting} className="secondary" style={{ flex: 1 }}>
              📂 Load Existing
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1>⚔️ {info?.name || "Tournament"}</h1>
            {info && (
              <p style={{ color: '#d4af37', fontSize: 14 }}>
                Round {info.round} of {info.total_rounds} • {info.players?.length || 0} Duelists
              </p>
            )}
          </div>
          <button onClick={forgetTournament} className="secondary">
            ⚙️ Close Tournament
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={pairNext} disabled={!canPairMore || pairing}>
            {pairing ? "⏳ Pairing..." : "⚔️ Pair Next Round"}
          </button>
          <button onClick={finalizeRound} disabled={!pairs.length || finalizing} className="success">
            {finalizing ? "⏳ Finalizing..." : "✅ Finalize Round"}
          </button>
          <button onClick={() => setShowPairEditor(true)} disabled={!players.length} className="secondary">
            ✏️ Edit Pairings
          </button>
          <button onClick={() => setShowEdit((v) => !v)} disabled={!pairs.length} className="secondary">
            📝 Edit Result
          </button>
        </div>

        {showEdit && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Edit a Result</h3>
            <div style={{ display: "flex", gap: 12, alignItems: 'flex-end', flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label>Select Match</label>
                <select
                  value={editMatchId}
                  onChange={(e) => setEditMatchId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {matchOptions.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label>New Result</label>
                <select
                  value={editResult}
                  onChange={(e) => setEditResult(e.target.value)}
                >
                  <option value="PENDING">Pending</option>
                  <option value="A">Player A Won</option>
                  <option value="B">Player B Won</option>
                  <option value="TIE">Tie</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={editResultSave} disabled={!editMatchId}>
                  💾 Save
                </button>
                <button onClick={() => setShowEdit(false)} className="secondary">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {pairs.length > 0 && (
        <div className="card">
          <h2>🎴 Active Pairings</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Table</th>
                  <th>Player A</th>
                  <th>Player B</th>
                  <th style={{ width: 300 }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const isBye = p.b === "BYE";
                  const currentResult = results[p.match_id];
                  return (
                    <tr key={p.match_id}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 18 }}>
                        {p.table}
                      </td>
                      <td style={{ 
                        fontWeight: 'bold',
                        background: currentResult === "A" ? 'rgba(44, 143, 95, 0.3)' : undefined 
                      }}>
                        {p.a}
                      </td>
                      <td style={{ 
                        fontWeight: 'bold',
                        background: currentResult === "B" ? 'rgba(44, 143, 95, 0.3)' : undefined,
                        fontStyle: isBye ? 'italic' : undefined,
                        opacity: isBye ? 0.6 : 1
                      }}>
                        {p.b}
                      </td>
                      <td>
                        {isBye ? (
                          <span style={{ fontSize: 14, opacity: 0.7 }}>Auto Win</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                            <button
                              className={`result-btn ${currentResult === "A" ? "selected" : ""}`}
                              onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "A" }))}
                            >
                              A Wins
                            </button>
                            <button
                              className={`result-btn tie ${currentResult === "TIE" ? "selected" : ""}`}
                              onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "TIE" }))}
                            >
                              Tie
                            </button>
                            <button
                              className={`result-btn ${currentResult === "B" ? "selected" : ""}`}
                              onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "B" }))}
                            >
                              B Wins
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {standings.length > 0 && (
        <div className="card">
          <h2>🏆 Current Standings</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Rank</th>
                  <th>Duelist</th>
                  <th style={{ width: 80 }}>Points</th>
                  <th style={{ width: 80 }}>MW%</th>
                  <th style={{ width: 80 }}>OMW%</th>
                  <th style={{ width: 80 }}>OOMW%</th>
                  <th style={{ width: 120 }}>DDD</th>
                  <th style={{ width: 120 }}>KTS</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r) => (
                  <tr key={r.rank} className={`rank-${r.rank}`}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 18 }}>
                      {r.rank === 1 && '🥇 '}
                      {r.rank === 2 && '🥈 '}
                      {r.rank === 3 && '🥉 '}
                      {r.rank}
                    </td>
                    <td style={{ fontWeight: 'bold' }}>{r.player}</td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 16 }}>
                      {r.pts}
                    </td>
                    <td style={{ textAlign: 'center' }}>{r.mw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center' }}>{r.omw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center' }}>{r.oomw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center', fontSize: 12 }}>{r.ddd}</td>
                    <td style={{ textAlign: 'center', fontSize: 12 }}>{r.kts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPairEditor && (
        <ManualPairingEditor
          players={players}
          initial={initialManualPairs}
          onCancel={() => setShowPairEditor(false)}
          onSave={handleSavePairings}
        />
      )}
    </main>
  );
}

type ManualPairingEditorProps = {
  players: Player[];
  initial: LocalPair[];
  onCancel: () => void;
  onSave: (pairs: LocalPair[]) => void;
};

function ManualPairingEditor({ players, initial, onCancel, onSave }: ManualPairingEditorProps) {
  const [rows, setRows] = useState<LocalPair[]>(
    initial.length
      ? initial
      : [{ table: 1, a_id: "", b_id: null }]
  );
  const [error, setError] = useState<string | null>(null);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players]
  );

  const updateRow = (index: number, field: "a_id" | "b_id", value: string) => {
    setRows((prev) => {
      const copy = [...prev];
      const row = { ...copy[index] };
      if (field === "a_id") {
        row.a_id = value;
      } else {
        row.b_id = value || null;
      }
      copy[index] = row;
      return copy;
    });
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { table: prev.length + 1, a_id: "", b_id: null }
    ]);
  };

  const removeRow = (index: number) => {
    setRows((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((p, idx) => ({ ...p, table: idx + 1 }))
    );
  };

  const handleSave = () => {
    setError(null);
    const used = new Set<string>();
    const cleaned: LocalPair[] = [];

    for (const row of rows) {
      const a = row.a_id;
      const b = row.b_id;

      if (!a && !b) continue;
      if (!a && b) {
        setError("Each non-empty table must have Player A.");
        return;
      }
      if (a && b && a === b) {
        setError("A player cannot be paired against themselves.");
        return;
      }
      if (a && used.has(a)) {
        setError("Each player can only appear in one pairing.");
        return;
      }
      if (b && used.has(b)) {
        setError("Each player can only appear in one pairing.");
        return;
      }
      if (!a) continue;

      used.add(a);
      if (b) used.add(b);
      cleaned.push(row);
    }

    if (!cleaned.length) {
      setError("Provide at least one non-empty table.");
      return;
    }

    const normalized = cleaned.map((p, idx) => ({
      ...p,
      table: idx + 1,
    }));

    onSave(normalized);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>✏️ Edit Pairings</h2>
          <button onClick={onCancel} className="secondary">✕ Close</button>
        </div>

        {error && (
          <div style={{
            padding: 12,
            marginBottom: 16,
            border: '2px solid #dc2626',
            borderRadius: 8,
            background: 'rgba(220, 38, 38, 0.1)',
            color: '#fca5a5'
          }}>
            {error}
          </div>
        )}

        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Table</th>
                <th>Player A</th>
                <th>Player B (optional / BYE)</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                    {row.table}
                  </td>
                  <td>
                    <select
                      value={row.a_id}
                      onChange={(e) => updateRow(idx, "a_id", e.target.value)}
                    >
                      <option value="">— empty —</option>
                      {sortedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.b_id ?? ""}
                      onChange={(e) => updateRow(idx, "b_id", e.target.value)}
                    >
                      <option value="">— BYE / empty —</option>
                      {sortedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => removeRow(idx)}
                      className="secondary"
                      style={{ fontSize: 12, padding: '6px 12px' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={addRow} className="secondary">+ Add table</button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={onCancel} className="secondary">Cancel</button>
            <button onClick={handleSave} className="success">💾 Save pairings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
