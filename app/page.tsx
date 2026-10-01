export default function HomePage() {
  const links = [
    { href: "/players?tab=history", icon: "📜", label: "Tournament Results" },
    { href: "/players?tab=leaderboard", icon: "👑", label: "Ranking" },
    { href: "/players?tab=metagame", icon: "📊", label: "Metagame" },
  ];

  return (
    <main className="nv-home">
      <h1 style={{ marginTop: 8 }}>Tournament App</h1>
      <p className="nv-note">KTS-powered Swiss pairings for the YGO TCG PH community.</p>

      <div className="nv-hud-row">
        <a href="/admin" className="nv-hud">
          <span className="nv-hud-icon">🛡️</span>
          Organizer
        </a>
        <a href="/players" className="nv-hud big">
          <span className="nv-hud-icon">🃏</span>
          Player View
        </a>
      </div>

      <nav className="nv-list">
        {links.map((l) => (
          <a key={l.href} href={l.href} className="nv-pill">
            <span className="nv-pill-icon">{l.icon}</span>
            <span className="nv-pill-label">{l.label}</span>
            <span className="nv-pill-chev">›</span>
          </a>
        ))}
      </nav>
    </main>
  );
}
