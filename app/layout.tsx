export const metadata = { title: "BDC Swiss — Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: #e2e8f0;
            padding: 24px;
          }
          
          /* Card-inspired containers */
          .card {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            border: 3px solid;
            border-image: linear-gradient(135deg, #facc15, #fbbf24, #facc15) 1;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 
              0 0 30px rgba(250, 204, 21, 0.25),
              0 8px 16px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
            position: relative;
            overflow: hidden;
          }
          
          .card::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, 
              rgba(212, 175, 55, 0.1) 0%, 
              transparent 50%, 
              rgba(212, 175, 55, 0.1) 100%);
            border-radius: 12px;
            z-index: 0;
            pointer-events: none;
          }
          
          .card > * {
            position: relative;
            z-index: 1;
          }
          
          /* Headers with holographic effect */
          h1, h2, h3 {
            background: linear-gradient(135deg, #fbbf24, #fde047, #facc15);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 2px;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
            margin-bottom: 16px;
          }
          
          h1 { font-size: 32px; }
          h2 { font-size: 24px; }
          h3 { font-size: 18px; }
          
          /* Buttons - Attack/Defense style */
          button {
            padding: 12px 24px;
            border: 2px solid #facc15;
            border-radius: 8px;
            background: linear-gradient(135deg, #dc2626, #ef4444);
            color: #fff;
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 
              0 4px 8px rgba(0, 0, 0, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
            position: relative;
            overflow: hidden;
          }
          
          button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            transition: left 0.5s;
          }
          
          button:hover::before {
            left: 100%;
          }
          
          button:hover {
            transform: translateY(-2px);
            box-shadow: 
              0 6px 12px rgba(220, 38, 38, 0.4),
              0 0 20px rgba(250, 204, 21, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
            border-color: #fde047;
          }
          
          button:active {
            transform: translateY(0);
          }
          
          button:disabled {
            background: linear-gradient(135deg, #475569, #64748b);
            border-color: #94a3b8;
            cursor: not-allowed;
            opacity: 0.5;
          }
          
          button:disabled:hover {
            transform: none;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          
          /* Secondary button style */
          button.secondary {
            background: linear-gradient(135deg, #0369a1, #0284c7);
            border-color: #38bdf8;
          }
          
          button.secondary:hover {
            box-shadow: 
              0 6px 12px rgba(3, 105, 161, 0.4),
              0 0 20px rgba(56, 189, 248, 0.3);
            border-color: #7dd3fc;
          }
          
          /* Success button style */
          button.success {
            background: linear-gradient(135deg, #15803d, #16a34a);
            border-color: #4ade80;
          }
          
          button.success:hover {
            box-shadow: 
              0 6px 12px rgba(21, 128, 61, 0.4),
              0 0 20px rgba(74, 222, 128, 0.3);
            border-color: #86efac;
          }
          
          /* Inputs with card border */
          input, textarea, select {
            width: 100%;
            padding: 12px;
            border: 2px solid #475569;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.6);
            color: #f1f5f9;
            font-size: 14px;
            transition: all 0.3s ease;
            margin-bottom: 16px;
          }
          
          input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #facc15;
            box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.2);
            background: rgba(15, 23, 42, 0.8);
          }
          
          label {
            display: block;
            margin-bottom: 8px;
            color: #fde047;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 1px;
          }
          
          /* Tables - stat card style */
          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            border: 2px solid #facc15;
            border-radius: 8px;
            overflow: hidden;
            background: rgba(15, 23, 42, 0.4);
          }
          
          th {
            background: linear-gradient(135deg, #facc15, #fde047);
            color: #0f172a;
            padding: 12px;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 1px;
            border-bottom: 2px solid #fef08a;
          }
          
          td {
            padding: 12px;
            border-bottom: 1px solid rgba(250, 204, 21, 0.15);
            background: rgba(30, 41, 59, 0.5);
            color: #e2e8f0;
          }
          
          tr:hover td {
            background: rgba(250, 204, 21, 0.08);
          }
          
          tr:last-child td {
            border-bottom: none;
          }
          
          /* Badge/Rank indicators */
          .rank-1 td, .rank-2 td, .rank-3 td {
            font-weight: bold;
          }
          
          .rank-1 {
            background: linear-gradient(90deg, rgba(250, 204, 21, 0.25), transparent) !important;
          }
          
          .rank-2 {
            background: linear-gradient(90deg, rgba(226, 232, 240, 0.2), transparent) !important;
          }
          
          .rank-3 {
            background: linear-gradient(90deg, rgba(251, 146, 60, 0.2), transparent) !important;
          }
          
          /* Pairing cards - new format */
          .pairing-card {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            border: 2px solid #64748b;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          }
          
          .pairing-card:hover {
            border-color: #facc15;
            box-shadow: 0 6px 12px rgba(250, 204, 21, 0.2);
          }
          
          .pairing-card.completed {
            border-color: #4ade80;
            background: linear-gradient(135deg, rgba(21, 128, 61, 0.1), rgba(22, 163, 74, 0.05));
          }
          
          .table-number {
            display: inline-block;
            background: linear-gradient(135deg, #facc15, #fde047);
            color: #0f172a;
            font-weight: 900;
            font-size: 20px;
            padding: 8px 16px;
            border-radius: 8px;
            min-width: 60px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          }
          
          .player-name {
            font-size: 18px;
            font-weight: bold;
            color: #f1f5f9;
            margin: 8px 0;
          }
          
          .player-name.winner {
            color: #4ade80;
            text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
          }
          
          .vs-badge {
            display: inline-block;
            background: rgba(250, 204, 21, 0.2);
            color: #fde047;
            padding: 4px 12px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            letter-spacing: 2px;
          }
          
          /* Result buttons in active pairings */
          .result-btn {
            padding: 10px 20px;
            margin: 4px;
            border: 2px solid #475569;
            background: linear-gradient(135deg, #334155, #475569);
            font-size: 13px;
            min-width: 100px;
            color: #e2e8f0;
            transition: all 0.3s ease;
          }
          
          .result-btn:hover {
            border-color: #94a3b8;
            transform: translateY(-1px);
          }
          
          .result-btn.selected {
            background: linear-gradient(135deg, #15803d, #16a34a);
            border-color: #4ade80;
            box-shadow: 0 0 15px rgba(74, 222, 128, 0.4);
            color: #fff;
          }
          
          .result-btn.tie.selected {
            background: linear-gradient(135deg, #ca8a04, #eab308);
            border-color: #facc15;
            box-shadow: 0 0 15px rgba(250, 204, 21, 0.4);
            color: #0f172a;
            font-weight: 900;
          }
          
          /* Scrollbar styling */
          ::-webkit-scrollbar {
            width: 12px;
            height: 12px;
          }
          
          ::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.5);
            border-radius: 6px;
          }
          
          ::-webkit-scrollbar-thumb {
            background: linear-gradient(135deg, #facc15, #fde047);
            border-radius: 6px;
            border: 2px solid rgba(15, 23, 42, 0.5);
          }
          
          ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(135deg, #fde047, #fef08a);
          }
          
          /* Loading/Status indicators */
          .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #fde047;
            animation: pulse 2s infinite;
            margin-right: 8px;
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          
          /* Modal overlays */
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 24px;
            backdrop-filter: blur(4px);
          }
          
          .modal-content {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            border: 3px solid #facc15;
            border-radius: 12px;
            padding: 24px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 
              0 0 40px rgba(250, 204, 21, 0.3),
              0 8px 32px rgba(0, 0, 0, 0.6);
          }
          
          /* Responsive */
          @media (max-width: 768px) {
            body {
              padding: 12px;
            }
            
            .card {
              padding: 16px;
            }
            
            h1 { font-size: 24px; }
            h2 { font-size: 20px; }
            
            button {
              padding: 10px 16px;
              font-size: 12px;
            }
            
            table {
              font-size: 12px;
            }
            
            th, td {
              padding: 8px;
            }
          }
        `}} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
