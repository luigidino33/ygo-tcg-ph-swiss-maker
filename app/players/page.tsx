"use client";

import { useEffect, useMemo, useState } from "react";

// ── Pie chart with archetype images & "Others" grouping ──────────────────────
type PieSlice = { label: string; count: number; color: string; imageUrl?: string | null };

function ArchetypePieChart({ metagame, archImages }: { metagame: MetagameEntry[]; archImages: Record<string, string | null> }) {
  // Group <5% into "Others"
  const total = metagame.reduce((s, m) => s + m.count, 0);
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
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 110;
  const innerR = 60; // donut
  const imgR = outerR + 40; // where images sit

  let cumAngle = -Math.PI / 2;
  const slices = major.map((s) => {
    const angle = (s.count / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const midAngle = (startAngle + endAngle) / 2;

    // Donut arc path
    const x1o = cx + outerR * Math.cos(startAngle);
    const y1o = cy + outerR * Math.sin(startAngle);
    const x2o = cx + outerR * Math.cos(endAngle);
    const y2o = cy + outerR * Math.sin(endAngle);
    const x1i = cx + innerR * Math.cos(endAngle);
    const y1i = cy + innerR * Math.sin(endAngle);
    const x2i = cx + innerR * Math.cos(startAngle);
    const y2i = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M${x1o},${y1o} A${outerR},${outerR} 0 ${largeArc},1 ${x2o},${y2o} L${x1i},${y1i} A${innerR},${innerR} 0 ${largeArc},0 ${x2i},${y2i} Z`;

    // Image position
    const imgX = cx + imgR * Math.cos(midAngle);
    const imgY = cy + imgR * Math.sin(midAngle);
    // Line from outer edge to image
    const lineX1 = cx + (outerR + 5) * Math.cos(midAngle);
    const lineY1 = cy + (outerR + 5) * Math.sin(midAngle);
    const lineX2 = cx + (imgR - 18) * Math.cos(midAngle);
    const lineY2 = cy + (imgR - 18) * Math.sin(midAngle);

    return { ...s, d, midAngle, imgX, imgY, lineX1, lineY1, lineX2, lineY2, angle };
  });

  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Donut slices */}
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} stroke="#0c1445" strokeWidth={1.5} />
        ))}
        {/* Images + lines for major slices */}
        {slices.map((s, i) => {
          if (s.label === "Others" || s.angle < 0.15) return null; // skip tiny slices and Others
          return (
            <g key={`img-${i}`}>
              <line x1={s.lineX1} y1={s.lineY1} x2={s.lineX2} y2={s.lineY2} stroke={s.color} strokeWidth={1.5} opacity={0.7} />
              {s.imageUrl ? (
                <>
                  <clipPath id={`clip-pie-${i}`}>
                    <circle cx={s.imgX} cy={s.imgY} r={16} />
                  </clipPath>
                  <circle cx={s.imgX} cy={s.imgY} r={17} fill={s.color} />
                  <image
                    href={s.imageUrl}
                    x={s.imgX - 16}
                    y={s.imgY - 16}
                    width={32}
                    height={32}
                    clipPath={`url(#clip-pie-${i})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </>
              ) : (
                <>
                  <circle cx={s.imgX} cy={s.imgY} r={14} fill={s.color} opacity={0.3} />
                  <text x={s.imgX} y={s.imgY + 4} textAnchor="middle" fontSize={8} fill="#e8eaf6" fontWeight="bold">
                    {s.label.slice(0, 3)}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {/* Center text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fill="#90caf9" fontWeight="bold">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9} fill="#546e7a">entries</text>
      </svg>
    </div>
  );
}

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
  topped: number;
  conversion: number;
  avg_placement: number;
  tier: string;
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

// Sort arrow indicator
function SortArrow({ column, sortKey, sortDir }: { column: string; sortKey: string; sortDir: "asc" | "desc" }) {
  if (column !== sortKey) return <span style={{ color: "#546e7a", marginLeft: 2 }}>↕</span>;
  return <span style={{ color: "#64b5f6", marginLeft: 2 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
}

export default function PlayersPage() {
  const [tab, setTab] = useState<"history" | "leaderboard" | "metagame">("history");
  const [history, setHistory] = useState<TournamentHistoryEntry[]>([]);
  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [metagame, setMetagame] = useState<MetagameEntry[]>([]);
  const [archImages, setArchImages] = useState<Record<string, string | null>>({});
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
        const entries = m.metagame || [];
        setMetagame(entries);
        // Batch fetch archetype images
        const names = entries.map((e: MetagameEntry) => e.archetype).filter((a: string) => a !== "Unknown");
        if (names.length > 0) {
          fetch("/api/archetype-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archetypes: names.slice(0, 30) }),
          }).then(r => r.json()).then(d => setArchImages(d.images || {})).catch(() => {});
        }
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
          <h1>YGO TCG PH Tournament App</h1>
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
            style={{ flex: 1, minWidth: 0 }}
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
          {tab === "metagame" && <MetagameTab metagame={metagame} archImages={archImages} />}
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

type LeaderSortKey = "wins" | "losses" | "win_rate" | "tournaments" | "avg_omw" | "name";

function LeaderboardTab({ players }: { players: PlayerStat[] }) {
  const [sortKey, setSortKey] = useState<LeaderSortKey>("wins");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: LeaderSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...players];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [players, sortKey, sortDir]);

  if (players.length === 0) {
    return <div className="card"><p style={{ color: "#94a3b8" }}>No player data yet.</p></div>;
  }

  const thStyle = (key: LeaderSortKey, w: number): React.CSSProperties => ({
    width: w,
    cursor: "pointer",
    userSelect: "none",
  });

  return (
    <div className="card">
      <h2>All-Time Leaderboard</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th style={thStyle("name", 0)} onClick={() => toggleSort("name")}>
                Player <SortArrow column="name" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("tournaments", 60)} onClick={() => toggleSort("tournaments")}>
                T <SortArrow column="tournaments" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("wins", 60)} onClick={() => toggleSort("wins")}>
                W <SortArrow column="wins" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("losses", 60)} onClick={() => toggleSort("losses")}>
                L <SortArrow column="losses" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("win_rate", 80)} onClick={() => toggleSort("win_rate")}>
                Win% <SortArrow column="win_rate" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("avg_omw", 80)} onClick={() => toggleSort("avg_omw")}>
                OMW% <SortArrow column="avg_omw" sortKey={sortKey} sortDir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
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

type MetaSortKey = "tier" | "archetype" | "count" | "share" | "win_rate" | "conversion" | "avg_placement";

const TIER_ORDER: Record<string, number> = { "Tier 1": 0, "Tier 2": 1, "Rogue": 2 };

function MetagameTab({ metagame, archImages }: { metagame: MetagameEntry[]; archImages: Record<string, string | null> }) {
  const [sortKey, setSortKey] = useState<MetaSortKey>("tier");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: MetaSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default direction: asc for tier/archetype/avg_placement, desc for everything else
      setSortDir(key === "tier" || key === "archetype" || key === "avg_placement" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...metagame];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "tier") {
        cmp = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
        if (cmp === 0) cmp = b.conversion - a.conversion; // secondary: conversion desc
      } else if (sortKey === "archetype") {
        cmp = a.archetype.localeCompare(b.archetype);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [metagame, sortKey, sortDir]);

  if (metagame.length === 0) {
    return (
      <div className="card">
        <p style={{ color: "#94a3b8" }}>No deck data yet. Tag player decks in the admin panel first.</p>
      </div>
    );
  }

  const thStyle = (key: MetaSortKey, w: number): React.CSSProperties => ({
    width: w,
    cursor: "pointer",
    userSelect: "none",
  });

  return (
    <div className="card">
      <h2>Top Archetypes</h2>

      {/* Pie chart with archetype images */}
      <ArchetypePieChart metagame={metagame} archImages={archImages} />

      {/* Stats table */}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th style={thStyle("archetype", 0)} onClick={() => toggleSort("archetype")}>
                Archetype <SortArrow column="archetype" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("tier", 50)} onClick={() => toggleSort("tier")}>
                Tier <SortArrow column="tier" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("count", 50)} onClick={() => toggleSort("count")}>
                Count <SortArrow column="count" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("share", 60)} onClick={() => toggleSort("share")}>
                Share <SortArrow column="share" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={{ width: 70 }}>Record</th>
              <th style={thStyle("win_rate", 60)} onClick={() => toggleSort("win_rate")}>
                Win% <SortArrow column="win_rate" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={{ width: 80 }}>Top Cut</th>
              <th style={thStyle("conversion", 70)} onClick={() => toggleSort("conversion")}>
                Conv% <SortArrow column="conversion" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th style={thStyle("avg_placement", 60)} onClick={() => toggleSort("avg_placement")}>
                Avg # <SortArrow column="avg_placement" sortKey={sortKey} sortDir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const tierColor = m.tier === "Tier 1" ? "#81c784" : m.tier === "Tier 2" ? "#ffb74d" : "#90caf9";
              const imgUrl = archImages[m.archetype];
              return (
                <tr key={m.archetype}>
                  <td style={{ textAlign: "center" }}>
                    {imgUrl ? (
                      <img src={imgUrl} alt={m.archetype} style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover", border: `2px solid ${PIE_COLORS[i % PIE_COLORS.length]}` }} />
                    ) : (
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block" }} />
                    )}
                  </td>
                  <td style={{ fontWeight: "bold" }}>{m.archetype}</td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: "bold", color: tierColor, background: `${tierColor}22`, padding: "2px 6px", borderRadius: 4, border: `1px solid ${tierColor}44` }}>
                      {m.tier}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>{m.count}</td>
                  <td style={{ textAlign: "center" }}>{m.share}%</td>
                  <td style={{ textAlign: "center" }}>{m.wins}W-{m.losses}L</td>
                  <td style={{ textAlign: "center", fontWeight: "bold", color: m.win_rate >= 50 ? "#81c784" : "#ef5350" }}>
                    {m.win_rate}%
                  </td>
                  <td style={{ textAlign: "center" }}>{m.topped}/{m.count}</td>
                  <td style={{ textAlign: "center", fontWeight: "bold", color: m.conversion >= 30 ? "#81c784" : m.conversion >= 15 ? "#ffb74d" : "#ef5350" }}>
                    {m.conversion}%
                  </td>
                  <td style={{ textAlign: "center", color: "#90caf9" }}>{m.avg_placement}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
