'use client';

import { useEffect, useRef, useState } from 'react';

interface MusicMoodPanelProps {
  mood: string;
  audioUrl: string | null;
  hasLyria?: boolean;
  /** Trigger play after narration (same as main MusicMood) */
  musicPlayRequest?: number | null;
}

const MOOD_ICONS: Record<string, string> = {
  tavern: '🍺',
  forest: '🌲',
  battle: '⚔️',
  mystery: '🔮',
  victory: '🏆',
  danger: '😨',
  calm: '😴',
  epic: '🐉',
  sleepy: '😴',
  suspense: '😨',
  joy: '😂',
  adventure: '⚔️',
};

export default function MusicMoodPanel({
  mood,
  audioUrl,
  hasLyria = true,
  musicPlayRequest,
}: MusicMoodPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.35);
  const lastPlayRequestRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioUrl) return;
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(audioUrl);
    audio.loop = true;
    audio.volume = volume;
    audioRef.current = audio;
    lastPlayRequestRef.current = null;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!musicPlayRequest || !audioUrl || !hasLyria) return;
    if (lastPlayRequestRef.current === musicPlayRequest) return;
    lastPlayRequestRef.current = musicPlayRequest;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [musicPlayRequest, audioUrl, hasLyria, volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const icon = MOOD_ICONS[mood?.toLowerCase()] || '🎵';
  const moodLabel = mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : '—';

  return (
    <section
      className="flex flex-col rounded-xl border border-gold/20 bg-midnight-light/90 backdrop-blur-sm overflow-hidden min-h-[120px]"
      aria-label="Emotion and music"
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gold/20 bg-black/20">
        <span className="text-lg" aria-hidden>🎵</span>
        <span className="font-display text-gold text-xs tracking-widest uppercase">
          Emotion & Music
        </span>
      </div>
      <div className="flex-1 p-4 flex flex-col items-center justify-center">
        {!hasLyria ? (
          <p className="text-parchment-dim/50 text-xs italic">Music unavailable</p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl mood-pulse" aria-hidden>{icon}</span>
              <div className="text-center">
                <p className="text-[10px] font-mono text-gold/80 uppercase tracking-wider">
                  Mood
                </p>
                <p className="font-display text-parchment text-sm tracking-wide">{moodLabel}</p>
              </div>
            </div>
            {/* Simple waveform */}
            <div className="flex items-end justify-center gap-0.5 h-8 mb-2">
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-lavender/50 waveform-bar"
                  style={{
                    animationDelay: `${i * 0.08}s`,
                    height: audioUrl && isPlaying ? undefined : '6px',
                  }}
                />
              ))}
            </div>
            {audioUrl && (
              <button
                type="button"
                onClick={togglePlay}
                className="text-[10px] font-mono text-gold/70 hover:text-gold transition-colors"
              >
                {isPlaying ? '◼ Stop' : '▶ Play'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
