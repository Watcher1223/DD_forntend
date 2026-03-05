import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Living Worlds — AI Dungeon Master',
  description: 'Real-time AI Dungeon Master that narrates, draws, and scores a fantasy world',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="vignette" />
        {children}
      </body>
    </html>
  );
}
