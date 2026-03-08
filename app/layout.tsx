import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Magical Bedtime Adventure',
  description: 'AI-powered bedtime story generator with personalized images, narration, and music',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="vignette" aria-hidden />
        <div className="relative z-[100] min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
