import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LAIL HERMES — Windows-Local AI Agent & Operator Dashboard',
  description: 'A Windows-local, Telegram-driven AI orchestrator and real-time agent dashboard UI.',
  keywords: ['Hermes', 'AI Agent', 'Orchestrator', 'Next.js', 'Dashboard', 'Voice Assistant'],
  authors: [{ name: 'Faris' }],
};

export const viewport: Viewport = {
  themeColor: '#0b0c10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Orbitron:wght@500;700;900&family=Outfit:wght@400;600;700&family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
