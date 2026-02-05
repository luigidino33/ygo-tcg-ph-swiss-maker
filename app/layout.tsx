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
            background: linear-gradient(135deg, #0c1445 0%, #1a237e 50%, #283593 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: #e8eaf6;
            padding: 24px;
          }
          
          /* Card-inspired containers */
          .card {
            background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
            border: 3px solid;
            border-image: linear-gradient(135deg, #64b5f6, #90caf9, #64b5f6) 1;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 
              0 0 30px rgba(100, 181, 246, 0.3),
              0 8px 16px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
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
              rgba(100, 181, 246, 0.15) 0%, 
              transparent 50%, 
              rgba(100, 181, 246, 0.15) 100%);
            border-radius: 12px;
            z-index: 0;
            pointer-events: none;
          }
          
          .card > * {
            position: relative;
            z-index: 1;
          }
          
          /* Headers with Blue Eyes glow effect */
          h1, h2, h3 {
            background: linear-gradient(135deg, #e1f5fe, #b3e5fc, #81d4fa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 2px;
            filter: drop-shadow(0 0 8px rgba(129, 212, 250, 0.8));
            margin-bottom: 16px;
          }
          
          h1 { font-size: 32px; }
          h2 { font-size: 24px; }
          h3 { font-size: 18px; }
          
          /* Buttons - Blue Eyes attack style with Yugi purple accents */
          button {
            padding: 12px 24px;
            border: 2px solid #64b5f6;
            border-radius: 8px;
            background: linear-gradient(135deg, #5e35b1, #7e57c2);
            color: #fff;
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 
              0 4px 8px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.2),
              0 0 15px rgba(100, 181, 246, 0.3);
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
            background: linear-gradient(90deg, transparent, rgba(225, 245, 254, 0.4), transparent);
            transition: left 0.5s;
          }
          
          button:hover::before {
            left: 100%;
          }
          
          button:hover {
            transform: translateY(-2px);
            box-shadow: 
              0 6px 12px rgba(94, 53, 177, 0.5),
              0 0 25px rgba(100, 181, 246, 0.5),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
            border-color: #90caf9;
          }
          
          button:active {
            transform: translateY(0);
          }
          
          button:disabled {
            background: linear-gradient(135deg, #37474f, #546e7a);
            border-color: #78909c;
            cursor: not-allowed;
            opacity: 0.5;
          }
          
          button:disabled:hover {
            transform: none;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          
          /* Secondary button style - lighter blue */
          button.secondary {
            background: linear-gradient(135deg, #1976d2, #2196f3);
            border-color: #64b5f6;
          }
          
          button.secondary:hover {
            box-shadow: 
              0 6px 12px rgba(25, 118, 210, 0.5),
              0 0 25px rgba(100, 181, 246, 0.4);
            border-color: #90caf9;
          }
          
          /* Success button style - keep green for wins */
          button.success {
            background: linear-gradient(135deg, #388e3c, #4caf50);
            border-color: #81c784;
          }
          
          button.success:hover {
            box-shadow: 
              0 6px 12px rgba(56, 142, 60, 0.5),
              0 0 25px rgba(129, 199, 132, 0.4);
            border-color: #a5d6a7;
          }
          
          /* Inputs with card border */
          input, textarea, select {
            width: 100%;
            padding: 12px;
            border: 2px solid #5c6bc0;
            border-radius: 8px;
            background: rgba(12, 20, 69, 0.7);
            color: #e8eaf6;
            font-size: 14px;
            transition: all 0.3s ease;
            margin-bottom: 16px;
          }
          
          input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #64b5f6;
            box-shadow: 0 0 0 3px rgba(100, 181, 246, 0.3);
            background: rgba(12, 20, 69, 0.9);
          }
          
          label {
            display: block;
            margin-bottom: 8px;
            color: #90caf9;
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
            border: 2px solid #64b5f6;
            border-radius: 8px;
            overflow: hidden;
            background: rgba(12, 20, 69, 0.5);
          }
          
          th {
            background: linear-gradient(135deg, #64b5f6, #90caf9);
            color: #0c1445;
            padding: 12px;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 1px;
            border-bottom: 2px solid #bbdefb;
          }
          
          td {
            padding: 12px;
            border-bottom: 1px solid rgba(100, 181, 246, 0.2);
            background: rgba(26, 35, 126, 0.5);
            color: #e8eaf6;
          }
          
          tr:hover td {
            background: rgba(100, 181, 246, 0.15);
          }
          
          tr:last-child td {
            border-bottom: none;
          }
          
          /* Badge/Rank indicators */
          .rank-1 td, .rank-2 td, .rank-3 td {
            font-weight: bold;
          }
          
          .rank-1 {
            background: linear-gradient(90deg, rgba(255, 215, 0, 0.3), transparent) !important;
          }
          
          .rank-2 {
            background: linear-gradient(90deg, rgba(192, 192, 192, 0.3), transparent) !important;
          }
          
          .rank-3 {
            background: linear-gradient(90deg, rgba(205, 127, 50, 0.3), transparent) !important;
          }
          
          /* Pairing cards - Challonge-inspired format */
          .pairing-card {
            background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
            border: 2px solid #5c6bc0;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          
          .pairing-card:hover {
            border-color: #64b5f6;
            box-shadow: 0 6px 12px rgba(100, 181, 246, 0.3);
          }
          
          .pairing-card.completed {
            border-color: #81c784;
            background: linear-gradient(135deg, rgba(56, 142, 60, 0.15), rgba(76, 175, 80, 0.08));
          }
          
          .table-number {
            display: inline-block;
            background: linear-gradient(135deg, #64b5f6, #90caf9);
            color: #0c1445;
            font-weight: 900;
            font-size: 20px;
            padding: 8px 16px;
            border-radius: 8px;
            min-width: 60px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4), 0 0 15px rgba(100, 181, 246, 0.4);
          }
          
          .player-name {
            font-size: 18px;
            font-weight: bold;
            color: #e8eaf6;
            margin: 8px 0;
          }
          
          .player-name.winner {
            color: #81c784;
            text-shadow: 0 0 10px rgba(129, 199, 132, 0.6);
          }
          
          .vs-badge {
            display: inline-block;
            background: rgba(94, 53, 177, 0.3);
            color: #b39ddb;
            padding: 4px 12px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            letter-spacing: 2px;
            border: 1px solid rgba(179, 157, 219, 0.3);
          }
          
          /* Result buttons in active pairings */
          .result-btn {
            padding: 10px 20px;
            margin: 4px;
            border: 2px solid #5c6bc0;
            background: linear-gradient(135deg, #283593, #3949ab);
            font-size: 13px;
            min-width: 100px;
            color: #e8eaf6;
            transition: all 0.3s ease;
          }
          
          .result-btn:hover {
            border-color: #7986cb;
            transform: translateY(-1px);
          }
          
          .result-btn.selected {
            background: linear-gradient(135deg, #388e3c, #4caf50);
            border-color: #81c784;
            box-shadow: 0 0 15px rgba(129, 199, 132, 0.5);
            color: #fff;
          }
          
          .result-btn.tie.selected {
            background: linear-gradient(135deg, #1976d2, #2196f3);
            border-color: #64b5f6;
            box-shadow: 0 0 15px rgba(100, 181, 246, 0.5);
            color: #fff;
            font-weight: 900;
          }
          
          /* Scrollbar styling */
          ::-webkit-scrollbar {
            width: 12px;
            height: 12px;
          }
          
          ::-webkit-scrollbar-track {
            background: rgba(12, 20, 69, 0.5);
            border-radius: 6px;
          }
          
          ::-webkit-scrollbar-thumb {
            background: linear-gradient(135deg, #64b5f6, #90caf9);
            border-radius: 6px;
            border: 2px solid rgba(12, 20, 69, 0.5);
          }
          
          ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(135deg, #90caf9, #bbdefb);
          }
          
          /* Loading/Status indicators */
          .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #90caf9;
            animation: pulse 2s infinite;
            margin-right: 8px;
            box-shadow: 0 0 10px rgba(144, 202, 249, 0.6);
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          
          /* Modal overlays */
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(12, 20, 69, 0.92);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 24px;
            backdrop-filter: blur(4px);
          }
          
          .modal-content {
            background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
            border: 3px solid #64b5f6;
            border-radius: 12px;
            padding: 24px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 
              0 0 40px rgba(100, 181, 246, 0.4),
              0 8px 32px rgba(0, 0, 0, 0.7);
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
