"use client";

import { useEffect, useMemo, useState } from "react";

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
  opponent_deck: string;
  result: string;
  match_id: string;
};

type Player = { id: string; name: string; deck?: string; archetypes?: string[] };

type TournamentHistoryEntry = {
  id: string;
  name: string;
  created_at: string;
  player_count: number;
};

type MetagameEntry = {
  archetype: string;
  count: number;
  share: number;
  wins: number;
  losses: number;
  win_rate: number;
  topped: number;
  conversion: number;
  avg_placement: number;
  tier: string;
};

type PlayerStats = {
  name: string;
  tournaments: number;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  avg_omw: number;
  tournament_results: {
    tournament_id: string;
    tournament_name: string;
    date: string;
    wins: number;
    losses: number;
    rank: number | null;
    total_players: number;
  }[];
};

type TournamentInfo = {
  id: string;
  name: string;
  total_rounds: number;
  round: number;
  players?: Player[];
  dropped?: string[];
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

// Official KDE-US Tournament Policy round count table
function suggestRounds(playerCount: number): number | null {
  if (playerCount < 4) return null;
  if (playerCount <= 8) return 3;
  if (playerCount <= 16) return 4;
  if (playerCount <= 32) return 5;
  if (playerCount <= 64) return 6;
  if (playerCount <= 128) return 7;
  if (playerCount <= 256) return 8;
  if (playerCount <= 512) return 9;
  return 10;
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
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // Check session
  useEffect(() => {
    if (sessionStorage.getItem("admin_authed") === "1") setAuthed(true);
  }, []);

  const doLogin = async () => {
    setPwLoading(true);
    setPwError("");
    try {
      const res = await fetchJSON("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      if (res.ok) {
        sessionStorage.setItem("admin_authed", "1");
        setAuthed(true);
      }
    } catch (e) {
      setPwError(errMsg(e));
    } finally {
      setPwLoading(false);
    }
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 400, margin: "0 auto", paddingTop: 80 }}>
        <div className="card">
          <h1>Admin Login</h1>
          <div>
            <label>Password</label>
            <input
              type="password"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }}
              placeholder="Enter admin password"
            />
          </div>
          {pwError && <p style={{ color: "#ef5350", fontSize: 13, marginBottom: 12 }}>{pwError}</p>}
          <button onClick={doLogin} disabled={pwLoading} style={{ width: "100%" }}>
            {pwLoading ? "Verifying..." : "Login"}
          </button>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <a href="/" style={{ color: "#90caf9", fontSize: 13 }}>Back to Home</a>
          </div>
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
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

  // Match history modal
  const [historyPlayer, setHistoryPlayer] = useState<{ name: string; id: string } | null>(null);
  const [historyData, setHistoryData] = useState<MatchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [pairing, setPairing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [playersText, setPlayersText] = useState("");
  const [name, setName] = useState("BDC Weekly");
  const [rounds, setRounds] = useState(4);
  const [format, setFormat] = useState<"standard" | "retro">("standard");
  const [results, setResults] = useState<Record<string, "A" | "B" | "TIE">>({});

  // Tournament history
  const [history, setHistory] = useState<TournamentHistoryEntry[]>([]);

  // Metagame
  const [metagame, setMetagame] = useState<MetagameEntry[]>([]);
  const [showMetagame, setShowMetagame] = useState(false);
  const [archImages, setArchImages] = useState<Record<string, string | null>>({});

  // Player stats modal (cross-tournament)
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [playerStatsLoading, setPlayerStatsLoading] = useState(false);

  // Deck editing
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deckInput, setDeckInput] = useState("");
  // Archetype add for a specific player
  const [addingArchId, setAddingArchId] = useState<string | null>(null);
  const [archSearchInput, setArchSearchInput] = useState("");
  const [archSuggestions, setArchSuggestions] = useState<string[]>([]);

  // Auto-suggest round count based on player count
  useEffect(() => {
    const count = playersText.split("\n").map(s => s.trim()).filter(Boolean).length;
    const suggested = suggestRounds(count);
    if (suggested !== null) setRounds(suggested);
  }, [playersText]);

  // Load tournament history for home screen
  useEffect(() => {
    if (tid) return;
    fetchJSON("/api/tournament-history")
      .then((d) => setHistory(d.tournaments || []))
      .catch(() => {});
  }, [tid]);

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
        .filter(Boolean)
        .map((s) => s.replace(/^\d+\.\s*/, '').trim()) // Remove leading numbers and dots
        .filter(Boolean); // Filter again in case only numbers were present
      if (!playersList.length) {
        alert("Add at least one player (one per line).");
        return;
      }
      const data = await fetchJSON(`/api/tournaments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, total_rounds: rounds, players: playersList, format }),
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

  const undoFinalize = async () => {
    if (!tid) return;
    if (!confirm("Undo finalize? This will reopen the current round for editing.")) return;
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/undo-finalize`, { method: "POST" });
      if (!res.ok) throw new Error(res.error || res.message || "Undo failed");
      setPairs(res.pairs || []);
      setStandings(res.standings || []);
      setResults({});
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
    } catch (e) {
      console.error(e);
      alert(`Undo failed: ${errMsg(e)}`);
    }
  };

  const dropPlayer = async (playerId: string, playerName: string) => {
    if (!tid) return;
    if (!confirm(`Drop ${playerName} from the tournament? They won't be paired in future rounds.`)) return;
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/drop-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) throw new Error(res.message || "Drop failed");
      setStandings(res.standings || []);
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
    } catch (e) {
      console.error(e);
      alert(`Drop failed: ${errMsg(e)}`);
    }
  };

  const undropPlayer = async (playerId: string, playerName: string) => {
    if (!tid) return;
    if (!confirm(`Reinstate ${playerName} into the tournament?`)) return;
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/undrop-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) throw new Error(res.message || "Undrop failed");
      setStandings(res.standings || []);
      const i = await fetchJSON(`/api/tournaments/${tid}`);
      setInfo(i);
      setPlayers(i.players || []);
    } catch (e) {
      console.error(e);
      alert(`Reinstate failed: ${errMsg(e)}`);
    }
  };

  const showPlayerHistory = async (playerId: string, playerName: string) => {
    if (!tid) return;
    setHistoryPlayer({ id: playerId, name: playerName });
    setHistoryLoading(true);
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

  const saveDeck = async (playerId: string, deck: string, archetypes?: string[]) => {
    if (!tid) return;
    try {
      const body: any = { player_id: playerId, deck };
      if (archetypes !== undefined) body.archetypes = archetypes;
      const res = await fetchJSON(`/api/tournaments/${tid}/set-deck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const detectedArchs = res.archetypes || [];
      setPlayers((prev) =>
        prev.map((p) => (p.id === playerId ? { ...p, deck, archetypes: detectedArchs } : p))
      );
      setEditingDeckId(null);
    } catch (e) {
      alert(`Failed to save deck: ${errMsg(e)}`);
    }
  };

  const removeArchetype = async (playerId: string, archToRemove: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    const updated = (player.archetypes || []).filter(a => a !== archToRemove);
    await saveDeck(playerId, player.deck || "", updated);
  };

  const addArchetype = async (playerId: string, arch: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    const current = player.archetypes || [];
    if (current.includes(arch)) return;
    await saveDeck(playerId, player.deck || "", [...current, arch]);
  };

  const loadMetagame = async () => {
    if (!tid) return;
    setShowMetagame(true);
    try {
      const res = await fetchJSON(`/api/tournaments/${tid}/metagame`);
      const entries = res.metagame || [];
      setMetagame(entries);
      // Batch fetch archetype images
      const names = entries.map((m: MetagameEntry) => m.archetype).filter((a: string) => a !== "Unknown");
      if (names.length > 0) {
        fetchJSON("/api/archetype-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archetypes: names }),
        }).then(d => setArchImages(prev => ({ ...prev, ...(d.images || {}) })))
          .catch(() => {});
      }
    } catch (e) {
      console.error(e);
      setMetagame([]);
    }
  };

  const loadPlayerStats = async (playerName: string) => {
    setPlayerStatsLoading(true);
    setPlayerStats(null);
    try {
      const res = await fetchJSON(`/api/player-stats?name=${encodeURIComponent(playerName)}`);
      setPlayerStats(res);
    } catch (e) {
      console.error(e);
      setPlayerStats(null);
    } finally {
      setPlayerStatsLoading(false);
    }
  };

  const deleteTournament = async (delTid: string, delName: string) => {
    if (!confirm(`Delete "${delName}"? This cannot be undone.`)) return;
    try {
      await fetchJSON(`/api/tournaments/${delTid}`, { method: "DELETE" });
      setHistory((prev) => prev.filter((h) => h.id !== delTid));
    } catch (e) {
      alert(`Delete failed: ${errMsg(e)}`);
    }
  };

  const copyShareLink = () => {
    if (!tid) return;
    const url = `${window.location.origin}/view/${tid}`;
    navigator.clipboard.writeText(url).then(
      () => alert(`Share link copied!\n${url}`),
      () => prompt("Copy this link:", url)
    );
  };

  const exportStandingsImage = () => {
    if (!standings.length || !info) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 900;
    const rowH = 36;
    const headerH = 80;
    const tableHeaderH = 32;
    const footerH = 40;
    const padTop = 24;
    const H = padTop + headerH + tableHeaderH + standings.length * rowH + footerH;

    const canvas = document.createElement("canvas");
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0c1445");
    bg.addColorStop(0.5, "#1a237e");
    bg.addColorStop(1, "#283593");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Title
    let y = padTop;
    ctx.fillStyle = "#e1f5fe";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(info.name || "Tournament", W / 2, y + 30);

    ctx.fillStyle = "#90caf9";
    ctx.font = "14px Segoe UI, sans-serif";
    ctx.fillText(
      `Round ${info.round} of ${info.total_rounds}  \u2022  ${info.players?.length || 0} Duelists`,
      W / 2, y + 55
    );
    y += headerH;

    // Table header
    const cols = [
      { label: "Rank", x: 30, w: 45, align: "center" as CanvasTextAlign },
      { label: "Duelist", x: 80, w: 200, align: "left" as CanvasTextAlign },
      { label: "Pts", x: 290, w: 45, align: "center" as CanvasTextAlign },
      { label: "MW%", x: 345, w: 55, align: "center" as CanvasTextAlign },
      { label: "OMW%", x: 410, w: 55, align: "center" as CanvasTextAlign },
      { label: "OOMW%", x: 475, w: 60, align: "center" as CanvasTextAlign },
      { label: "Deck", x: 545, w: 130, align: "center" as CanvasTextAlign },
      { label: "KTS", x: 685, w: 190, align: "center" as CanvasTextAlign },
    ];

    // Header bar
    const hdrGrad = ctx.createLinearGradient(20, y, 20, y + tableHeaderH);
    hdrGrad.addColorStop(0, "#64b5f6");
    hdrGrad.addColorStop(1, "#90caf9");
    ctx.fillStyle = hdrGrad;
    ctx.beginPath();
    ctx.roundRect(20, y, W - 40, tableHeaderH, 6);
    ctx.fill();

    ctx.fillStyle = "#0c1445";
    ctx.font = "bold 11px Segoe UI, sans-serif";
    for (const col of cols) {
      ctx.textAlign = col.align;
      const tx = col.align === "center" ? col.x + col.w / 2 : col.x;
      ctx.fillText(col.label.toUpperCase(), tx, y + 21);
    }
    y += tableHeaderH;

    // Rows
    const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
    for (const r of standings) {
      // Alternating row bg
      if (r.rank % 2 === 0) {
        ctx.fillStyle = "rgba(100, 181, 246, 0.07)";
        ctx.fillRect(20, y, W - 40, rowH);
      }

      // Rank highlight for top 3
      if (r.rank <= 3) {
        const gold = ["rgba(255,215,0,0.15)", "rgba(192,192,192,0.15)", "rgba(205,127,50,0.15)"];
        ctx.fillStyle = gold[r.rank - 1];
        ctx.fillRect(20, y, W - 40, rowH);
      }

      const opacity = r.dropped ? 0.4 : 1.0;
      ctx.globalAlpha = opacity;

      ctx.font = "bold 14px Segoe UI, sans-serif";
      ctx.fillStyle = "#e8eaf6";
      ctx.textAlign = "center";
      ctx.fillText(`${r.rank}`, cols[0].x + cols[0].w / 2, y + 23);

      ctx.textAlign = "left";
      ctx.fillText(r.player, cols[1].x, y + 23);
      if (r.dropped) {
        ctx.fillStyle = "#ef5350";
        ctx.font = "bold 9px Segoe UI, sans-serif";
        ctx.fillText("DROPPED", cols[1].x + ctx.measureText(r.player).width + 6, y + 23);
      }

      ctx.font = "bold 14px Segoe UI, sans-serif";
      ctx.fillStyle = "#e8eaf6";
      ctx.textAlign = "center";
      ctx.fillText(`${r.pts}`, cols[2].x + cols[2].w / 2, y + 23);

      ctx.font = "13px Segoe UI, sans-serif";
      ctx.fillText(`${r.mw.toFixed(1)}`, cols[3].x + cols[3].w / 2, y + 23);
      ctx.fillText(`${r.omw.toFixed(1)}`, cols[4].x + cols[4].w / 2, y + 23);
      ctx.fillText(`${r.oomw.toFixed(1)}`, cols[5].x + cols[5].w / 2, y + 23);

      const deck = players.find(p => p.id === r.player_id)?.deck || "";
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.fillStyle = deck ? "#e8eaf6" : "#546e7a";
      ctx.fillText(deck || "-", cols[6].x + cols[6].w / 2, y + 23);

      ctx.font = "11px Segoe UI, monospace";
      ctx.fillStyle = "#90caf9";
      ctx.fillText(r.kts, cols[7].x + cols[7].w / 2, y + 23);

      ctx.globalAlpha = 1.0;
      y += rowH;
    }

    // Footer
    ctx.fillStyle = "#546e7a";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("YGO TCG PH Tournament App \u2022 KTS Scoring", W / 2, y + 24);

    // Download
    const link = document.createElement("a");
    link.download = `${(info.name || "tournament").replace(/\s+/g, "_")}_standings.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
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
      await fetchJSON(`/api/tournaments/${tid}/edit-pairings`, {
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
          <h1>⚔️ YGO TCG PH Tournament App</h1>
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
              style={{
                fontSize: 16,
                padding: '16px',
                textAlign: 'center',
                fontWeight: 'bold'
              }}
            />
            {(() => {
              const count = playersText.split("\n").map(s => s.trim()).filter(Boolean).length;
              const suggested = suggestRounds(count);
              if (suggested !== null) {
                return (
                  <p style={{ color: '#90caf9', fontSize: 12, marginTop: 4 }}>
                    Auto-suggested: {suggested} rounds for {count} players (per KDE-US policy)
                  </p>
                );
              }
              return null;
            })()}
          </div>
          <div>
            <label>Format</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setFormat("standard")}
                className={format === "standard" ? "" : "secondary"}
                style={{ flex: 1, fontSize: 13 }}
              >
                Standard
              </button>
              <button
                onClick={() => setFormat("retro")}
                className={format === "retro" ? "" : "secondary"}
                style={{ flex: 1, fontSize: 13 }}
              >
                Retro
              </button>
            </div>
            <p style={{ color: '#90caf9', fontSize: 11, marginTop: 4 }}>
              {format === "retro" ? "Retro: Ties = Draw (1pt each)" : "Standard: Ties = Double Loss (0pt each)"}
            </p>
          </div>
          <div>
            <label>Players (one per line)</label>
            <textarea
              value={playersText}
              onChange={(e) => setPlayersText(e.target.value)}
              rows={10}
              placeholder={"1. Luigi\n2. Michael M.\n3. Mario\n4. joov\n5. Jeric\n6. JL"}
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

        {history.length > 0 && (
          <div className="card">
            <h2>📜 Tournament History</h2>
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
                      {h.player_count} players &bull; {h.created_at ? new Date(h.created_at).toLocaleDateString() : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#64b5f6", fontFamily: "monospace" }}>
                      ID: {h.id}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.setItem("tid", h.id);
                      setTid(h.id);
                      setPairs([]);
                      setResults({});
                    }}
                    style={{ fontSize: 12, padding: "6px 14px" }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteTournament(h.id, h.name)}
                    className="secondary"
                    style={{ fontSize: 12, padding: "6px 14px", color: "#ef5350" }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
              <>
                <p style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 500 }}>
                  Round {info.round} of {info.total_rounds} • {info.players?.length || 0} Duelists • {(info as any).format === "retro" ? "🕹️ Retro" : "⚔️ Standard"}
                </p>
                <p style={{ color: '#90caf9', fontSize: 12, fontFamily: 'monospace', marginTop: 4 }}>
                  Tournament ID: {info.id}
                </p>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={copyShareLink} className="secondary">
              🔗 Share Link
            </button>
            <button onClick={exportStandingsImage} disabled={!standings.length} className="secondary">
              📸 Export Standings
            </button>
            <button onClick={forgetTournament} className="secondary">
              ⚙️ Close Tournament
            </button>
          </div>
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
          <button onClick={undoFinalize} disabled={pairs.length > 0 || !info?.round} className="secondary">
            ↩️ Undo Finalize
          </button>
          <button onClick={() => setShowPairEditor(true)} disabled={!players.length} className="secondary">
            ✏️ Edit Pairings
          </button>
          <button onClick={() => setShowEdit((v) => !v)} disabled={!pairs.length} className="secondary">
            📝 Edit Result
          </button>
          <button onClick={loadMetagame} className="secondary">
            📊 Metagame
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
                  <option value="TIE">{(info as any)?.format === "retro" ? "Draw" : "Double Loss"}</option>
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
        <>
          {/* Compact Summary View - Mobile Optimized */}
          <div className="card">
            <h2>📋 Match Summary</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pairs.map((p) => {
                const isBye = p.b === "BYE";
                const currentResult = results[p.match_id];
                const isCompleted = !!currentResult || isBye;
                
                return (
                  <div 
                    key={`summary-${p.match_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px',
                      background: isCompleted 
                        ? 'linear-gradient(135deg, rgba(56, 142, 60, 0.15), rgba(76, 175, 80, 0.08))'
                        : 'rgba(26, 35, 126, 0.4)',
                      border: `2px solid ${isCompleted ? '#81c784' : '#5c6bc0'}`,
                      borderRadius: 8,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    {/* Table Number */}
                    <div style={{
                      background: 'linear-gradient(135deg, #64b5f6, #90caf9)',
                      color: '#0c1445',
                      fontWeight: 900,
                      fontSize: 16,
                      padding: '6px 12px',
                      borderRadius: 6,
                      minWidth: 45,
                      textAlign: 'center',
                      flexShrink: 0,
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
                    }}>
                      #{p.table}
                    </div>
                    
                    {/* Match Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ 
                        fontSize: 14, 
                        fontWeight: 'bold',
                        color: currentResult === "A" ? '#81c784' : '#e8eaf6',
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {currentResult === "A" && "👑 "}{p.a}
                      </div>
                      <div style={{ 
                        fontSize: 14, 
                        fontWeight: 'bold',
                        color: currentResult === "B" ? '#81c784' : (isBye ? '#94a3b8' : '#e8eaf6'),
                        opacity: isBye ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {currentResult === "B" && "👑 "}{p.b}
                      </div>
                    </div>
                    
                    {/* Status Indicator */}
                    <div style={{ flexShrink: 0 }}>
                      {isCompleted ? (
                        <div style={{
                          background: 'linear-gradient(135deg, #388e3c, #4caf50)',
                          color: '#fff',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5
                        }}>
                          {isBye ? "BYE" : currentResult === "TIE" ? "DBL LOSS" : "DONE"}
                        </div>
                      ) : (
                        <div style={{
                          background: 'rgba(100, 181, 246, 0.2)',
                          color: '#90caf9',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 'bold',
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          border: '1px solid rgba(100, 181, 246, 0.3)'
                        }}>
                          LIVE
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Admin View */}
          <div className="card">
            <h2>🎴 Active Pairings (Admin)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 16 }}>
              {pairs.map((p) => {
                const isBye = p.b === "BYE";
                const currentResult = results[p.match_id];
                const isCompleted = !!currentResult || isBye;
                
                return (
                  <div key={p.match_id} className={`pairing-card ${isCompleted ? 'completed' : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div className="table-number">#{p.table}</div>
                      {isBye && <span style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>Auto Win</span>}
                    </div>
                    
                    <div style={{ margin: '16px 0' }}>
                      <div className={`player-name ${currentResult === "A" ? "winner" : ""}`}>
                        {currentResult === "A" && "👑 "}
                        {p.a}
                      </div>
                      <div style={{ textAlign: 'center', margin: '8px 0' }}>
                        <span className="vs-badge">VS</span>
                      </div>
                      <div className={`player-name ${currentResult === "B" ? "winner" : ""}`} style={{ 
                        opacity: isBye ? 0.5 : 1,
                        fontStyle: isBye ? 'italic' : 'normal'
                      }}>
                        {currentResult === "B" && "👑 "}
                        {p.b}
                      </div>
                    </div>
                    
                    {!isBye && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                        <button
                          className={`result-btn ${currentResult === "A" ? "selected" : ""}`}
                          onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "A" }))}
                        >
                          ⚔️ {p.a.split(' ')[0]} Wins
                        </button>
                        <button
                          className={`result-btn tie ${currentResult === "TIE" ? "selected" : ""}`}
                          onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "TIE" }))}
                        >
                          {(info as any)?.format === "retro" ? "🤝 Draw" : "💀 Double Loss"}
                        </button>
                        <button
                          className={`result-btn ${currentResult === "B" ? "selected" : ""}`}
                          onClick={() => setResults((prev) => ({ ...prev, [p.match_id]: "B" }))}
                        >
                          ⚔️ {p.b.split(' ')[0]} Wins
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
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
                  <th style={{ width: 140 }}>Deck</th>
                  <th style={{ width: 80 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r) => (
                  <tr key={r.rank} className={`rank-${r.rank}`} style={{ opacity: r.dropped ? 0.5 : 1 }}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 18 }}>
                      {r.rank === 1 && '🥇 '}
                      {r.rank === 2 && '🥈 '}
                      {r.rank === 3 && '🥉 '}
                      {r.rank}
                    </td>
                    <td>
                      <span
                        onClick={() => showPlayerHistory(r.player_id, r.player)}
                        style={{ fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        title="View match history"
                      >
                        {r.player}
                      </span>
                      {r.dropped && <span style={{ color: '#ef5350', fontSize: 11, marginLeft: 8 }}>DROPPED</span>}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 16 }}>
                      {r.pts}
                    </td>
                    <td style={{ textAlign: 'center' }}>{r.mw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center' }}>{r.omw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center' }}>{r.oomw.toFixed(1)}</td>
                    <td style={{ textAlign: 'center', fontSize: 12 }}>{r.ddd}</td>
                    <td style={{ textAlign: 'center', fontSize: 12 }}>{r.kts}</td>
                    <td style={{ textAlign: 'left', minWidth: 160 }}>
                      {/* Deck name */}
                      {editingDeckId === r.player_id ? (
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          <input
                            value={deckInput}
                            onChange={(e) => setDeckInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveDeck(r.player_id, deckInput);
                              if (e.key === "Escape") setEditingDeckId(null);
                            }}
                            placeholder="Deck name"
                            style={{ fontSize: 11, padding: 4, marginBottom: 0, width: 120 }}
                            autoFocus
                          />
                          <button
                            onClick={() => saveDeck(r.player_id, deckInput)}
                            style={{ fontSize: 10, padding: '2px 6px' }}
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            const p = players.find((pl) => pl.id === r.player_id);
                            setDeckInput(p?.deck || "");
                            setEditingDeckId(r.player_id);
                          }}
                          style={{ cursor: 'pointer', fontSize: 12, color: players.find(p => p.id === r.player_id)?.deck ? '#e8eaf6' : '#64b5f6', fontStyle: players.find(p => p.id === r.player_id)?.deck ? 'normal' : 'italic', display: 'block', marginBottom: 2 }}
                          title="Click to edit deck"
                        >
                          {players.find((p) => p.id === r.player_id)?.deck || "Set deck"}
                        </span>
                      )}
                      {/* Archetype tags */}
                      {(() => {
                        const pl = players.find(p => p.id === r.player_id);
                        const archs = pl?.archetypes || [];
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
                            {archs.map(a => (
                              <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'rgba(100,181,246,0.2)', border: '1px solid #5c6bc0', borderRadius: 4, padding: '1px 6px', fontSize: 10, color: '#90caf9' }}>
                                {a}
                                <span
                                  onClick={() => removeArchetype(r.player_id, a)}
                                  style={{ cursor: 'pointer', color: '#ef5350', fontWeight: 'bold', marginLeft: 2 }}
                                  title="Remove archetype"
                                >x</span>
                              </span>
                            ))}
                            {pl?.deck && (
                              addingArchId === r.player_id ? (
                                <div style={{ display: 'inline-flex', gap: 2, position: 'relative' }}>
                                  <input
                                    value={archSearchInput}
                                    onChange={(e) => {
                                      setArchSearchInput(e.target.value);
                                      const q = e.target.value.trim();
                                      if (q.length >= 2) {
                                        fetchJSON(`/api/archetypes?q=${encodeURIComponent(q)}`)
                                          .then(d => setArchSuggestions(d.archetypes || []))
                                          .catch(() => setArchSuggestions([]));
                                      } else {
                                        setArchSuggestions([]);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && archSearchInput.trim()) {
                                        addArchetype(r.player_id, archSearchInput.trim());
                                        setAddingArchId(null);
                                        setArchSearchInput("");
                                        setArchSuggestions([]);
                                      }
                                      if (e.key === "Escape") {
                                        setAddingArchId(null);
                                        setArchSearchInput("");
                                        setArchSuggestions([]);
                                      }
                                    }}
                                    placeholder="Search archetype"
                                    style={{ fontSize: 10, padding: '2px 4px', width: 100, marginBottom: 0 }}
                                    autoFocus
                                  />
                                  {archSuggestions.length > 0 && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, background: '#1a237e', border: '1px solid #5c6bc0', borderRadius: 4, zIndex: 50, maxHeight: 120, overflowY: 'auto', width: 160 }}>
                                      {archSuggestions.map(s => (
                                        <div
                                          key={s}
                                          onClick={() => {
                                            addArchetype(r.player_id, s);
                                            setAddingArchId(null);
                                            setArchSearchInput("");
                                            setArchSuggestions([]);
                                          }}
                                          style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderBottom: '1px solid rgba(92,107,192,0.3)' }}
                                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(100,181,246,0.2)')}
                                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                          {s}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span
                                  onClick={() => { setAddingArchId(r.player_id); setArchSearchInput(""); setArchSuggestions([]); }}
                                  style={{ cursor: 'pointer', fontSize: 10, color: '#64b5f6', border: '1px dashed #5c6bc0', borderRadius: 4, padding: '1px 5px' }}
                                  title="Add archetype tag"
                                >+</span>
                              )
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.dropped ? (
                        <button
                          onClick={() => undropPlayer(r.player_id, r.player)}
                          className="secondary"
                          style={{ fontSize: 10, padding: '3px 8px' }}
                        >
                          Reinstate
                        </button>
                      ) : (
                        <button
                          onClick={() => dropPlayer(r.player_id, r.player)}
                          className="secondary"
                          style={{ fontSize: 10, padding: '3px 8px', color: '#ef5350' }}
                        >
                          Drop
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyPlayer && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2>📜 Match History — {historyPlayer.name}</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    setHistoryPlayer(null);
                    loadPlayerStats(historyPlayer.name);
                  }}
                  className="secondary"
                  style={{ fontSize: 12 }}
                >
                  📈 All-Time Stats
                </button>
                <button onClick={() => setHistoryPlayer(null)} className="secondary">✕ Close</button>
              </div>
            </div>
            {historyLoading ? (
              <p>Loading...</p>
            ) : historyData.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No matches played yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Round</th>
                    <th>Opponent</th>
                    <th>Deck</th>
                    <th style={{ width: 120 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.map((h) => (
                    <tr key={h.match_id}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{h.round}</td>
                      <td>{h.opponent}</td>
                      <td style={{ fontSize: 12, color: h.opponent_deck ? '#e8eaf6' : '#546e7a', fontStyle: h.opponent_deck ? 'normal' : 'italic' }}>
                        {h.opponent_deck || '—'}
                      </td>
                      <td style={{
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: h.result === 'Win' || h.result === 'BYE (Win)' ? '#81c784'
                          : h.result === 'Loss' ? '#ef5350'
                          : (h.result === 'Double Loss' || h.result === 'Draw') ? '#ff9800'
                          : '#90caf9'
                      }}>
                        {h.result}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {(playerStats || playerStatsLoading) && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2>📈 All-Time Stats{playerStats ? ` — ${playerStats.name}` : ""}</h2>
              <button onClick={() => { setPlayerStats(null); setPlayerStatsLoading(false); }} className="secondary">✕ Close</button>
            </div>
            {playerStatsLoading ? (
              <p>Loading cross-tournament data...</p>
            ) : playerStats && playerStats.tournaments === 0 ? (
              <p style={{ color: '#94a3b8' }}>No tournament history found for this player.</p>
            ) : playerStats ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "Tournaments", value: playerStats.tournaments },
                    { label: "Total Wins", value: playerStats.total_wins },
                    { label: "Total Losses", value: playerStats.total_losses },
                    { label: "Win Rate", value: `${playerStats.win_rate}%` },
                    { label: "Avg OMW%", value: `${playerStats.avg_omw}%` },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: 'rgba(26, 35, 126, 0.6)',
                      border: '1px solid #5c6bc0',
                      borderRadius: 8,
                      padding: 12,
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 11, color: '#90caf9', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 4 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <h3>Tournament Results</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Tournament</th>
                      <th style={{ width: 100 }}>Date</th>
                      <th style={{ width: 80 }}>Record</th>
                      <th style={{ width: 80 }}>Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerStats.tournament_results.map((t) => (
                      <tr key={t.tournament_id}>
                        <td style={{ fontWeight: 'bold' }}>{t.tournament_name}</td>
                        <td style={{ textAlign: 'center', fontSize: 12 }}>
                          {t.date ? new Date(t.date).toLocaleDateString() : ""}
                        </td>
                        <td style={{ textAlign: 'center' }}>{t.wins}W-{t.losses}L</td>
                        <td style={{ textAlign: 'center' }}>
                          {t.rank !== null ? `${t.rank}/${t.total_players}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        </div>
      )}

      {showMetagame && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 800 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2>📊 Archetype Breakdown</h2>
              <button onClick={() => setShowMetagame(false)} className="secondary">✕ Close</button>
            </div>
            {metagame.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No deck data yet. Tag player decks in the standings table first.</p>
            ) : (
              <>
                {/* Pie chart with archetype images */}
                {(() => {
                  const PIE_COLORS = ['#64b5f6','#81c784','#ff9800','#ef5350','#ce93d8','#4dd0e1','#ffb74d','#a5d6a7','#f48fb1','#90caf9'];
                  const total = metagame.reduce((s, m) => s + m.count, 0);
                  type PieSlice = { label: string; count: number; color: string; imageUrl?: string | null };
                  const major: PieSlice[] = [];
                  let othersCount = 0;
                  metagame.forEach((m, i) => {
                    const share = total > 0 ? (m.count / total) * 100 : 0;
                    if (share >= 5) {
                      major.push({ label: m.archetype, count: m.count, color: PIE_COLORS[i % PIE_COLORS.length], imageUrl: archImages[m.archetype] });
                    } else {
                      othersCount += m.count;
                    }
                  });
                  if (othersCount > 0) {
                    major.push({ label: "Others", count: othersCount, color: "#546e7a", imageUrl: null });
                  }
                  const size = 320;
                  const cx = size / 2; const cy = size / 2;
                  const outerR = 110; const innerR = 60; const imgR = outerR + 40;
                  let cumAngle = -Math.PI / 2;
                  const slices = major.map((s) => {
                    const angle = (s.count / total) * 2 * Math.PI;
                    const startAngle = cumAngle;
                    cumAngle += angle;
                    const endAngle = cumAngle;
                    const midAngle = (startAngle + endAngle) / 2;
                    const x1o = cx + outerR * Math.cos(startAngle); const y1o = cy + outerR * Math.sin(startAngle);
                    const x2o = cx + outerR * Math.cos(endAngle); const y2o = cy + outerR * Math.sin(endAngle);
                    const x1i = cx + innerR * Math.cos(endAngle); const y1i = cy + innerR * Math.sin(endAngle);
                    const x2i = cx + innerR * Math.cos(startAngle); const y2i = cy + innerR * Math.sin(startAngle);
                    const largeArc = angle > Math.PI ? 1 : 0;
                    const d = `M${x1o},${y1o} A${outerR},${outerR} 0 ${largeArc},1 ${x2o},${y2o} L${x1i},${y1i} A${innerR},${innerR} 0 ${largeArc},0 ${x2i},${y2i} Z`;
                    const imgX = cx + imgR * Math.cos(midAngle); const imgY = cy + imgR * Math.sin(midAngle);
                    const lineX1 = cx + (outerR + 5) * Math.cos(midAngle); const lineY1 = cy + (outerR + 5) * Math.sin(midAngle);
                    const lineX2 = cx + (imgR - 18) * Math.cos(midAngle); const lineY2 = cy + (imgR - 18) * Math.sin(midAngle);
                    return { ...s, d, midAngle, imgX, imgY, lineX1, lineY1, lineX2, lineY2, angle };
                  });
                  return (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        {slices.map((s, i) => (
                          <path key={i} d={s.d} fill={s.color} stroke="#0c1445" strokeWidth={1.5} />
                        ))}
                        {slices.map((s, i) => {
                          if (s.label === "Others" || s.angle < 0.15) return null;
                          return (
                            <g key={`img-${i}`}>
                              <line x1={s.lineX1} y1={s.lineY1} x2={s.lineX2} y2={s.lineY2} stroke={s.color} strokeWidth={1.5} opacity={0.7} />
                              {s.imageUrl ? (
                                <>
                                  <clipPath id={`clip-adm-${i}`}><circle cx={s.imgX} cy={s.imgY} r={16} /></clipPath>
                                  <circle cx={s.imgX} cy={s.imgY} r={17} fill={s.color} />
                                  <image href={s.imageUrl} x={s.imgX - 16} y={s.imgY - 16} width={32} height={32} clipPath={`url(#clip-adm-${i})`} preserveAspectRatio="xMidYMid slice" />
                                </>
                              ) : (
                                <>
                                  <circle cx={s.imgX} cy={s.imgY} r={14} fill={s.color} opacity={0.3} />
                                  <text x={s.imgX} y={s.imgY + 4} textAnchor="middle" fontSize={8} fill="#e8eaf6" fontWeight="bold">{s.label.slice(0, 3)}</text>
                                </>
                              )}
                            </g>
                          );
                        })}
                        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fill="#90caf9" fontWeight="bold">{total}</text>
                        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9} fill="#546e7a">entries</text>
                      </svg>
                    </div>
                  );
                })()}
                {/* Legend + stats table */}
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Archetype</th>
                        <th style={{ width: 50 }}>Tier</th>
                        <th style={{ width: 50 }}>Count</th>
                        <th style={{ width: 60 }}>Share</th>
                        <th style={{ width: 70 }}>Record</th>
                        <th style={{ width: 60 }}>Win%</th>
                        <th style={{ width: 80 }}>Top Cut</th>
                        <th style={{ width: 70 }}>Conv%</th>
                        <th style={{ width: 60 }}>Avg #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metagame.map((m, i) => {
                        const COLORS = ['#64b5f6','#81c784','#ff9800','#ef5350','#ce93d8','#4dd0e1','#ffb74d','#a5d6a7','#f48fb1','#90caf9'];
                        const tierColor = m.tier === 'Tier 1' ? '#81c784' : m.tier === 'Tier 2' ? '#ffb74d' : '#90caf9';
                        const imgUrl = archImages[m.archetype];
                        return (
                          <tr key={m.archetype}>
                            <td style={{ textAlign: 'center', width: 40 }}>
                              {imgUrl ? (
                                <img src={imgUrl} alt={m.archetype} style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', border: `2px solid ${COLORS[i % COLORS.length]}` }} />
                              ) : (
                                <div style={{ width: 14, height: 14, borderRadius: 3, background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                              )}
                            </td>
                            <td style={{ fontWeight: 'bold' }}>{m.archetype}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ fontSize: 10, fontWeight: 'bold', color: tierColor, background: `${tierColor}22`, padding: '2px 6px', borderRadius: 4, border: `1px solid ${tierColor}44` }}>
                                {m.tier}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{m.count}</td>
                            <td style={{ textAlign: 'center' }}>{m.share}%</td>
                            <td style={{ textAlign: 'center' }}>{m.wins}W-{m.losses}L</td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold', color: m.win_rate >= 50 ? '#81c784' : '#ef5350' }}>
                              {m.win_rate}%
                            </td>
                            <td style={{ textAlign: 'center' }}>{m.topped}/{m.count}</td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold', color: m.conversion >= 30 ? '#81c784' : m.conversion >= 15 ? '#ffb74d' : '#ef5350' }}>
                              {m.conversion}%
                            </td>
                            <td style={{ textAlign: 'center', color: '#90caf9' }}>{m.avg_placement}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
