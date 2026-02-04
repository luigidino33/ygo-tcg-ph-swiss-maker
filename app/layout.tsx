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
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: #f0f0f0;
            padding: 24px;
          }
          
          /* Card-inspired containers */
          .card {
            background: linear-gradient(135deg, #2a2a3e 0%, #1f1f2e 100%);
            border: 3px solid;
            border-image: linear-gradient(135deg, #d4af37, #ffd700, #d4af37) 1;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 
              0 0 30px rgba(212, 175, 55, 0.3),
              0 8px 16px rgba(0, 0, 0, 0.6),
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
            background: linear-gradient(135deg, #ffd700, #ffed4e, #d4af37);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 2px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
            margin-bottom: 16px;
          }
          
          h1 { font-size: 32px; }
          h2 { font-size: 24px; }
          h3 { font-size: 18px; }
          
          /* Buttons - Attack/Defense style */
          button {
            padding: 12px 24px;
            border: 2px solid #d4af37;
            border-radius: 8px;
            background: linear-gradient(135deg, #8b0000, #b22222);
            color: #fff;
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 
              0 4px 8px rgba(0, 0, 0, 0.4),
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
              0 6px 12px rgba(139, 0, 0, 0.6),
              0 0 20px rgba(212, 175, 55, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
            border-color: #ffd700;
          }
          
          button:active {
            transform: translateY(0);
          }
          
          button:disabled {
            background: linear-gradient(135deg, #444, #666);
            border-color: #777;
            cursor: not-allowed;
            opacity: 0.6;
          }
          
          button:disabled:hover {
            transform: none;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
          }
          
          /* Secondary button style */
          button.secondary {
            background: linear-gradient(135deg, #1e3a5f, #2c5f8f);
          }
          
          button.secondary:hover {
            box-shadow: 
              0 6px 12px rgba(30, 58, 95, 0.6),
              0 0 20px rgba(212, 175, 55, 0.4);
          }
          
          /* Success button style */
          button.success {
            background: linear-gradient(135deg, #1e5f3a, #2c8f5f);
          }
          
          button.success:hover {
            box-shadow: 
              0 6px 12px rgba(30, 95, 58, 0.6),
              0 0 20px rgba(212, 175, 55, 0.4);
          }
          
          /* Inputs with card border */
          input, textarea, select {
            width: 100%;
            padding: 12px;
            border: 2px solid #555;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.3);
            color: #f0f0f0;
            font-size: 14px;
            transition: all 0.3s ease;
            margin-bottom: 16px;
          }
          
          input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #d4af37;
            box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.2);
            background: rgba(0, 0, 0, 0.5);
          }
          
          label {
            display: block;
            margin-bottom: 8px;
            color: #d4af37;
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
            border: 2px solid #d4af37;
            border-radius: 8px;
            overflow: hidden;
            background: rgba(0, 0, 0, 0.3);
          }
          
          th {
            background: linear-gradient(135deg, #d4af37, #b8941f);
            color: #1a1a2e;
            padding: 12px;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 1px;
            border-bottom: 2px solid #ffd700;
          }
          
          td {
            padding: 12px;
            border-bottom: 1px solid rgba(212, 175, 55, 0.2);
            background: rgba(26, 26, 46, 0.4);
          }
          
          tr:hover td {
            background: rgba(212, 175, 55, 0.1);
          }
          
          tr:last-child td {
            border-bottom: none;
          }
          
          /* Badge/Rank indicators */
          .rank-1 td, .rank-2 td, .rank-3 td {
            font-weight: bold;
          }
          
          .rank-1 {
            background: linear-gradient(90deg, rgba(255, 215, 0, 0.2), transparent) !important;
          }
          
          .rank-2 {
            background: linear-gradient(90deg, rgba(192, 192, 192, 0.2), transparent) !important;
          }
          
          .rank-3 {
            background: linear-gradient(90deg, rgba(205, 127, 50, 0.2), transparent) !important;
          }
          
          /* Result buttons in active pairings */
          .result-btn {
            padding: 8px 12px;
            margin: 0 4px;
            border: 2px solid #555;
            background: rgba(255, 255, 255, 0.1);
            font-size: 12px;
            min-width: 80px;
          }
          
          .result-btn.selected {
            background: linear-gradient(135deg, #1e5f3a, #2c8f5f);
            border-color: #2c8f5f;
            box-shadow: 0 0 15px rgba(44, 143, 95, 0.6);
          }
          
          .result-btn.tie.selected {
            background: linear-gradient(135deg, #8b6914, #b8941f);
            border-color: #d4af37;
            box-shadow: 0 0 15px rgba(212, 175, 55, 0.6);
          }
          
          /* Scrollbar styling */
          ::-webkit-scrollbar {
            width: 12px;
            height: 12px;
          }
          
          ::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 6px;
          }
          
          ::-webkit-scrollbar-thumb {
            background: linear-gradient(135deg, #d4af37, #b8941f);
            border-radius: 6px;
            border: 2px solid rgba(0, 0, 0, 0.3);
          }
          
          ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(135deg, #ffd700, #d4af37);
          }
          
          /* Loading/Status indicators */
          .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ffd700;
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
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 24px;
          }
          
          .modal-content {
            background: linear-gradient(135deg, #2a2a3e 0%, #1f1f2e 100%);
            border: 3px solid #d4af37;
            border-radius: 12px;
            padding: 24px;
            max-width: 800px;
            width: 100%;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 
              0 0 40px rgba(212, 175, 55, 0.5),
              0 8px 32px rgba(0, 0, 0, 0.8);
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
