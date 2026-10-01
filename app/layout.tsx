export const metadata = { title: "YGO TCG PH Tournament App" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }

          :root {
            --pad: 24px;
            --cut: 14px;
            --bcut: 12px;
            --blue: #3aa0ff;
            --blue-deep: #1f6fd0;
            --cyan: #7fe0ff;
            --line: rgba(70, 160, 255, 0.5);
            --line-dim: rgba(70, 160, 255, 0.2);
            --text: #eaf4ff;
            --muted: #86b4e6;
            --panel-a: rgba(12, 58, 116, 0.82);
            --panel-b: rgba(4, 22, 52, 0.94);
            --font-ui: 'Rajdhani', 'Segoe UI', Tahoma, sans-serif;
            --font-body: 'Exo 2', 'Segoe UI', Tahoma, sans-serif;
          }

          body {
            font-family: var(--font-body);
            background:
              radial-gradient(ellipse 75% 45% at 50% 0%, rgba(40, 130, 255, 0.38) 0%, transparent 70%),
              url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100M28 0L28 -34M0 50L0 84L28 100L56 84L56 50' fill='none' stroke='%233c8cff' stroke-opacity='.16' stroke-width='1.2'/%3E%3C/svg%3E"),
              linear-gradient(180deg, #041532 0%, #030b1e 60%, #02060f 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: var(--text);
            padding: var(--pad);
            font-size: 15px;
          }

          a { color: var(--cyan); }

          /* App header: hexagon badge on a glowing rule, as in Neuron */
          .nv-header {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 68px;
            margin: calc(var(--pad) * -1) calc(var(--pad) * -1) 22px;
            border-bottom: 2px solid #2f86e6;
            box-shadow: 0 2px 14px rgba(47, 134, 230, 0.65);
            background:
              linear-gradient(transparent calc(50% - 1px), rgba(70, 160, 255, 0.55) calc(50% - 1px), rgba(70, 160, 255, 0.55) calc(50% + 1px), transparent calc(50% + 1px)),
              linear-gradient(180deg, rgba(8, 40, 90, 0.9), rgba(4, 18, 44, 0.95));
          }

          .nv-badge {
            position: relative;
            isolation: isolate;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 190px;
            height: 50px;
            text-decoration: none;
            font-family: var(--font-ui);
            font-weight: 700;
            font-size: 20px;
            letter-spacing: 3px;
            color: #fff;
            background: linear-gradient(180deg, #bfe9ff, #3a9cf0);
            clip-path: polygon(20px 0, calc(100% - 20px) 0, 100% 50%, calc(100% - 20px) 100%, 20px 100%, 0 50%);
          }

          .nv-badge::before {
            content: '';
            position: absolute;
            inset: 2px;
            z-index: -1;
            background: linear-gradient(180deg, #0a3a78, #041a3c);
            clip-path: polygon(19px 0, calc(100% - 19px) 0, 100% 50%, calc(100% - 19px) 100%, 19px 100%, 0 50%);
          }

          /* Panels */
          .card {
            background: linear-gradient(180deg, var(--panel-a) 0%, var(--panel-b) 100%);
            clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, var(--cut) 100%, 0 calc(100% - var(--cut)));
            padding: 24px;
            margin-bottom: 24px;
            position: relative;
            overflow: hidden;
            backdrop-filter: blur(6px);
          }

          .card::after {
            content: '';
            position: absolute;
            inset: 0;
            border: 1px solid var(--line);
            border-top: 2px solid var(--blue);
            background:
              linear-gradient(45deg, transparent calc(50% - 0.75px), var(--blue) calc(50% - 0.75px), var(--blue) calc(50% + 0.75px), transparent calc(50% + 0.75px)) top right / var(--cut) var(--cut) no-repeat,
              linear-gradient(45deg, transparent calc(50% - 0.75px), var(--line) calc(50% - 0.75px), var(--line) calc(50% + 0.75px), transparent calc(50% + 0.75px)) bottom left / var(--cut) var(--cut) no-repeat;
            background-origin: border-box;
            pointer-events: none;
            z-index: 0;
          }

          .card > * { position: relative; z-index: 1; }

          /* Headings */
          h1, h2, h3 {
            font-family: var(--font-ui);
            background: linear-gradient(180deg, #ffffff 0%, #bfe4ff 55%, #6fb4f5 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            filter: drop-shadow(0 0 7px rgba(60, 160, 255, 0.7));
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 16px;
          }

          h1 { font-size: 34px; }
          h2 { font-size: 25px; }
          h3 { font-size: 19px; }

          /* Buttons: hexagon-ended like Neuron's list buttons.
             Outer element = bright outline, ::before = fill. Default = selected/primary. */
          button {
            font-family: var(--font-ui);
            position: relative;
            isolation: isolate;
            padding: 9px 34px;
            border: none;
            background: linear-gradient(180deg, #d4f1ff 0%, #4fb2ff 100%);
            color: #fff;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 0.8px;
            text-shadow: 0 1px 2px rgba(0, 20, 60, 0.7);
            cursor: pointer;
            transition: filter 0.15s ease, transform 0.1s ease;
            clip-path: polygon(var(--bcut) 0, calc(100% - var(--bcut)) 0, 100% 50%, calc(100% - var(--bcut)) 100%, var(--bcut) 100%, 0 50%);
          }

          button::before {
            content: '';
            position: absolute;
            inset: 2px;
            z-index: -1;
            background: linear-gradient(180deg, #1478e0 0%, #0a4aa0 55%, #08336f 100%);
            clip-path: polygon(calc(var(--bcut) - 1px) 0, calc(100% - var(--bcut) + 1px) 0, 100% 50%, calc(100% - var(--bcut) + 1px) 100%, calc(var(--bcut) - 1px) 100%, 0 50%);
          }

          button:hover { filter: brightness(1.18); }
          button:active { transform: scale(0.98); }

          button:disabled {
            background: #3b5575;
            color: #6f88a6;
            text-shadow: none;
            cursor: not-allowed;
          }

          button:disabled::before { background: linear-gradient(180deg, #112238, #0a1626); }
          button:disabled:hover { filter: none; }

          button.secondary {
            background: linear-gradient(180deg, #5d9fe0, #2a6cb4);
            color: #d8ecff;
          }

          button.secondary::before { background: linear-gradient(180deg, #0d3566 0%, #07224a 100%); }

          button.success {
            background: linear-gradient(180deg, #ffffff, #8fe0ff);
            color: #fff;
          }

          button.success::before { background: linear-gradient(180deg, #27b5ff 0%, #0f78d8 100%); }
          button.success:disabled { background: #3b5575; }
          button.success:disabled::before { background: linear-gradient(180deg, #112238, #0a1626); }

          /* Inputs */
          input, textarea, select {
            font-family: var(--font-body);
            width: 100%;
            padding: 11px 14px;
            border: 1px solid var(--line);
            border-radius: 2px;
            background: rgba(2, 12, 30, 0.85);
            color: var(--text);
            font-size: 14px;
            transition: all 0.15s ease;
            margin-bottom: 16px;
          }

          input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: var(--cyan);
            box-shadow: 0 0 0 1px var(--cyan), 0 0 14px rgba(80, 190, 255, 0.4);
          }

          input::placeholder, textarea::placeholder { color: #4f7bad; }

          label {
            font-family: var(--font-ui);
            display: block;
            margin-bottom: 8px;
            color: var(--muted);
            font-weight: 700;
            text-transform: uppercase;
            font-size: 13px;
            letter-spacing: 2px;
          }

          /* Tables as stacked list rows */
          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 5px;
            background: transparent;
          }

          th {
            font-family: var(--font-ui);
            background: transparent;
            color: var(--muted);
            padding: 6px 12px;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 1.5px;
            border-bottom: 1px solid var(--line);
          }

          td {
            padding: 11px 12px;
            border-top: 1px solid var(--line-dim);
            border-bottom: 1px solid var(--line-dim);
            background: linear-gradient(180deg, rgba(14, 64, 128, 0.7), rgba(6, 30, 66, 0.85));
            color: var(--text);
          }

          td:first-child { border-left: 3px solid var(--blue); }
          td:last-child { border-right: 1px solid var(--line-dim); }

          tr:hover td { background: linear-gradient(180deg, rgba(24, 90, 170, 0.8), rgba(10, 48, 100, 0.9)); }

          .rank-1 td { font-weight: bold; border-top-color: var(--cyan); border-bottom-color: var(--cyan); background: rgba(40, 130, 210, 0.55) !important; }
          .rank-1 td:first-child { border-left-color: var(--cyan); }
          .rank-2 td { font-weight: bold; background: rgba(30, 95, 170, 0.5) !important; }
          .rank-3 td { font-weight: bold; background: rgba(120, 90, 50, 0.4) !important; }
          .rank-3 td:first-child { border-left-color: #ffb74d; }

          /* Pairing rows */
          .pairing-card {
            background: linear-gradient(180deg, rgba(14, 64, 128, 0.8), rgba(5, 24, 54, 0.95));
            border: 1px solid var(--line);
            border-left: 3px solid var(--blue);
            border-radius: 2px;
            padding: 18px 20px;
            margin-bottom: 14px;
            transition: all 0.15s ease;
          }

          .pairing-card:hover {
            border-color: var(--cyan);
            box-shadow: 0 0 16px rgba(80, 190, 255, 0.35), inset 0 0 12px rgba(80, 190, 255, 0.1);
          }

          .pairing-card.completed {
            border-left-color: #5fe39a;
            background: linear-gradient(90deg, rgba(95, 227, 154, 0.16), rgba(5, 24, 54, 0.95) 60%);
          }

          .table-number {
            display: inline-block;
            font-family: var(--font-ui);
            background: linear-gradient(180deg, #7fd0ff, #2a86e0);
            color: #02142e;
            font-weight: 700;
            font-size: 20px;
            padding: 6px 24px;
            min-width: 66px;
            text-align: center;
            clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%);
            letter-spacing: 1px;
          }

          .player-name { font-family: var(--font-ui); font-size: 20px; font-weight: 600; color: var(--text); margin: 8px 0; letter-spacing: 0.5px; }
          .player-name.winner { color: #5fe39a; text-shadow: 0 0 10px rgba(95, 227, 154, 0.6); }

          .vs-badge {
            display: inline-block;
            font-family: var(--font-ui);
            background: rgba(2, 12, 30, 0.9);
            color: var(--muted);
            padding: 2px 14px;
            border-radius: 999px;
            font-weight: 700;
            font-size: 14px;
            letter-spacing: 3px;
            border: 1px solid var(--line);
          }

          .result-btn {
            padding: 8px 24px;
            margin: 4px;
            font-size: 15px;
            min-width: 100px;
          }

          .result-btn.selected { background: linear-gradient(180deg, #ffffff, #8fe0ff); }
          .result-btn.selected::before { background: linear-gradient(180deg, #27b5ff 0%, #0f78d8 100%); }
          .result-btn.tie.selected { background: linear-gradient(180deg, #e6dcff, #a58bff); }
          .result-btn.tie.selected::before { background: linear-gradient(180deg, #7b5cf0, #4a2fb8); }

          /* Scrollbars */
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: rgba(2, 12, 30, 0.6); }
          ::-webkit-scrollbar-thumb { background: #2a6cb4; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: var(--cyan); }

          .status-indicator {
            display: inline-block;
            width: 8px; height: 8px;
            border-radius: 50%;
            background: var(--cyan);
            animation: pulse 2s infinite;
            margin-right: 8px;
            box-shadow: 0 0 10px rgba(127, 224, 255, 0.8);
          }

          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

          /* Modals */
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(1, 6, 16, 0.88);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 24px;
            backdrop-filter: blur(5px);
          }

          .modal-content {
            background: linear-gradient(180deg, rgba(14, 70, 140, 0.97) 0%, rgba(4, 20, 48, 0.98) 100%);
            border: 1px solid var(--line);
            border-top: 2px solid var(--cyan);
            border-radius: 3px;
            padding: 24px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 0 0 40px rgba(40, 130, 255, 0.35), 0 8px 32px rgba(0, 0, 0, 0.8);
          }

          /* Neuron-style flat tabs */
          .nv-tabs { display: flex; gap: 6px; margin-bottom: 20px; border-bottom: 2px solid #2f86e6; box-shadow: 0 2px 10px rgba(47, 134, 230, 0.4); }
          .nv-tabs button {
            flex: 1; min-width: 0; clip-path: none; border-radius: 0; padding: 10px 8px;
            background: rgba(70, 160, 255, 0.45); color: #b9d8f5; font-size: 15px; text-shadow: none;
          }
          .nv-tabs button::before { inset: 1px 1px 0 1px; clip-path: none; background: linear-gradient(180deg, #04142e, #020a1a); }
          .nv-tabs button.active { background: linear-gradient(180deg, #d4f1ff, #3aa0ff); color: #fff; }
          .nv-tabs button.active::before { inset: 2px 2px 0 2px; background: linear-gradient(180deg, #0d4a96, #062a5e); }

          /* Home: HUD circle buttons and pill list */
          .nv-home { max-width: 520px; margin: 0 auto; text-align: center; overflow-x: clip; padding: 24px 0; }
          .nv-note { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 6px auto 30px; max-width: 420px; }

          .nv-hud-row { display: flex; align-items: center; justify-content: center; gap: 34px; margin: -24px 0 20px; padding: 24px 0; flex-wrap: wrap; }

          .nv-hud {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            width: 150px;
            height: 150px;
            border-radius: 50%;
            text-decoration: none;
            color: #fff;
            font-family: var(--font-ui);
            font-weight: 700;
            font-size: 19px;
            letter-spacing: 1px;
            background: radial-gradient(circle at 50% 35%, #1a86f0 0%, #0a4aa8 55%, #062e68 100%);
            border: 3px solid #c8ecff;
            box-shadow:
              0 0 0 7px rgba(40, 140, 255, 0.22),
              0 0 0 8px rgba(130, 205, 255, 0.55),
              0 0 34px rgba(60, 160, 255, 0.75),
              inset 0 0 26px rgba(150, 215, 255, 0.4);
            transition: transform 0.15s ease, filter 0.15s ease;
          }

          .nv-hud.big { width: 196px; height: 196px; font-size: 23px; }
          .nv-hud:hover { transform: scale(1.04); filter: brightness(1.15); }

          .nv-hud::before {
            content: '';
            position: absolute;
            inset: -20px;
            border-radius: 50%;
            background: conic-gradient(from 20deg, rgba(150, 220, 255, 0.95) 0 75deg, transparent 75deg 100deg, rgba(150, 220, 255, 0.95) 100deg 200deg, transparent 200deg 228deg, rgba(150, 220, 255, 0.95) 228deg 320deg, transparent 320deg 360deg);
            -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
            mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
            animation: nv-spin 22s linear infinite;
            pointer-events: none;
          }

          @keyframes nv-spin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { .nv-hud::before { animation: none; } }

          .nv-hud-icon { font-size: 46px; line-height: 1; filter: drop-shadow(0 2px 4px rgba(0, 20, 60, 0.6)); }
          .nv-hud.big .nv-hud-icon { font-size: 62px; }

          .nv-list { display: flex; flex-direction: column; gap: 16px; align-items: center; }

          .nv-pill {
            position: relative;
            isolation: isolate;
            display: flex;
            align-items: center;
            gap: 14px;
            width: 100%;
            max-width: 440px;
            padding: 10px 22px 10px 12px;
            text-decoration: none;
            color: #fff;
            font-family: var(--font-ui);
            font-weight: 700;
            font-size: 20px;
            letter-spacing: 0.8px;
            text-align: left;
            background: linear-gradient(180deg, #d4f1ff, #4fb2ff);
            clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%);
            transition: filter 0.15s ease;
          }

          .nv-pill::before {
            content: '';
            position: absolute;
            inset: 2px;
            z-index: -1;
            background: linear-gradient(180deg, #1478e0 0%, #0a4aa0 55%, #08336f 100%);
            clip-path: polygon(15px 0, calc(100% - 15px) 0, 100% 50%, calc(100% - 15px) 100%, 15px 100%, 0 50%);
          }

          .nv-pill:hover { filter: brightness(1.2); }
          .nv-pill .nv-pill-icon { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: radial-gradient(circle, #1d8cf5, #0a3f8a); border: 2px solid #bfe9ff; font-size: 20px; flex: none; margin-left: 14px; }
          .nv-pill .nv-pill-label { flex: 1; }
          .nv-pill .nv-pill-chev { font-size: 22px; color: #bfe9ff; margin-right: 12px; }

          @media (max-width: 768px) {
            :root { --pad: 8px; --cut: 10px; --bcut: 10px; }
            body { font-size: 14px; }
            .nv-header { height: 58px; margin-bottom: 14px; }
            .nv-badge { width: 160px; height: 44px; font-size: 17px; }
            .card { padding: 14px; margin-bottom: 16px; }
            h1 { font-size: 22px; letter-spacing: 2px; }
            h2 { font-size: 18px; letter-spacing: 1.5px; }
            button { padding: 8px 20px; font-size: 14px; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            table { font-size: 12px; }
            th, td { padding: 6px 4px; }
            th { font-size: 11px; letter-spacing: 0.5px; }
            .modal-content { padding: 16px; }
            .modal-overlay { padding: 12px; }
            .nv-hud-row { gap: 30px; flex-wrap: nowrap; margin-bottom: 36px; }
            .nv-hud { width: 112px; height: 112px; font-size: 15px; }
            .nv-hud.big { width: 150px; height: 150px; font-size: 18px; }
            .nv-hud::before { inset: -14px; }
            .nv-hud-icon { font-size: 34px; }
            .nv-hud.big .nv-hud-icon { font-size: 46px; }
            .nv-pill { font-size: 17px; }
            .nv-pill .nv-pill-icon { width: 34px; height: 34px; font-size: 17px; }
          }

          @media (max-width: 480px) {
            h1 { font-size: 17px; letter-spacing: 1px; }
            h2 { font-size: 15px; }
            button { padding: 7px 18px; font-size: 13px; letter-spacing: 0; }
            table { font-size: 11px; }
            th, td { padding: 5px 3px; }
            th { font-size: 10px; }
            .card { padding: 12px; margin-bottom: 12px; }
          }
`}} />
      </head>
      <body>
        <header className="nv-header">
          <a href="/" className="nv-badge">YGO TCG PH</a>
        </header>
        {children}
      </body>
    </html>
  );
}
