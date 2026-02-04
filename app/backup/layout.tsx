export const metadata = { title: "BDC Swiss — Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", margin: 24 }}>
        {children}
      </body>
    </html>
  );
}
