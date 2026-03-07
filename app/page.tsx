'use client';

import BedtimeStoryView from '@/components/BedtimeStoryView';

/**
 * Main page — renders the full bedtime story experience:
 * face scan -> configure -> music session + story beats with scene images.
 */
export default function HomePage() {
  return (
    <main className="min-h-screen relative">
      <div className="fixed inset-0 bg-gradient-to-b from-midnight via-midnight-light/30 to-midnight -z-10" />

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        <header className="text-center mb-2">
          <h1 className="font-display text-gold text-3xl tracking-[0.12em] uppercase">
            The Magical Bedtime Adventure
          </h1>
          <p className="text-parchment-dim/60 text-xs tracking-[0.2em] uppercase mt-1 font-body">
            AI-Powered Bedtime Story Generator
          </p>
        </header>

        <BedtimeStoryView />

        <footer className="flex items-center justify-center pt-2">
          <span className="text-parchment-dim/50 text-[10px] font-mono">
            Powered by Gemini + Imagen + Lyria
          </span>
        </footer>
      </div>
    </main>
  );
}
