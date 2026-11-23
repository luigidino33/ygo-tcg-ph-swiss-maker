"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DeckBuilder, { api, LIMITS, Me, toList, useDeckState, useSavedDecks } from "../../DeckBuilder";

type Entry = { id: string; name: string; submitted: boolean; can_submit: boolean; can_edit: boolean };
type Status = { enabled: boolean; registration: boolean; locked: boolean; name: string; user: Me | null; me: Entry | null };

const box = { maxWidth: 520, margin: "0 auto", paddingTop: 24 } as const;

export default function DecklistPage() {
  const { tid } = useParams<{ tid: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ds = useDeckState();
  const { deck, setDeck, cards, setCards } = ds;
  const { main: mainCount, extra: extraCount, side: sideCount } = ds.counts;
  const { savedDeck, saving, saveDeck, openMyDecks, modal: myDecksModal } = useSavedDecks(
    ds,
    () => `${status?.me?.name || "My"} GOAT deck`
  );

  useEffect(() => {
    api(`/api/tournaments/${tid}/decklist-status`)
      .then(setStatus)
      .catch((e) => setLoadError(e.message));
  }, [tid]);

  const entry = status?.me;
  const draftKey = `goat_draft_${tid}_${entry?.id || ""}`;

  // Restore the unsubmitted draft for a new submission
  useEffect(() => {
    if (!started || !entry || editing) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const saved = JSON.parse(raw);
        setDeck(saved.deck);
        setCards(saved.cards);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, draftKey]);

  // Save draft
  useEffect(() => {
    if (!started || !entry || done) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ deck, cards }));
    } catch {}
  }, [deck, cards, started, entry, draftKey, done]);

  const loginNext = encodeURIComponent(`/decklist/${tid}`);

  const register = async () => {
    setBusy(true);
    setActionError("");
    try {
      const res = await api(`/api/tournaments/${tid}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setStatus((s) => s && { ...s, me: { id: res.player.id, name: res.player.name, submitted: false, can_submit: true, can_edit: true } });
      setStarted(true);
    } catch (e: any) {
      setActionError(e.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const openEditor = async () => {
    setBusy(true);
    setActionError("");
    try {
      const res = await api(`/api/tournaments/${tid}/my-decklist`);
      await ds.loadDeckList(res.deck);
      setEditing(true);
      setStarted(true);
    } catch (e: any) {
      setActionError(`Could not open your decklist: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const clearDeck = () => {
    if (!confirm("Clear the whole deck?")) return;
    setDeck({ main: {}, extra: {}, side: {} });
  };

  const problems: string[] = [];
  if (mainCount < LIMITS.main.min) problems.push(`Main Deck needs at least ${LIMITS.main.min} cards (${mainCount}).`);

  const submit = async () => {
    if (problems.length || !entry) return;
    const question = editing
      ? "Update your submitted decklist with this version?"
      : `Submit this decklist as ${entry.name}? You can still edit it until your first round is paired.`;
    if (!confirm(question)) return;
    setSubmitting(true);
    try {
      await api(`/api/tournaments/${tid}/decklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: toList(deck.main), extra: toList(deck.extra), side: toList(deck.side) }),
      });
      setStatus((s) => s && s.me && { ...s, me: { ...s.me, submitted: true } });
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

  const screen = (title: string, body: React.ReactNode) => (
    <div style={box}>
      <div className="card">
        <h1>{title}</h1>
        {status && <p style={{ marginBottom: 14, color: "#cbd5e1" }}>{status.name}</p>}
        {body}
      </div>
    </div>
  );

  // ── Gate screens ──
  if (loadError || !status) {
    return screen("GOAT Decklist", <p>{loadError ? `Could not load tournament: ${loadError}` : "Loading..."}</p>);
  }

  if (!status.enabled) {
    return screen("GOAT Decklist", <p>Decklist submission isn&apos;t enabled for this tournament.</p>);
  }

  const canRegister = status.registration && !status.locked;

  if (!status.user) {
    return screen(
      canRegister ? "Register & Submit Deck" : "GOAT Decklist",
      <>
        <p style={{ marginBottom: 16 }}>
          You need a player account to {canRegister ? "register and " : ""}submit your decklist. Your account&apos;s
          player name is the name used in pairings and standings.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href={`/login?next=${loginNext}`}><button>Log In</button></a>
          <a href={`/register?next=${loginNext}`}><button className="secondary">Create Account</button></a>
        </div>
      </>
    );
  }

  const user = status.user;

  if (!entry) {
    return screen(
      canRegister ? "Register & Submit Deck" : "GOAT Decklist",
      <>
        <p style={{ fontSize: 13, color: "#86b4e6", marginBottom: 12 }}>
          Logged in as <strong style={{ color: "#eaf4ff" }}>{user.player_name}</strong> (@{user.username})
        </p>
        {canRegister ? (
          <button disabled={busy} onClick={register} style={{ width: "100%" }}>
            {busy ? "Registering..." : `Register as ${user.player_name}`}
          </button>
        ) : (
          <p>
            {status.locked
              ? "The tournament has started and you're not on its player list."
              : "You're not on this tournament's player list."}{" "}
            Ask the organizer to add {user.player_name}.
          </p>
        )}
        {actionError && <p style={{ color: "#ff8a80", fontSize: 13, marginTop: 10 }}>{actionError}</p>}
        {canRegister && (
          <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 14 }}>
            Registration closes when Round 1 is paired. Only the organizer can see your decklist.
          </p>
        )}
      </>
    );
  }

  if (done) {
    return screen(
      editing ? "Decklist Updated" : "Decklist Submitted",
      <>
        <p style={{ marginBottom: 8 }}>
          Thanks, {entry.name}! Your decklist ({mainCount} Main / {extraCount} Extra / {sideCount} Side) has been
          {editing ? " updated." : " sent to the organizer."}
        </p>
        <p style={{ color: "#86b4e6", fontSize: 13, marginBottom: 14 }}>
          Decklists are only visible to the tournament organizer. You can edit yours until your first round is paired.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="secondary" onClick={() => { setEditing(true); setDone(false); }}>Edit Decklist</button>
          <button className="secondary" onClick={() => saveDeck()} disabled={saving}>
            {saving ? "Saving..." : "Save to My Decks"}
          </button>
        </div>
      </>
    );
  }

  if (!started) {
    return screen(
      "GOAT Decklist",
      <>
        <p style={{ fontSize: 13, color: "#86b4e6", marginBottom: 12 }}>
          Registered as <strong style={{ color: "#eaf4ff" }}>{entry.name}</strong>
        </p>
        {entry.submitted ? (
          entry.can_edit ? (
            <>
              <p style={{ marginBottom: 12 }}>Your decklist has been submitted. You can change it until your first round is paired.</p>
              <button disabled={busy} onClick={openEditor} style={{ width: "100%" }}>
                {busy ? "Opening..." : "Edit Your Decklist"}
              </button>
            </>
          ) : (
            <p>Your decklist has been submitted and is now locked. Ask the organizer if something needs to change.</p>
          )
        ) : entry.can_submit ? (
          <button onClick={() => setStarted(true)} style={{ width: "100%" }}>Build Your Deck</button>
        ) : (
          <p>Decklist submission is closed because the tournament has started.</p>
        )}
        {actionError && <p style={{ color: "#ff8a80", fontSize: 13, marginTop: 10 }}>{actionError}</p>}
        <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 14 }}>
          Cards, GOAT banlist and limits are enforced. Only the organizer can see your list.
        </p>
      </>
    );
  }

  // ── Builder ──
  return (
    <>
      <DeckBuilder
        state={ds}
        title={`GOAT Deck: ${entry.name}`}
        subtitle={status.name}
        actions={
          <>
            <button className="secondary" onClick={openMyDecks}>My Decks</button>
            <button className="secondary" onClick={() => saveDeck()} disabled={saving || ds.counts.total === 0}>{saving ? "Saving..." : "Save"}</button>
            <button className="secondary" onClick={clearDeck}>Clear</button>
          </>
        }
        notes={
          <>
            {editing && <p style={{ color: "#7fe0ff", fontSize: 12, marginTop: 8 }}>Editing your submitted decklist. Changes count once you tap Update.</p>}
            {savedDeck && <p style={{ color: "#86b4e6", fontSize: 12, marginTop: 4 }}>Saved deck: {savedDeck.name}</p>}
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
