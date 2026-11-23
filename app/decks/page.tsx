"use client";

import { useEffect, useRef, useState } from "react";
import DeckBuilder, { api, LIMITS, Me, SavedDeck, useDeckState, useSavedDecks } from "../DeckBuilder";

const DRAFT_KEY = "goat_library_draft";

export default function DeckLibraryPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const ds = useDeckState();
  const ready = useRef(false);

  const setUrlDeck = (id: string | null) => {
    const url = id ? `/decks?deck=${encodeURIComponent(id)}` : "/decks";
    window.history.replaceState(null, "", url);
  };
  const sd = useSavedDecks(ds, () => "New GOAT deck", (d) => setUrlDeck(d.id));

  useEffect(() => {
    api("/api/auth/me").then((d) => setMe(d.user)).catch(() => setMe(null));
  }, []);

  // Open ?deck=<id> from My Decks, otherwise restore the unsaved work on this device.
  useEffect(() => {
    if (!me) return;
    (async () => {
      const wanted = new URLSearchParams(window.location.search).get("deck");
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        const draft = raw ? JSON.parse(raw) : null;
        if (draft && draft.user === me.username && (!wanted || draft.saved?.id === wanted)) {
          ds.setDeck(draft.deck);
          ds.setCards(draft.cards);
          sd.setSavedDeck(draft.saved || null);
        } else if (wanted) {
          const deck = ((await api("/api/me/decks")).decks as SavedDeck[]).find((d) => d.id === wanted);
          if (deck) {
            await ds.loadDeckList(deck);
            sd.setSavedDeck({ id: deck.id, name: deck.name });
          } else {
            setUrlDeck(null);
          }
        }
      } catch {}
      ready.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (!me || !ready.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ user: me.username, deck: ds.deck, cards: ds.cards, saved: sd.savedDeck }));
    } catch {}
  }, [me, ds.deck, ds.cards, sd.savedDeck]);

  useEffect(() => {
    if (sd.savedDeck) setUrlDeck(sd.savedDeck.id);
  }, [sd.savedDeck]);

  if (me === undefined) {
    return (
      <main style={{ maxWidth: 520, margin: "0 auto", paddingTop: 24 }}>
        <div className="card"><h1>Deckbuilder</h1><p>Loading...</p></div>
      </main>
    );
  }

  if (!me) {
    const next = encodeURIComponent("/decks");
    return (
      <main style={{ maxWidth: 520, margin: "0 auto", paddingTop: 24 }}>
        <div className="card">
          <h1>GOAT Deckbuilder</h1>
          <p style={{ color: "#cbd5e1", marginBottom: 18 }}>
            Build GOAT decks, save them to your account, and load them into any tournament's decklist page.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={`/login?next=${next}`}><button>Log In</button></a>
            <a href={`/register?next=${next}`}><button className="secondary">Create Account</button></a>
          </div>
        </div>
      </main>
    );
  }

  const newDeck = () => {
    if (ds.counts.total > 0 && !confirm("Start a new deck? Unsaved changes to the current one will be lost.")) return;
    ds.setDeck({ main: {}, extra: {}, side: {} });
    sd.setSavedDeck(null);
    setUrlDeck(null);
  };

  const ready40 = ds.counts.main >= LIMITS.main.min;

  return (
    <>
      <DeckBuilder
        state={ds}
        title={sd.savedDeck?.name || "New Deck"}
        subtitle="GOAT Deckbuilder"
        actions={
          <>
            <button className="secondary" onClick={sd.openMyDecks}>My Decks</button>
            <button className="secondary" onClick={newDeck}>New</button>
            {sd.savedDeck && (
              <button className="secondary" onClick={() => sd.saveDeck(true)} disabled={sd.saving}>Save As</button>
            )}
          </>
        }
        notes={
          <p style={{ fontSize: 12, marginTop: 8, color: ready40 ? "#a5d6a7" : "#ffab91" }}>
            {ready40
              ? "Tournament-ready. Load it from My Decks on any GOAT tournament's decklist page."
              : `Main Deck needs at least ${LIMITS.main.min} cards to be tournament-ready (${ds.counts.main}). You can still save it.`}
          </p>
        }
        primary={{
          label: sd.saving ? "Saving..." : sd.savedDeck ? "Save Deck" : "Save to My Decks",
          shortLabel: sd.saving ? "Saving..." : "Save",
          onClick: () => sd.saveDeck(),
          disabled: sd.saving || ds.counts.total === 0,
        }}
      />
      {sd.modal}
    </>
  );
}
