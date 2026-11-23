"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DeckBuilder, { api, LIMITS, Me, toList, useDeckState, useSavedDecks } from "../../DeckBuilder";

type RosterPlayer = { id: string; name: string; submitted: boolean; can_submit: boolean; can_edit: boolean; claimed: boolean; mine: boolean };
type Status = { enabled: boolean; registration: boolean; locked: boolean; name: string; players: RosterPlayer[] };

export default function DecklistPage() {
  const { tid } = useParams<{ tid: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [regName, setRegName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ds = useDeckState();
  const { deck, setDeck, cards, setCards } = ds;
  const { main: mainCount, extra: extraCount, side: sideCount } = ds.counts;
  const { savedDeck, saving, saveDeck, openMyDecks, modal: myDecksModal } = useSavedDecks(
    ds,
    () => `${status?.players.find((p) => p.id === playerId)?.name || "My"} GOAT deck`
  );

  useEffect(() => {
    api(`/api/tournaments/${tid}/decklist-status`)
      .then(setStatus)
      .catch((e) => setLoadError(e.message));
    api("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(null));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, playerId, draftKey]);

  // Save draft
  useEffect(() => {
    if (!started || !playerId || done) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ deck, cards }));
    } catch {}
  }, [deck, cards, started, playerId, draftKey, done]);

  // Edit key from the device that submitted (players without an account).
  const tokenKey = (pid: string) => `goat_edit_${tid}_${pid}`;
  const getToken = (pid: string) => {
    try { return localStorage.getItem(tokenKey(pid)) || ""; } catch { return ""; }
  };
  const canEditEntry = (p: RosterPlayer) => p.submitted && p.can_edit && (p.mine || !!getToken(p.id));

  const openEditor = async (pid: string) => {
    setOpening(true);
    try {
      const res = await api(`/api/tournaments/${tid}/my-decklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: pid, edit_token: getToken(pid) }),
      });
      await ds.loadDeckList(res.deck);
      setPlayerId(pid);
      setEditing(true);
      setStarted(true);
    } catch (e: any) {
      alert(`Could not open your decklist: ${e.message}`);
    } finally {
      setOpening(false);
    }
  };

  const clearDeck = () => {
    if (!confirm("Clear the whole deck?")) return;
    setDeck({ main: {}, extra: {}, side: {} });
  };

  const problems: string[] = [];
  if (mainCount < LIMITS.main.min) problems.push(`Main Deck needs at least ${LIMITS.main.min} cards (${mainCount}).`);

  const submit = async () => {
    if (problems.length) return;
    const player = status?.players.find((p) => p.id === playerId);
    const question = editing
      ? `Update ${player?.name}'s submitted decklist with this version?`
      : `Submit this decklist for ${player?.name}? You can still edit it until your first round is paired.`;
    if (!confirm(question)) return;
    setSubmitting(true);
    try {
      const res = await api(`/api/tournaments/${tid}/decklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          main: toList(deck.main),
          extra: toList(deck.extra),
          side: toList(deck.side),
          edit_token: getToken(playerId) || undefined,
        }),
      });
      if (res.edit_token) {
        try { localStorage.setItem(tokenKey(playerId), res.edit_token); } catch {}
      }
      setStatus((s) => s && { ...s, players: s.players.map((p) => (p.id === playerId ? { ...p, submitted: true } : p)) });
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

  const lateOpen = status.locked && status.players.some((p) => p.can_submit && (!p.submitted || p.can_edit));
  if (!status.enabled || (status.locked && !lateOpen)) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 60 }}>
        <div className="card">
          <h1>GOAT Decklist</h1>
          <p>
            {!status.enabled
              ? "Decklist submission isn't enabled for this tournament."
              : status.registration
                ? "Registration and decklist submission are closed because the tournament has started."
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
          <h1>{editing ? "Decklist Updated" : "Decklist Submitted"}</h1>
          <p style={{ marginBottom: 8 }}>
            Thanks, {player?.name}! Your decklist ({mainCount} Main / {extraCount} Extra / {sideCount} Side) has been
            {editing ? " updated." : " sent to the organizer."}
          </p>
          <p style={{ color: "#86b4e6", fontSize: 13, marginBottom: 14 }}>
            Decklists are only visible to the tournament organizer. You can edit yours until your first round is paired
            {player?.mine ? "" : ", from this device"}.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="secondary" onClick={() => { setEditing(true); setDone(false); }}>
              Edit Decklist
            </button>
            {me && (
              <button className="secondary" onClick={() => saveDeck()} disabled={saving}>
                {saving ? "Saving..." : "Save to My Decks"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!started) {
    const roster = status.locked ? status.players.filter((p) => p.can_submit) : status.players;
    const open = roster.filter((p) => !p.submitted);

    const mine = roster.find((p) => p.mine);
    const loginHref = `/login?next=${encodeURIComponent(`/decklist/${tid}`)}`;

    const register = async (asAccount = false) => {
      setRegistering(true);
      setRegError("");
      try {
        const res = await api(`/api/tournaments/${tid}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(asAccount ? {} : { name: regName }),
        });
        const entry = { ...res.player, submitted: false, can_submit: true, claimed: asAccount, mine: asAccount };
        setStatus({ ...status, players: [...status.players.filter((p) => p.id !== entry.id), entry] });
        setPlayerId(res.player.id);
        setStarted(true);
      } catch (e: any) {
        setRegError(e.message || "Registration failed");
      } finally {
        setRegistering(false);
      }
    };

    return (
      <div style={{ maxWidth: 520, margin: "0 auto", paddingTop: 24 }}>
        <div className="card">
          <h1>{status.registration ? "Register & Submit Deck" : "GOAT Decklist"}</h1>
          <p style={{ marginBottom: 16, color: "#cbd5e1" }}>{status.name}</p>

          {status.locked && (
            <p style={{ color: "#7fe0ff", fontSize: 13, marginBottom: 14 }}>
              The tournament has started. Late entrants can still submit their decklist below.
            </p>
          )}

          {me ? (
            <div style={{ padding: 12, marginBottom: 16, border: "1px solid rgba(127,224,255,0.5)", borderRadius: 3, background: "rgba(4,22,52,0.6)" }}>
              <div style={{ fontSize: 13, color: "#86b4e6", marginBottom: 10 }}>
                Logged in as <strong style={{ color: "#eaf4ff" }}>{me.player_name}</strong>
              </div>
              {mine ? (
                mine.submitted ? (
                  canEditEntry(mine) ? (
                    <button disabled={opening} onClick={() => openEditor(mine.id)} style={{ width: "100%" }}>
                      {opening ? "Opening..." : "Edit Your Decklist"}
                    </button>
                  ) : (
                    <p style={{ fontSize: 13, color: "#7fe0ff" }}>Your decklist has been submitted.</p>
                  )
                ) : (
                  <button onClick={() => { setPlayerId(mine.id); setStarted(true); }} style={{ width: "100%" }}>
                    Build Deck as {me.player_name}
                  </button>
                )
              ) : status.registration && !status.locked ? (
                <button disabled={registering} onClick={() => register(true)} style={{ width: "100%" }}>
                  {registering ? "Registering..." : `Register as ${me.player_name}`}
                </button>
              ) : (
                <p style={{ fontSize: 13, color: "#86b4e6" }}>
                  You're not on this tournament's player list. Ask the organizer to add {me.player_name}.
                </p>
              )}
              {regError && <p style={{ color: "#ff8a80", fontSize: 13, marginTop: 10 }}>{regError}</p>}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#86b4e6", marginBottom: 16 }}>
              Have a player account? <a href={loginHref}>Log in</a> to register and submit in one tap.
            </p>
          )}

          {!me && status.registration && !status.locked && (
            <>
              <label>New player? Enter your name</label>
              <input
                type="text"
                value={regName}
                maxLength={40}
                onChange={(e) => setRegName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && regName.trim()) register(); }}
                placeholder="Your name as it should appear in standings"
                style={{ marginBottom: 10 }}
              />
              {regError && <p style={{ color: "#ff8a80", fontSize: 13, marginBottom: 10 }}>{regError}</p>}
              <button disabled={registering || !regName.trim()} onClick={() => register()} style={{ width: "100%" }}>
                {registering ? "Registering..." : "Register & Build Deck"}
              </button>
            </>
          )}

          {roster.length > 0 && (
            <>
              {status.registration && !status.locked && (
                <p style={{ textAlign: "center", color: "#86b4e6", fontSize: 12, margin: "18px 0 12px" }}>
                  Already registered? Pick your name below.
                </p>
              )}
              <label>Select your name</label>
              <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
                <option value="">-- choose --</option>
                {roster.map((p) => (
                  <option key={p.id} value={p.id} disabled={(p.claimed && !p.mine) || (p.submitted && !canEditEntry(p))}>
                    {p.name}
                    {p.claimed && !p.mine ? " (log in)" : p.submitted ? (canEditEntry(p) ? " (edit)" : " (submitted)") : ""}
                  </option>
                ))}
              </select>
              {open.length === 0 && (
                <p style={{ color: "#86b4e6", fontSize: 13, marginBottom: 12 }}>Everyone listed has already submitted a decklist.</p>
              )}
              <button
                className="secondary"
                disabled={!playerId || opening}
                onClick={() => {
                  const sel = roster.find((p) => p.id === playerId);
                  if (sel?.submitted) openEditor(playerId);
                  else setStarted(true);
                }}
                style={{ width: "100%" }}
              >
                {opening ? "Opening..." : roster.find((p) => p.id === playerId)?.submitted ? "Edit Decklist" : "Build Deck"}
              </button>
            </>
          )}

          <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 14 }}>
            Cards, GOAT banlist and limits are enforced. Only the organizer can see your list, and you can edit it until your first round is paired.
            {status.registration && !status.locked && " Registration closes when Round 1 is paired."}
          </p>
        </div>
      </div>
    );
  }

  // ── Builder ──
  return (
    <>
      <DeckBuilder
        state={ds}
        title={`GOAT Deck: ${player?.name}`}
        subtitle={status.name}
        actions={
          <>
            {me && (
              <>
                <button className="secondary" onClick={openMyDecks}>My Decks</button>
                <button className="secondary" onClick={() => saveDeck()} disabled={saving || ds.counts.total === 0}>{saving ? "Saving..." : "Save"}</button>
              </>
            )}
            <button className="secondary" onClick={clearDeck}>Clear</button>
          </>
        }
        notes={
          <>
            {editing && <p style={{ color: "#7fe0ff", fontSize: 12, marginTop: 8 }}>Editing your submitted decklist. Changes count once you tap Update.</p>}
            {savedDeck && <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 4 }}>Saved deck: {savedDeck.name}</p>}
            {!me && (
              <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 8 }}>
                <a href={`/login?next=${encodeURIComponent(`/decklist/${tid}`)}`}>Log in</a> to load decks from your account or save this one.
              </p>
            )}
            {problems.length > 0 && <p style={{ color: "#ffab91", fontSize: 12, marginTop: 8 }}>{problems.join(" ")}</p>}
          </>
        }
        primary={{
          label: submitting ? "Submitting..." : editing ? "Update Decklist" : "Submit Decklist",
          shortLabel: submitting ? "Submitting..." : editing ? "Update" : "Submit",
          onClick: submit,
          disabled: submitting || problems.length > 0,
        }}
      />
      {myDecksModal}
    </>
  );
}
