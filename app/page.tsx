"use client";

export default function HomePage() {
  return (
    <div style={{ maxWidth: 500, margin: "0 auto", paddingTop: 80 }}>
      <div className="card" style={{ textAlign: "center" }}>
        <h1>YGO TCG PH Tournament App</h1>
        <p style={{ color: "#cbd5e1", fontSize: 14, marginBottom: 32 }}>
          KTS-powered Swiss pairings with double loss support
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <a href="/admin" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", fontSize: 16, padding: "16px 24px" }}>
              🔒 Admin Panel
            </button>
          </a>
          <a href="/players" style={{ textDecoration: "none" }}>
            <button className="secondary" style={{ width: "100%", fontSize: 16, padding: "16px 24px" }}>
              👥 Player View
            </button>
          </a>
        </div>
      </div>
    </div>
  );
}
