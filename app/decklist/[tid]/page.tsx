"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Card = {
  id: number;
  name: string;
  type: string;
  race?: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  desc: string;
  ban?: string | null;
  extra: boolean;
  img: number;
};
type Section = "main" | "extra" | "side";
type Counts = Record<number, number>;
type Deck = Record<Section, Counts>;
type RosterPlayer = { id: string; name: string; submitted: boolean };
type Status = { enabled: boolean; locked: boolean; name: string; players: RosterPlayer[] };

const EMPTY_DECK: Deck = { main: {}, extra: {}, side: {} };
const LIMITS: Record<Section, { min: number; max: number }> = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
};
const SECTION_LABEL: Record<Section, string> = { main: "Main Deck", extra: "Extra Deck", side: "Side Deck" };

const TYPE_OPTIONS = [
  "Normal Monster", "Effect Monster", "Flip Effect Monster", "Tuner Monster", "Union Effect Monster",
  "Spirit Monster", "Gemini Monster", "Toon Monster", "Ritual Monster", "Fusion Monster", "Spell Card", "Trap Card",
];
const ATTRIBUTE_OPTIONS = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"];
const SUBTYPE_OPTIONS = {
  "Spell / Trap": ["Normal", "Continuous", "Equip", "Quick-Play", "Field", "Ritual", "Counter"],
  Monster: [
    "Aqua", "Beast", "Beast-Warrior", "Dinosaur", "Dragon", "Fairy", "Fiend", "Fish", "Insect", "Machine",
    "Plant", "Pyro", "Reptile", "Rock", "Sea Serpent", "Spellcaster", "Thunder", "Warrior", "Winged Beast", "Zombie",
  ],
};

const banLimit = (ban?: string | null) =>
  ban === "Forbidden" ? 0 : ban === "Limited" ? 1 : ban === "Semi-Limited" ? 2 : 3;

const banLabel = (ban?: string | null) =>
  ban === "Forbidden" ? "Forbidden" : ban === "Limited" ? "Limited" : ban === "Semi-Limited" ? "Semi-Limited" : "";

const banColor = (ban?: string | null) => (ban === "Forbidden" ? "#e53935" : ban === "Limited" ? "#fb8c00" : "#fdd835");

const kindOrder = (c: Card) => (c.type.includes("Monster") ? 0 : c.type.includes("Spell") ? 1 : 2);

const sumCounts = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) throw new Error(data?.error || text || `${res.status} ${res.statusText}`);
  return data;
}

export default function DecklistPage() {
  const { tid } = useParams<{ tid: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  const [deck, setDeck] = useState<Deck>(EMPTY_DECK);
  const [cards, setCards] = useState<Record<number, Card>>({});
  const [preview, setPreview] = useState<Card | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mobileTab, setMobileTab] = useState<"deck" | "search">("search");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Search state
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [attribute, setAttribute] = useState("");
  const [race, setRace] = useState("");
  const [level, setLevel] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSeq = useRef(0);

  useEffect(() => {
    api(`/api/tournaments/${tid}/decklist-status`)
      .then(setStatus)
      .catch((e) => setLoadError(e.message));
  }, [tid]);

  const draftKey = `goat_draft_${tid}_${playerId}`;

  // Restore draft when a player is chosen
  useEffect(() => {
    if (!started || !playerId) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const saved = JSON.parse(raw);
        setDeck(saved.deck);
        setCards(saved.cards);
      }
    } catch {}
  }, [started, playerId, draftKey]);

  // Save draft
  useEffect(() => {
    if (!started || !playerId || done) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ deck, cards }));
    } catch {}
  }, [deck, cards, started, playerId, draftKey, done]);

  const runSearch = async (offset: number) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError("");
    try {
      const p = new URLSearchParams({ offset: String(offset) });
      if (q.trim()) p.set("q", q.trim());
      if (type) p.set("type", type);
      if (attribute) p.set("attribute", attribute);
      if (race) p.set("race", race);
      if (level) p.set("level", level);
      const data = await api(`/api/cards/search?${p.toString()}`);
      if (seq !== searchSeq.current) return;
      setResults((prev) => (offset === 0 ? data.cards : [...prev, ...data.cards]));
      setTotal(data.total ?? null);
      setNextOffset(data.next_offset ?? null);
    } catch (e: any) {
      if (seq === searchSeq.current) setSearchError(e.message || "Search failed");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // Debounced search whenever filters change
  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => runSearch(0), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, q, type, attribute, race, level]);

  const totalCopies = (id: number) => (deck.main[id] || 0) + (deck.extra[id] || 0) + (deck.side[id] || 0);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 2500);
  };

  const addCard = (card: Card, side = false) => {
    const section: Section = side ? "side" : card.extra ? "extra" : "main";
    const limit = banLimit(card.ban);
    if (limit === 0) return flash(`${card.name} is Forbidden in GOAT.`);
    if (totalCopies(card.id) >= limit) {
      return flash(`${card.name}: max ${limit} ${limit === 1 ? "copy" : "copies"} (including Side Deck).`);
    }
    if (sumCounts(deck[section]) >= LIMITS[section].max) {
      return flash(`${SECTION_LABEL[section]} is full (${LIMITS[section].max}).`);
    }
    setCards((c) => ({ ...c, [card.id]: card }));
    setDeck((d) => ({ ...d, [section]: { ...d[section], [card.id]: (d[section][card.id] || 0) + 1 } }));
  };

  const removeCard = (section: Section, id: number) => {
    setDeck((d) => {
      const next = { ...d[section] };
      if ((next[id] || 0) <= 1) delete next[id];
      else next[id] -= 1;
      return { ...d, [section]: next };
    });
  };

  const clearDeck = () => {
    if (!confirm("Clear the whole deck?")) return;
    setDeck(EMPTY_DECK);
  };

  const sortedTiles = (section: Section) => {
    const entries = Object.entries(deck[section])
      .map(([id, qty]) => ({ card: cards[Number(id)], qty }))
      .filter((e) => e.card)
      .sort((a, b) => kindOrder(a.card) - kindOrder(b.card) || a.card.name.localeCompare(b.card.name));
    return entries.flatMap((e) => Array.from({ length: e.qty }, (_, i) => ({ card: e.card, key: `${e.card.id}-${i}` })));
  };

  const mainCount = sumCounts(deck.main);
  const extraCount = sumCounts(deck.extra);
  const sideCount = sumCounts(deck.side);
  const mainBreakdown = useMemo(() => {
    const b = { Monster: 0, Spell: 0, Trap: 0 };
    for (const [id, qty] of Object.entries(deck.main)) {
      const c = cards[Number(id)];
      if (!c) continue;
      b[c.type.includes("Monster") ? "Monster" : c.type.includes("Spell") ? "Spell" : "Trap"] += qty;
    }
    return b;
  }, [deck.main, cards]);

  const problems: string[] = [];
  if (mainCount < LIMITS.main.min) problems.push(`Main Deck needs at least ${LIMITS.main.min} cards (${mainCount}).`);

  const submit = async () => {
    if (problems.length) return;
    const player = status?.players.find((p) => p.id === playerId);
    if (!confirm(`Submit this decklist for ${player?.name}? It cannot be changed afterwards without the organizer.`)) return;
    setSubmitting(true);
    try {
      const toList = (c: Counts) => Object.entries(c).map(([id, qty]) => ({ id: Number(id), qty }));
      await api(`/api/tournaments/${tid}/decklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          main: toList(deck.main),
          extra: toList(deck.extra),
          side: toList(deck.side),
        }),
      });
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setDone(true);
    } catch (e: any) {
      alert(`Could not submit: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Gate screens ──
  if (loadError || !status) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 60 }}>
        <div className="card">
          <h1>GOAT Decklist</h1>
          <p>{loadError ? `Could not load tournament: ${loadError}` : "Loading..."}</p>
        </div>
      </div>
    );
  }

  if (!status.enabled || status.locked) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 60 }}>
        <div className="card">
          <h1>GOAT Decklist</h1>
          <p>
            {!status.enabled
              ? "Decklist submission isn't enabled for this tournament."
              : "Decklist submission is closed because the tournament has started."}
          </p>
        </div>
      </div>
    );
  }

  const player = status.players.find((p) => p.id === playerId);

  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 60 }}>
        <div className="card">
          <h1>Decklist Submitted</h1>
          <p style={{ marginBottom: 8 }}>
            Thanks, {player?.name}! Your decklist ({mainCount} Main / {extraCount} Extra / {sideCount} Side) has been
            sent to the organizer.
          </p>
          <p style={{ color: "#90caf9", fontSize: 13 }}>Decklists are only visible to the tournament organizer.</p>
        </div>
      </div>
    );
  }

  if (!started) {
    const open = status.players.filter((p) => !p.submitted);
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 60 }}>
        <div className="card">
          <h1>GOAT Decklist</h1>
          <p style={{ marginBottom: 16, color: "#cbd5e1" }}>{status.name}</p>
          <label>Select your name</label>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">-- choose --</option>
            {status.players.map((p) => (
              <option key={p.id} value={p.id} disabled={p.submitted}>
                {p.name}
                {p.submitted ? " (submitted)" : ""}
              </option>
            ))}
          </select>
          {open.length === 0 && (
            <p style={{ color: "#90caf9", fontSize: 13, marginBottom: 12 }}>Everyone has already submitted a decklist.</p>
          )}
          <button disabled={!playerId} onClick={() => setStarted(true)} style={{ width: "100%" }}>
            Build Deck
          </button>
          <p style={{ color: "#90caf9", fontSize: 12, marginTop: 12 }}>
            Cards, GOAT banlist and limits are enforced. Once submitted, only the organizer can see or reset your list.
          </p>
        </div>
      </div>
    );
  }

  // ── Builder ──
  const renderSection = (section: Section) => {
    const tiles = sortedTiles(section);
    const count = sumCounts(deck[section]);
    const bad = section === "main" ? count < LIMITS.main.min : false;
    return (
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: bad ? "#ef9a9a" : "#e8eaf6" }}>
            {SECTION_LABEL[section]} ({count}
            {section === "main" ? `/${LIMITS.main.min}-${LIMITS.main.max}` : `/${LIMITS[section].max}`})
          </strong>
          {section === "main" && (
            <span style={{ fontSize: 12, color: "#90caf9" }}>
              {mainBreakdown.Monster} Monsters / {mainBreakdown.Spell} Spells / {mainBreakdown.Trap} Traps
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))", gap: 4, minHeight: 60 }}>
          {tiles.map(({ card, key }) => (
            <div key={key} style={{ position: "relative" }}>
              <img
                src={`/api/card-image/${card.img}`}
                alt={card.name}
                title={card.name}
                loading="lazy"
                onClick={() => setPreview(card)}
                style={{ width: "100%", display: "block", borderRadius: 3, cursor: "pointer", border: card.ban ? `2px solid ${banColor(card.ban)}` : "2px solid transparent" }}
              />
              <button
                aria-label={`Remove ${card.name}`}
                className="gb-remove"
                onClick={() => removeCard(section, card.id)}
              >
                ×
              </button>
            </div>
          ))}
          {tiles.length === 0 && <span style={{ color: "#7986cb", fontSize: 12 }}>Empty</span>}
        </div>
      </div>
    );
  };

  const previewEl = preview && (
            <div
              className={isMobile ? "modal-overlay" : "card"}
              onClick={isMobile ? () => setPreview(null) : undefined}
              style={isMobile ? { alignItems: "flex-end", padding: 0, zIndex: 1050 } : { padding: 12, marginBottom: 12, display: "flex", gap: 12 }}
            >
             <div
              onClick={(e) => e.stopPropagation()}
              style={isMobile
                ? { display: "flex", gap: 12, width: "100%", maxHeight: "85vh", overflow: "auto", padding: "16px 14px calc(16px + env(safe-area-inset-bottom))", background: "linear-gradient(135deg, #1a237e, #283593)", borderTop: "3px solid #64b5f6", borderRadius: "12px 12px 0 0", flexWrap: "wrap" }
                : { display: "flex", gap: 12 }}
             >
              <img src={`/api/card-image/${preview.img}?size=big`} alt={preview.name} style={{ width: 120, alignSelf: "flex-start", borderRadius: 4 }} />
              <div style={{ fontSize: 12, minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 14 }}>{preview.name}</div>
                <div style={{ color: "#90caf9", marginBottom: 6 }}>
                  [{preview.type}
                  {preview.race ? ` / ${preview.race}` : ""}
                  {preview.attribute ? ` / ${preview.attribute}` : ""}
                  {preview.level ? ` / Lv ${preview.level}` : ""}]
                  {preview.atk !== undefined && preview.atk !== null ? ` ${preview.atk}/${preview.def ?? "?"}` : ""}
                </div>
                {preview.ban && (
                  <div style={{ color: banColor(preview.ban), fontWeight: "bold", marginBottom: 6 }}>{banLabel(preview.ban)}</div>
                )}
                <div style={{ maxHeight: isMobile ? 200 : 130, overflow: "auto", whiteSpace: "pre-wrap" }}>{preview.desc}</div>
              </div>
              {isMobile && (
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <button
                    onClick={() => addCard(preview)}
                    disabled={banLimit(preview.ban) === 0}
                    style={{ flex: 1, padding: 12 }}
                  >
                    + {preview.extra ? "Extra" : "Main"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => addCard(preview, true)}
                    disabled={banLimit(preview.ban) === 0}
                    style={{ flex: 1, padding: 12 }}
                  >
                    + Side
                  </button>
                  <button className="secondary" onClick={() => setPreview(null)} style={{ padding: 12 }}>
                    Close
                  </button>
                </div>
              )}
             </div>
            </div>
  );

  const selectStyle = { marginBottom: 0, padding: 8, fontSize: 13 } as const;

  return (
    <main className="gb-root" style={{ maxWidth: 1400, margin: "0 auto" }}>
      <style>{`
        .gb-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
        .gb-tabs { display: none; gap: 8px; margin-bottom: 12px; }
        .gb-search { position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; }
        .gb-bottombar { display: none; }
        .gb-remove { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; padding: 0; border-radius: 50%; font-size: 14px; line-height: 18px; background: #c62828; border: 1px solid #fff; letter-spacing: 0; }
        @media (max-width: 900px) {
          main.gb-root { padding-bottom: 76px; }
          .gb-bottombar {
            display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; gap: 10px; align-items: center;
            padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: #0c1445; border-top: 2px solid #64b5f6;
          }
          .gb-hide-desktop-submit { display: none; }
          .gb-remove { width: 30px; height: 30px; top: -8px; right: -8px; font-size: 18px; line-height: 24px; }
          .gb-toast { bottom: 84px !important; }
          .gb-grid { grid-template-columns: 1fr; }
          .gb-tabs { display: flex; }
          .gb-hide-mobile { display: none; }
          .gb-search { position: static; max-height: none; }
        }
      `}</style>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>GOAT Deck: {player?.name}</h1>
            <span style={{ fontSize: 12, color: "#90caf9" }}>{status.name}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" onClick={clearDeck}>Clear</button>
            <button className="success gb-hide-desktop-submit" onClick={submit} disabled={submitting || problems.length > 0}>
              {submitting ? "Submitting..." : "Submit Decklist"}
            </button>
          </div>
        </div>
        {problems.length > 0 && <p style={{ color: "#ffab91", fontSize: 12, marginTop: 8 }}>{problems.join(" ")}</p>}
      </div>

      {notice && (
        <div
          className="gb-toast"
          role="status"
          style={{
            position: "fixed", left: 12, right: 12, bottom: 24, zIndex: 1100, maxWidth: 420, margin: "0 auto",
            background: "#4e342e", border: "2px solid #ffb74d", color: "#ffe0b2", padding: "10px 14px",
            borderRadius: 8, fontSize: 13, textAlign: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          }}
        >
          {notice}
        </div>
      )}

      {isMobile && previewEl}

      <div className="gb-bottombar">
        <div style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
          <div style={{ fontWeight: "bold", color: mainCount < LIMITS.main.min ? "#ef9a9a" : "#a5d6a7" }}>
            Main {mainCount}/{LIMITS.main.min}-{LIMITS.main.max}
          </div>
          <div style={{ color: "#90caf9" }}>Extra {extraCount} • Side {sideCount}</div>
        </div>
        <button className="success" onClick={submit} disabled={submitting || problems.length > 0} style={{ padding: "12px 18px", fontSize: 13 }}>
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>

      <div className="gb-tabs">
        <button className={mobileTab === "search" ? "" : "secondary"} style={{ flex: 1 }} onClick={() => setMobileTab("search")}>
          Search Cards
        </button>
        <button className={mobileTab === "deck" ? "" : "secondary"} style={{ flex: 1 }} onClick={() => setMobileTab("deck")}>
          My Deck ({mainCount + extraCount + sideCount})
        </button>
      </div>

      <div className="gb-grid">
        <div className={mobileTab === "deck" ? "" : "gb-hide-mobile"}>
          {renderSection("main")}
          {renderSection("extra")}
          {renderSection("side")}
        </div>

        <div className={`gb-search ${mobileTab === "search" ? "" : "gb-hide-mobile"}`}>
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search card name (GOAT card pool)"
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
                <option value="">Any type</option>
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={attribute} onChange={(e) => setAttribute(e.target.value)} style={selectStyle}>
                <option value="">Any attribute</option>
                {ATTRIBUTE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={race} onChange={(e) => setRace(e.target.value)} style={selectStyle}>
                <option value="">Any type / subtype</option>
                {Object.entries(SUBTYPE_OPTIONS).map(([g, opts]) => (
                  <optgroup key={g} label={g}>
                    {opts.map((o) => <option key={`${g}-${o}`} value={o}>{o}</option>)}
                  </optgroup>
                ))}
              </select>
              <select value={level} onChange={(e) => setLevel(e.target.value)} style={selectStyle}>
                <option value="">Any level</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Level {l}</option>)}
              </select>
            </div>
          </div>

          {!isMobile && previewEl}

          <div className="card" style={{ padding: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#90caf9", padding: "4px 6px" }}>
              {searching && results.length === 0 ? "Searching..." : total !== null ? `${total} cards` : ""}
            </div>
            {searchError && <p style={{ color: "#ef9a9a", fontSize: 12, padding: 6 }}>{searchError}</p>}
            {results.map((c) => {
              const inDeck = totalCopies(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => setPreview(c)}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: 6, borderBottom: "1px solid rgba(100,181,246,0.2)", cursor: "pointer" }}
                >
                  <img src={`/api/card-image/${c.img}`} alt="" loading="lazy" style={{ width: 40, borderRadius: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "#90caf9" }}>
                      {c.type}
                      {c.level ? ` • Lv ${c.level}` : ""}
                      {c.ban && <span style={{ color: banColor(c.ban), fontWeight: "bold" }}> • {banLabel(c.ban)}</span>}
                      {inDeck > 0 && <span style={{ color: "#a5d6a7" }}> • x{inDeck} in deck</span>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); addCard(c); }}
                    disabled={banLimit(c.ban) === 0}
                    style={{ padding: "6px 10px", fontSize: 11 }}
                  >
                    + {c.extra ? "Extra" : "Main"}
                  </button>
                  <button
                    className="secondary"
                    onClick={(e) => { e.stopPropagation(); addCard(c, true); }}
                    disabled={banLimit(c.ban) === 0}
                    style={{ padding: "6px 10px", fontSize: 11 }}
                  >
                    + Side
                  </button>
                </div>
              );
            })}
            {results.length === 0 && !searching && !searchError && (
              <p style={{ padding: 8, fontSize: 12, color: "#90caf9" }}>No cards found.</p>
            )}
            {nextOffset !== null && (
              <button className="secondary" onClick={() => runSearch(nextOffset)} disabled={searching} style={{ width: "100%", marginTop: 8 }}>
                {searching ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
