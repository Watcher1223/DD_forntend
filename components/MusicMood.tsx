'use client';

import { useEffect, useRef, useState } from 'react';

interface MusicMoodProps {
  mood: string;
  audioUrl: string | null;
}

const MOOD_ICONS: Record<string, string> = {
  tavern: '🍺',
  forest: '🌲',
  battle: '⚔️',
  mystery: '🔮',
  victory: '🏆',
  danger: '💀',
  calm: '🌙',
  epic: '🐉',
};

const MOOD_COLORS: Record<string, string> = {
  tavern: 'from-amber-900/30 to-amber-800/10 border-amber-600/20',
  forest: 'from-emerald-900/30 to-emerald-800/10 border-emerald-600/20',
  battle: 'from-red-900/30 to-red-800/10 border-red-600/20',
  mystery: 'from-purple-900/30 to-purple-800/10 border-purple-600/20',
  victory: 'from-yellow-900/30 to-yellow-800/10 border-yellow-600/20',
  danger: 'from-red-950/30 to-red-900/10 border-red-700/20',
  calm: 'from-blue-900/30 to-blue-800/10 border-blue-600/20',
  epic: 'from-gold/20 to-gold/5 border-gold/30',
};

export default function MusicMood({ mood, audioUrl }: MusicMoodProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);

  useEffect(() => {
    if (!audioUrl) return;

    // Crossfade: fade out old, start new
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(audioUrl);
    audio.loop = true;
    audio.volume = volume;
    audioRef.current = audio;

    // Auto-play requires user interaction first — try it
    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(() => {
      // Browser blocked auto-play, user will need to click
      setIsPlaying(false);
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl]);

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

  const colors = MOOD_COLORS[mood] || MOOD_COLORS.calm;

  return (
    <div className={`flex flex-col items-center justify-center bg-gradient-to-b ${colors} backdrop-blur-sm border rounded-xl p-4 shadow-xl transition-all duration-700`}>
      <span className="font-display text-gold/40 text-[10px] tracking-[0.3em] uppercase mb-2">Soundtrack</span>

      <div className="flex items-center gap-3">
        <span className="text-2xl mood-pulse">{MOOD_ICONS[mood] || '🎵'}</span>
        <div>
          <span className="font-display text-parchment text-sm capitalize tracking-wider">{mood || 'silence'}</span>
          {audioUrl && (
            <button
              onClick={togglePlay}
              className="block text-[10px] text-gold/50 hover:text-gold transition-colors mt-0.5"
            >
              {isPlaying ? '◼ Stop' : '▶ Play'}
            </button>
          )}
        </div>
      </div>

      {/* Volume slider */}
      {audioUrl && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full mt-3 h-1 accent-gold/60 bg-gold/10 rounded-full appearance-none cursor-pointer"
        />
      )}
    </div>
  );
}
