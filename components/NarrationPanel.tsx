'use client';

import { useRef, useState } from 'react';

interface NarrationPanelProps {
  /** Last thing the user said or did (live input) */
  lastInput?: string;
  /** AI-generated story narration */
  narration: string;
  /** Location in story */
  location?: string;
  /** TTS URL for "hear" button */
  narrationAudioUrl?: string | null;
  isLoading: boolean;
}

export default function NarrationPanel({
  lastInput,
  narration,
  location,
  narrationAudioUrl,
  isLoading,
}: NarrationPanelProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playNarration = () => {
    if (!narrationAudioUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    const audio = new Audio(narrationAudioUrl);
    audioRef.current = audio;
    setIsPlayingAudio(true);
    audio.play().catch(() => setIsPlayingAudio(false));
    audio.onended = () => setIsPlayingAudio(false);
  };

  return (
    <section
      className="flex flex-col rounded-xl border border-gold/20 bg-midnight-light/90 backdrop-blur-sm overflow-hidden min-h-[120px]"
      aria-label="Live narration"
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gold/20 bg-black/20">
        <span className="text-lg" aria-hidden>🎤</span>
        <span className="font-display text-gold text-xs tracking-widest uppercase">Narration</span>
      </div>
      <div className="flex-1 p-4 space-y-3">
        {lastInput && (
          <div>
            <p className="text-[10px] font-mono text-lavender-soft/80 uppercase tracking-wider mb-0.5">
              You said
            </p>
            <p className="font-body text-parchment-dim/90 text-sm italic">&ldquo;{lastInput}&rdquo;</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-mono text-gold/80 uppercase tracking-wider mb-0.5">
            AI Story
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                <div className="w-1.5 h-4 rounded-full bg-gold/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-4 rounded-full bg-gold/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-4 rounded-full bg-gold/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-parchment-dim/60 text-sm italic">The story unfolds...</span>
            </div>
          ) : narration ? (
            <p className="font-story text-parchment text-base leading-relaxed italic">
              &ldquo;{narration}&rdquo;
              {narrationAudioUrl && (
                <button
                  type="button"
                  onClick={playNarration}
                  disabled={isPlayingAudio}
                  className="ml-2 text-gold/70 hover:text-gold text-xs font-mono disabled:opacity-50"
                  title="Hear narration"
                >
                  {isPlayingAudio ? '🔊' : '▶ Hear'}
                </button>
              )}
            </p>
          ) : (
            <p className="font-story text-parchment-dim/50 text-sm italic">
              Your story will appear here...
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
