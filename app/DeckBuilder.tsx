"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

export type Card = {
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
export type Section = "main" | "extra" | "side";
export type Counts = Record<number, number>;
export type Deck = Record<Section, Counts>;
export type DeckList = Record<Section, { id: number; qty: number }[]>;
export type SavedDeck = DeckList & { id: string; name: string; updated_at: string };
export type Me = { username: string; player_name: string };

export const EMPTY_DECK: Deck = { main: {}, extra: {}, side: {} };
export const LIMITS: Record<Section, { min: number; max: number }> = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: Infinity }, // GOAT-era Fusion Deck has no size limit
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

export const sumCounts = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
export const toList = (c: Counts) => Object.entries(c).map(([id, qty]) => ({ id: Number(id), qty }));

export async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) throw new Error(data?.error || text || `${res.status} ${res.statusText}`);
  return data;
}

// ── Deck state shared by the tournament page and the standalone deckbuilder ──
export function useDeckState() {
  const [deck, setDeck] = useState<Deck>(EMPTY_DECK);
  const [cards, setCards] = useState<Record<number, Card>>({});
  const [notice, setNotice] = useState("");

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 2500);
  };

  const loadDeckList = async (list: DeckList) => {
    const ids = Array.from(new Set([...list.main, ...list.extra, ...list.side].map((e) => e.id)));
    const data = ids.length ? await api(`/api/cards/by-ids?ids=${ids.join(",")}`) : { cards: [] };
    const byId: Record<number, Card> = {};
    for (const c of data.cards as Card[]) byId[c.id] = c;
    const toCounts = (rows: { id: number; qty: number }[]) => {
      const out: Counts = {};
      for (const r of rows) if (byId[r.id]) out[r.id] = (out[r.id] || 0) + r.qty;
      return out;
    };
    setCards((c) => ({ ...c, ...byId }));
    setDeck({ main: toCounts(list.main), extra: toCounts(list.extra), side: toCounts(list.side) });
  };

  const main = sumCounts(deck.main);
  const extra = sumCounts(deck.extra);
  const side = sumCounts(deck.side);
  return { deck, setDeck, cards, setCards, notice, flash, loadDeckList, counts: { main, extra, side, total: main + extra + side } };
}
export type DeckState = ReturnType<typeof useDeckState>;

// ── Saved decks on the player's account ──
export function useSavedDecks(ds: DeckState, defaultName: () => string, onSaved?: (d: { id: string; name: string }) => void) {
  const [savedDeck, setSavedDeck] = useState<{ id: string; name: string } | null>(null);
  const [myDecks, setMyDecks] = useState<SavedDeck[] | null>(null);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const openMyDecks = async () => {
    setShow(true);
    setMyDecks(null);
    try {
      setMyDecks((await api("/api/me/decks")).decks);
    } catch (e: any) {
      setShow(false);
      alert(`Could not load your decks: ${e.message}`);
    }
  };

  // Save updates the loaded deck; "Save as" (or a first save) asks for a name. Same name = update, new name = copy.
  const saveDeck = async (askName = false) => {
    let name = savedDeck?.name || "";
    if (askName || !savedDeck) {
      const entered = prompt(savedDeck ? "Deck name (same name updates it, a new name saves a copy):" : "Name this deck:", savedDeck?.name || defaultName());
      if (!entered || !entered.trim()) return;
      name = entered.trim();
    }
    setSaving(true);
    try {
      const res = await api("/api/me/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedDeck && name === savedDeck.name ? savedDeck.id : undefined,
          name,
          main: toList(ds.deck.main),
          extra: toList(ds.deck.extra),
          side: toList(ds.deck.side),
        }),
      });
      const saved = { id: res.deck.id, name: res.deck.name };
      setSavedDeck(saved);
      onSaved?.(saved);
      ds.flash(`Saved "${res.deck.name}".`);
    } catch (e: any) {
      alert(`Could not save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const loadSaved = async (d: SavedDeck) => {
    if (ds.counts.total > 0 && savedDeck?.id !== d.id && !confirm(`Replace the current deck with "${d.name}"?`)) return;
    try {
      await ds.loadDeckList(d);
      setSavedDeck({ id: d.id, name: d.name });
      setShow(false);
      ds.flash(`Loaded "${d.name}".`);
    } catch (e: any) {
      alert(`Could not load deck: ${e.message}`);
    }
  };

  const deleteSaved = async (d: SavedDeck) => {
    if (!confirm(`Delete "${d.name}" from My Decks?`)) return;
    try {
      await api(`/api/me/decks/${d.id}`, { method: "DELETE" });
      setMyDecks((list) => (list || []).filter((x) => x.id !== d.id));
      if (savedDeck?.id === d.id) setSavedDeck(null);
    } catch (e: any) {
      alert(`Could not delete deck: ${e.message}`);
    }
  };

  const n = (rows: { qty: number }[]) => rows.reduce((s, r) => s + r.qty, 0);
  const modal = show ? (
    <div className="modal-overlay" onClick={() => setShow(false)}>
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ marginBottom: 0 }}>My Decks</h2>
          <button className="secondary" onClick={() => setShow(false)}>Close</button>
        </div>
        {myDecks === null ? (
          <p style={{ color: "#86b4e6" }}>Loading...</p>
        ) : myDecks.length === 0 ? (
          <p style={{ color: "#86b4e6", fontSize: 13 }}>No saved decks yet. Build a deck and tap Save.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myDecks.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${savedDeck?.id === d.id ? "#7fe0ff" : "rgba(70,160,255,0.35)"}`, borderRadius: 2, background: "rgba(4,22,52,0.6)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "#86b4e6" }}>
                    {n(d.main)} Main / {n(d.extra)} Extra / {n(d.side)} Side • {new Date(d.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => loadSaved(d)} style={{ padding: "6px 16px", fontSize: 12 }}>Load</button>
                <button className="secondary" onClick={() => deleteSaved(d)} style={{ padding: "6px 12px", fontSize: 12, color: "#ff8a80" }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return { savedDeck, setSavedDeck, saving, saveDeck, openMyDecks, modal };
}

type Primary = { label: string; shortLabel: string; onClick: () => void; disabled?: boolean };

export default function DeckBuilder({ state, title, subtitle, actions, notes, primary }: {
  state: DeckState;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  notes?: ReactNode;
  primary?: Primary;
}) {
  const { deck, setDeck, cards, setCards, notice, flash, counts } = state;
  const [preview, setPreview] = useState<Card | null>(null);
  const [mobileTab, setMobileTab] = useState<"deck" | "search">("search");
  const [isMobile, setIsMobile] = useState(false);

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
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  useEffect(() => {
    const t = setTimeout(() => runSearch(0), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, attribute, race, level]);

  const totalCopies = (id: number) => (deck.main[id] || 0) + (deck.extra[id] || 0) + (deck.side[id] || 0);

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

  const sortedTiles = (section: Section) => {
    const entries = Object.entries(deck[section])
      .map(([id, qty]) => ({ card: cards[Number(id)], qty }))
      .filter((e) => e.card)
      .sort((a, b) => kindOrder(a.card) - kindOrder(b.card) || a.card.name.localeCompare(b.card.name));
    return entries.flatMap((e) => Array.from({ length: e.qty }, (_, i) => ({ card: e.card, key: `${e.card.id}-${i}` })));
  };

  const mainBreakdown = useMemo(() => {
    const b = { Monster: 0, Spell: 0, Trap: 0 };
    for (const [id, qty] of Object.entries(deck.main)) {
      const c = cards[Number(id)];
      if (!c) continue;
      b[c.type.includes("Monster") ? "Monster" : c.type.includes("Spell") ? "Spell" : "Trap"] += qty;
    }
    return b;
  }, [deck.main, cards]);

  const renderSection = (section: Section) => {
    const tiles = sortedTiles(section);
    const count = tiles.length;
    const max = LIMITS[section].max;
    const slots = Math.max(section === "main" ? LIMITS.main.min : Number.isFinite(max) ? max : 15, count);
    const short = section === "main" && count < LIMITS.main.min;
    return (
      <div className="md-section">
        <div className="md-section-head">
          <span className="md-section-title">{SECTION_LABEL[section]}</span>
          {section === "main" && (
            <span className="md-breakdown">
              <span><i style={{ background: "#e08a2e" }} />{mainBreakdown.Monster}</span>
              <span><i style={{ background: "#1fa88e" }} />{mainBreakdown.Spell}</span>
              <span><i style={{ background: "#c2478a" }} />{mainBreakdown.Trap}</span>
            </span>
          )}
          <span className="md-count" style={short ? { color: "#ff8a80", borderColor: "#ff8a80" } : undefined}>
            {count}
            {section === "main" ? <small>/{LIMITS.main.min}-{LIMITS.main.max}</small> : Number.isFinite(max) ? <small>/{max}</small> : null}
          </span>
        </div>
        <div className="md-grid">
          {tiles.map(({ card, key }) => (
            <div key={key} className="md-slot md-filled">
              <img src={`/api/card-image/${card.img}`} alt={card.name} title={card.name} loading="lazy" onClick={() => setPreview(card)} />
              {card.ban && banLimit(card.ban) > 0 && (
                <span className="md-ban" style={{ background: banColor(card.ban) }}>{banLimit(card.ban)}</span>
              )}
              <button aria-label={`Remove ${card.name}`} className="gb-remove" onClick={() => removeCard(section, card.id)}>
                ×
              </button>
            </div>
          ))}
          {Array.from({ length: Math.max(0, slots - count) }, (_, i) => (
            <div key={`e${i}`} className="md-slot md-empty" />
          ))}
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
          ? { display: "flex", gap: 12, width: "100%", maxHeight: "85vh", overflow: "auto", padding: "16px 14px calc(16px + env(safe-area-inset-bottom))", background: "linear-gradient(135deg, #06244e, #0c3a74)", borderTop: "3px solid #3aa0ff", borderRadius: "12px 12px 0 0", flexWrap: "wrap" }
          : { display: "flex", gap: 12 }}
      >
        <img src={`/api/card-image/${preview.img}?size=big`} alt={preview.name} style={{ width: 120, alignSelf: "flex-start", borderRadius: 4 }} />
        <div style={{ fontSize: 12, minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{preview.name}</div>
          <div style={{ color: "#86b4e6", marginBottom: 6 }}>
            [{preview.type}
            {preview.race ? ` / ${preview.race}` : ""}
            {preview.attribute ? ` / ${preview.attribute}` : ""}
            {preview.level ? ` / Lv ${preview.level}` : ""}]
            {preview.atk !== undefined && preview.atk !== null ? ` ${preview.atk}/${preview.def ?? "?"}` : ""}
          </div>
          {preview.ban && <div style={{ color: banColor(preview.ban), fontWeight: "bold", marginBottom: 6 }}>{banLabel(preview.ban)}</div>}
          <div style={{ maxHeight: isMobile ? 200 : 130, overflow: "auto", whiteSpace: "pre-wrap" }}>{preview.desc}</div>
        </div>
        {isMobile && (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button onClick={() => addCard(preview)} disabled={banLimit(preview.ban) === 0} style={{ flex: 1, padding: 12 }}>
              + {preview.extra ? "Extra" : "Main"}
            </button>
            <button className="secondary" onClick={() => addCard(preview, true)} disabled={banLimit(preview.ban) === 0} style={{ flex: 1, padding: 12 }}>
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
        .gb-tabs { display: none !important; }
        .gb-search { position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; }
        .gb-bottombar { display: none; }
        .gb-remove::before { display: none; }
        .gb-remove { clip-path: none; color: #fff; text-shadow: none; position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; padding: 0; border-radius: 50%; font-size: 13px; line-height: 16px; background: #c62828; border: 1px solid #fff; letter-spacing: 0; z-index: 4; opacity: 0; transition: opacity 0.12s; }
        .md-filled:hover .gb-remove, .gb-remove:focus { opacity: 1; }
        @media (max-width: 900px) {
          main.gb-root { padding-bottom: 76px; }
          .gb-bottombar {
            display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; gap: 10px; align-items: center;
            padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: #060a1a; border-top: 2px solid #3aa0ff;
          }
          .gb-hide-desktop-submit { display: none; }
          .gb-remove { width: 22px; height: 22px; top: -6px; right: -6px; font-size: 15px; line-height: 18px; opacity: 0.85; }
          .gb-toast { bottom: 84px !important; }
          .gb-grid { grid-template-columns: 1fr; }
          .gb-tabs { display: flex !important; }
          .gb-hide-mobile { display: none; }
          .gb-search { position: static; max-height: none; }
        }
      `}</style>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ marginBottom: 4 }}>{title}</h1>
            {subtitle && <span style={{ fontSize: 12, color: "#86b4e6" }}>{subtitle}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {actions}
            {primary && (
              <button className="success gb-hide-desktop-submit" onClick={primary.onClick} disabled={primary.disabled}>
                {primary.label}
              </button>
            )}
          </div>
        </div>
        {notes}
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
          <div style={{ fontWeight: "bold", color: counts.main < LIMITS.main.min ? "#ef9a9a" : "#a5d6a7" }}>
            Main {counts.main}/{LIMITS.main.min}-{LIMITS.main.max}
          </div>
          <div style={{ color: "#86b4e6" }}>Extra {counts.extra} • Side {counts.side}</div>
        </div>
        {primary && (
          <button className="success" onClick={primary.onClick} disabled={primary.disabled} style={{ padding: "12px 18px", fontSize: 13 }}>
            {primary.shortLabel}
          </button>
        )}
      </div>

      <div className="gb-tabs nv-tabs">
        <button className={mobileTab === "search" ? "active" : ""} onClick={() => setMobileTab("search")}>
          Search Cards
        </button>
        <button className={mobileTab === "deck" ? "active" : ""} onClick={() => setMobileTab("deck")}>
          My Deck ({counts.total})
        </button>
      </div>

      <div className="gb-grid">
        <div className={mobileTab === "deck" ? "" : "gb-hide-mobile"}>
          <div className="md-panel">
            {renderSection("main")}
            {renderSection("extra")}
            {renderSection("side")}
          </div>
        </div>

        <div className={`gb-search ${mobileTab === "search" ? "" : "gb-hide-mobile"}`}>
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search card name (GOAT card pool)" style={{ marginBottom: 8 }} />
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
            <div style={{ fontSize: 12, color: "#86b4e6", padding: "4px 6px" }}>
              {searching && results.length === 0 ? "Searching..." : total !== null ? `${total} cards` : ""}
            </div>
            {searchError && <p style={{ color: "#ef9a9a", fontSize: 12, padding: 6 }}>{searchError}</p>}
            {results.map((c) => {
              const inDeck = totalCopies(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => setPreview(c)}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: 6, borderBottom: "1px solid rgba(58, 160, 255, 0.2)", cursor: "pointer" }}
                >
                  <img src={`/api/card-image/${c.img}`} alt="" loading="lazy" style={{ width: 40, borderRadius: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "#86b4e6" }}>
                      {c.type}
                      {c.level ? ` • Lv ${c.level}` : ""}
                      {c.ban && <span style={{ color: banColor(c.ban), fontWeight: "bold" }}> • {banLabel(c.ban)}</span>}
                      {inDeck > 0 && <span style={{ color: "#a5d6a7" }}> • x{inDeck} in deck</span>}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); addCard(c); }} disabled={banLimit(c.ban) === 0} style={{ padding: "6px 10px", fontSize: 11 }}>
                    + {c.extra ? "Extra" : "Main"}
                  </button>
                  <button className="secondary" onClick={(e) => { e.stopPropagation(); addCard(c, true); }} disabled={banLimit(c.ban) === 0} style={{ padding: "6px 10px", fontSize: 11 }}>
                    + Side
                  </button>
                </div>
              );
            })}
            {results.length === 0 && !searching && !searchError && <p style={{ padding: 8, fontSize: 12, color: "#86b4e6" }}>No cards found.</p>}
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
