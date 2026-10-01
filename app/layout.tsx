export const metadata = { title: "YGO TCG PH Tournament App" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }

          :root {
            --gold: #d6b25e;
            --gold-light: #f3e3b3;
            --gold-dim: #8a7440;
            --cyan: #4dd0e1;
          }

          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background:
              radial-gradient(ellipse 80% 50% at 50% -10%, rgba(60, 100, 220, 0.35) 0%, transparent 70%),
              repeating-linear-gradient(45deg, rgba(214, 178, 94, 0.025) 0 2px, transparent 2px 22px),
              linear-gradient(180deg, #0a1030 0%, #060a1f 55%, #04060f 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: #e8eaf6;
            padding: 24px;
          }

          a { color: var(--gold-light); }

          /* Panels: dark glass with a thin gold frame */
          .card {
            background: linear-gradient(180deg, rgba(16, 26, 64, 0.94) 0%, rgba(7, 11, 32, 0.96) 100%);
            border: 1px solid rgba(214, 178, 94, 0.6);
            border-radius: 6px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow:
              0 8px 24px rgba(0, 0, 0, 0.55),
              inset 0 0 0 1px rgba(0, 0, 0, 0.6),
              inset 0 0 0 2px rgba(214, 178, 94, 0.1),
              inset 0 0 50px rgba(50, 80, 200, 0.07);
            position: relative;
            overflow: hidden;
          }

          .card::before {
            content: '';
            position: absolute;
            top: 0; left: 8%; right: 8%;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--gold), transparent);
            pointer-events: none;
            z-index: 0;
          }

          .card > * { position: relative; z-index: 1; }

          /* Headings: champagne gold, wide tracking */
          h1, h2, h3 {
            background: linear-gradient(180deg, #fff6d6 0%, #e6c872 55%, #b8923c 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 16px;
          }

          h1 { font-size: 30px; }
          h2 { font-size: 22px; }
          h3 { font-size: 17px; }

          /* Buttons: gold primary, navy/gold secondary */
          button {
            padding: 11px 22px;
            border: 1px solid #f0d58a;
            border-radius: 4px;
            background: linear-gradient(180deg, #f1d98f 0%, #d6b25e 45%, #a8812f 100%);
            color: #1a1305;
            font-weight: 800;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.45);
            position: relative;
            overflow: hidden;
          }

          button::before {
            content: '';
            position: absolute;
            top: 0; left: -100%;
            width: 100%; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
            transition: left 0.5s;
          }

          button:hover::before { left: 100%; }

          button:hover {
            transform: translateY(-1px);
            box-shadow: 0 5px 14px rgba(0, 0, 0, 0.6), 0 0 14px rgba(214, 178, 94, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.5);
            filter: brightness(1.07);
          }

          button:active { transform: translateY(0); }

          button:disabled {
            background: linear-gradient(180deg, #2a2f45, #1b1f33);
            border-color: #3b4260;
            color: #6c7494;
            cursor: not-allowed;
            box-shadow: none;
            opacity: 0.8;
          }

          button:disabled:hover { transform: none; filter: none; box-shadow: none; }

          button.secondary {
            background: linear-gradient(180deg, #1c2a5e 0%, #101a40 100%);
            border-color: var(--gold-dim);
            color: var(--gold-light);
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }

          button.secondary:hover {
            border-color: var(--gold);
            box-shadow: 0 5px 14px rgba(0, 0, 0, 0.6), 0 0 14px rgba(214, 178, 94, 0.3);
          }

          button.success {
            background: linear-gradient(180deg, #5fcf80 0%, #2e9a52 55%, #1d7036 100%);
            border-color: #8be0a4;
            color: #04210e;
          }

          button.success:hover {
            box-shadow: 0 5px 14px rgba(0, 0, 0, 0.6), 0 0 14px rgba(95, 207, 128, 0.45);
          }

          /* Inputs */
          input, textarea, select {
            width: 100%;
            padding: 11px 12px;
            border: 1px solid rgba(214, 178, 94, 0.35);
            border-radius: 4px;
            background: rgba(3, 6, 20, 0.8);
            color: #e8eaf6;
            font-size: 14px;
            transition: all 0.2s ease;
            margin-bottom: 16px;
          }

          input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: var(--gold);
            box-shadow: 0 0 0 2px rgba(214, 178, 94, 0.25);
            background: rgba(3, 6, 20, 0.95);
          }

          input::placeholder, textarea::placeholder { color: #6c7494; }

          label {
            display: block;
            margin-bottom: 8px;
            color: var(--gold);
            font-weight: 700;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 2px;
          }

          /* Tables */
          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            border: 1px solid rgba(214, 178, 94, 0.5);
            border-radius: 4px;
            overflow: hidden;
            background: rgba(4, 8, 22, 0.6);
          }

          th {
            background: linear-gradient(180deg, #243061 0%, #131c42 100%);
            color: var(--gold-light);
            padding: 11px 12px;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 1.5px;
            border-bottom: 1px solid rgba(214, 178, 94, 0.6);
          }

          td {
            padding: 11px 12px;
            border-bottom: 1px solid rgba(214, 178, 94, 0.12);
            background: rgba(10, 16, 40, 0.65);
            color: #e8eaf6;
          }

          tr:hover td { background: rgba(214, 178, 94, 0.09); }
          tr:last-child td { border-bottom: none; }

          .rank-1 td, .rank-2 td, .rank-3 td { font-weight: bold; }
          .rank-1 { background: linear-gradient(90deg, rgba(255, 215, 0, 0.28), transparent) !important; }
          .rank-2 { background: linear-gradient(90deg, rgba(192, 192, 192, 0.25), transparent) !important; }
          .rank-3 { background: linear-gradient(90deg, rgba(205, 127, 50, 0.28), transparent) !important; }

          /* Pairing cards */
          .pairing-card {
            background: linear-gradient(180deg, rgba(16, 26, 64, 0.92), rgba(7, 11, 32, 0.95));
            border: 1px solid rgba(214, 178, 94, 0.4);
            border-left: 4px solid var(--gold);
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
          }

          .pairing-card:hover {
            border-color: var(--gold);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 16px rgba(214, 178, 94, 0.18);
          }

          .pairing-card.completed {
            border-color: rgba(129, 199, 132, 0.6);
            border-left-color: #81c784;
            background: linear-gradient(180deg, rgba(20, 60, 36, 0.55), rgba(7, 20, 16, 0.9));
          }

          .table-number {
            display: inline-block;
            background: linear-gradient(180deg, #f1d98f, #b8892f);
            color: #1a1305;
            font-weight: 900;
            font-size: 20px;
            padding: 8px 16px;
            border-radius: 4px;
            min-width: 60px;
            text-align: center;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.45);
          }

          .player-name { font-size: 18px; font-weight: bold; color: #e8eaf6; margin: 8px 0; }
          .player-name.winner { color: #81c784; text-shadow: 0 0 10px rgba(129, 199, 132, 0.6); }

          .vs-badge {
            display: inline-block;
            background: rgba(214, 178, 94, 0.12);
            color: var(--gold);
            padding: 4px 12px;
            border-radius: 3px;
            font-weight: 800;
            font-size: 13px;
            letter-spacing: 3px;
            border: 1px solid rgba(214, 178, 94, 0.4);
          }

          .result-btn {
            padding: 10px 20px;
            margin: 4px;
            border: 1px solid var(--gold-dim);
            background: linear-gradient(180deg, #1c2a5e, #101a40);
            font-size: 13px;
            min-width: 100px;
            color: var(--gold-light);
            transition: all 0.2s ease;
          }

          .result-btn:hover { border-color: var(--gold); transform: translateY(-1px); }

          .result-btn.selected {
            background: linear-gradient(180deg, #5fcf80, #1d7036);
            border-color: #8be0a4;
            box-shadow: 0 0 14px rgba(95, 207, 128, 0.5);
            color: #04210e;
          }

          .result-btn.tie.selected {
            background: linear-gradient(180deg, #5fdcec, #1a8a9a);
            border-color: #9be9f5;
            box-shadow: 0 0 14px rgba(77, 208, 225, 0.5);
            color: #031a1e;
            font-weight: 900;
          }

          /* Scrollbars */
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-track { background: rgba(4, 8, 22, 0.7); }
          ::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, #d6b25e, #8a7440);
            border-radius: 5px;
            border: 2px solid rgba(4, 8, 22, 0.7);
          }
          ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #f1d98f, #b8923c); }

          .status-indicator {
            display: inline-block;
            width: 8px; height: 8px;
            border-radius: 50%;
            background: var(--cyan);
            animation: pulse 2s infinite;
            margin-right: 8px;
            box-shadow: 0 0 10px rgba(77, 208, 225, 0.7);
          }

          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

          /* Modals */
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(2, 4, 14, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 24px;
            backdrop-filter: blur(4px);
          }

          .modal-content {
            background: linear-gradient(180deg, #121c4a 0%, #070b20 100%);
            border: 1px solid var(--gold);
            border-radius: 6px;
            padding: 24px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 0 0 40px rgba(214, 178, 94, 0.2), 0 8px 32px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(0, 0, 0, 0.6);
          }

          @media (max-width: 768px) {
            body { padding: 8px; }
            .card { padding: 14px; margin-bottom: 16px; }
            h1 { font-size: 19px; letter-spacing: 1.5px; }
            h2 { font-size: 16px; letter-spacing: 1.5px; }
            button { padding: 10px 12px; font-size: 11px; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            table { font-size: 11px; }
            th, td { padding: 6px 4px; }
            th { font-size: 10px; letter-spacing: 0.5px; }
            .modal-content { padding: 16px; }
            .modal-overlay { padding: 12px; }
          }

          @media (max-width: 480px) {
            h1 { font-size: 15px; letter-spacing: 1px; }
            h2 { font-size: 14px; }
            button { padding: 8px 10px; font-size: 10px; letter-spacing: 0; }
            table { font-size: 10px; }
            th, td { padding: 5px 3px; }
            th { font-size: 9px; }
            .card { padding: 12px; margin-bottom: 12px; }
          }
`}} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
