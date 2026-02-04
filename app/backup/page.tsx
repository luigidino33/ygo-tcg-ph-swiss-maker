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

  const nameToId = useMemo(() => {
    const map = new Map<string, string>();
    (players || []).forEach((p) => map.set(p.name, p.id));
    return map;
  }, [players]);

  const initialManualPairs: LocalPair[] = useMemo(() => {
    if (!pairs.length) return [];
    return pairs.map((p) => ({
      table: p.table,
      a_id: nameToId.get(p.a) || "",
      b_id: p.b === "BYE" ? null : nameToId.get(p.b) || "",
    }));
  }, [pairs, nameToId]);

  const handleSavePairings = async (newPairs: LocalPair[]) => {
    if (!tid) return;
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/edit-pairings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: newPairs }),
      });
      setPairs(res.pairs || []);
      setResults({});
      alert("✅ Pairings updated.");
    } catch (e) {
      console.error(e);
      alert(`Edit pairings failed: ${errMsg(e)}`);
    } finally {
      setShowPairEditor(false);
    }
  };

  return (
    <main>
      <h1>🃏 YGO TCG PH - KTS Swiss</h1>

      {!tid ? (
        <>
          <section
            style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}
          >
            <h3>Create Tournament</h3>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                Name:
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%" }}
                />
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
                  placeholder={"Mario\nLuigi\nYoshi"}
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
            <div
              style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
            >
              <strong>Tournament ID:</strong>
              <code>{tid}</code>
              <button onClick={forgetTournament} style={{ marginLeft: 8 }}>
                Forget
              </button>
            </div>
            {info && (
              <p style={{ marginTop: 8 }}>
                <b>{info.name}</b> — Round <b>{info.round}</b> /{" "}
                <b>{info.total_rounds}</b>
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button onClick={pairNext} disabled={!canPairMore || pairing}>
                {pairing ? "Pairing..." : "Pair Next Round"}
              </button>
              <button onClick={finalizeRound} disabled={!pairs.length || finalizing}>
                {finalizing ? "Finalizing..." : "Finalize Round"}
              </button>
              <button
                onClick={async () => {
                  if (!tid) return;
                  if (
                    !confirm(
                      "⚠️ Restart current round pairings? This will erase existing tables.",
                    )
                  )
                    return;
                  try {
                    const res = await fetchJSON(
                      `/api/tournaments/${tid}/restart-round`,
                      { method: "POST" },
                    );
                    if (!res.pairs) throw new Error(res.message || "Restart failed");
                    setPairs(res.pairs || []);
                    setResults({});
                    const i = await fetchJSON(`/api/tournaments/${tid}`);
                    setInfo(i);
                    setPlayers(i.players || []);
                    const s = await fetchJSON(`/api/tournaments/${tid}/standings`);
                    setStandings(s.standings);
                    alert("✅ Round pairings have been restarted.");
                  } catch (e) {
                    console.error(e);
                    alert(`Restart failed: ${errMsg(e)}`);
                  }
                }}
                style={{ background: "#fef6e4", border: "1px solid #f2b705", color: "#000" }}
                disabled={!pairs.length}
              >
                🔁 Restart Pairings
              </button>
              <button onClick={() => setShowPairEditor(true)} disabled={!players.length}>
                ✏️ Edit Pairings
              </button>
              <button onClick={() => setShowEdit((v) => !v)} disabled={!pairs.length}>
                📝 Edit Result
              </button>
            </div>

            {showEdit && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Edit a Result</div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Table</div>
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
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Result</div>
                    <select
                      value={editResult}
                      onChange={(e) => setEditResult(e.target.value)}
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="A">A wins</option>
                      <option value="B">B wins</option>
                      <option value="DRAW">DRAW</option>
                      <option value="BYE">BYE</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={editResultSave} disabled={!editMatchId}>
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setShowEdit(false);
                        setEditMatchId("");
                        setEditResult("PENDING");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
          >
            <div>
              <h3>Current Pairings</h3>
              {!pairs.length ? (
                <p style={{ color: "#777" }}>
                  No active pairings. Click <b>Pair Next Round</b>.
                </p>
              ) : (
                <div>
                  {pairs.map((p) => (
                    <div
                      key={p.match_id}
                      style={{
                        border: "1px solid #ddd",
                        padding: 12,
                        borderRadius: 12,
                        margin: "8px 0",
                      }}
                    >
                      <b>Table {p.table}</b>
                      <div>
                        {p.a} vs {p.b}
                      </div>
                      {p.b === "BYE" ? (
                        <div style={{ color: "#555", fontStyle: "italic" }}>
                          BYE is auto-recorded.
                        </div>
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
                        {["Rank", "Player", "Pts", "MW%", "OMW%", "OOMW%", "DDD", "KTS"].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                border: "1px solid #ddd",
                                padding: 8,
                                background: "#f7f7f7",
                                textAlign: "left",
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((r) => (
                        <tr key={`${r.rank}-${r.player}`}>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.rank}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.player}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.pts}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.mw.toFixed(1)}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.omw.toFixed(1)}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.oomw.toFixed(1)}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.ddd}
                          </td>
                          <td style={{ border: "1px solid #ddd", padding: 8 }}>
                            {r.kts}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {showPairEditor && (
            <ManualPairingEditor
              players={players}
              initial={initialManualPairs}
              onCancel={() => setShowPairEditor(false)}
              onSave={handleSavePairings}
            />
          )}
        </>
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
      : [
          {
            table: 1,
            a_id: "",
            b_id: null,
          },
        ],
  );
  const [error, setError] = useState<string | null>(null);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
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
      {
        table: prev.length + 1,
        a_id: "",
        b_id: null,
      },
    ]);
  };

  const removeRow = (index: number) => {
    setRows((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((p, idx) => ({ ...p, table: idx + 1 })),
    );
  };

  const handleSave = () => {
    setError(null);
    const used = new Set<string>();
    const cleaned: LocalPair[] = [];

    for (const row of rows) {
      const a = row.a_id;
      const b = row.b_id;

      if (!a && !b) {
        continue; // completely blank row
      }
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

    // Normalize table numbers 1..N
    const normalized = cleaned.map((p, idx) => ({
      ...p,
      table: idx + 1,
    }));

    onSave(normalized);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 16,
          maxWidth: 800,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Edit Pairings (current round)</h2>
          <button onClick={onCancel}>✕ Close</button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 8,
              padding: 8,
              borderRadius: 8,
              border: "1px solid #fca5a5",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#f7f7f7" }}>
              <tr>
                <th style={{ padding: 6, borderBottom: "1px solid #ddd", width: 60 }}>Table</th>
                <th style={{ padding: 6, borderBottom: "1px solid #ddd" }}>Player A</th>
                <th style={{ padding: 6, borderBottom: "1px solid #ddd" }}>Player B (optional / BYE)</th>
                <th style={{ padding: 6, borderBottom: "1px solid #ddd", width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ padding: 6, borderTop: "1px solid #eee", textAlign: "center" }}>
                    {row.table}
                  </td>
                  <td style={{ padding: 6, borderTop: "1px solid #eee" }}>
                    <select
                      value={row.a_id}
                      onChange={(e) => updateRow(idx, "a_id", e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">— empty —</option>
                      {sortedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 6, borderTop: "1px solid #eee" }}>
                    <select
                      value={row.b_id ?? ""}
                      onChange={(e) => updateRow(idx, "b_id", e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">— BYE / empty —</option>
                      {sortedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    style={{
                      padding: 6,
                      borderTop: "1px solid #eee",
                      textAlign: "center",
                    }}
                  >
                    <button
                      onClick={() => removeRow(idx)}
                      style={{ fontSize: 12, color: "#b91c1c" }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            alignItems: "center",
          }}
        >
          <button onClick={addRow}>+ Add table</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={handleSave}>Save pairings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
