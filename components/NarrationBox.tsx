'use client';

import { useEffect, useState, useRef } from 'react';

interface NarrationBoxProps {
  text: string;
  location: string;
  narrationAudioUrl?: string | null;
  isLoading: boolean;
}

export default function NarrationBox({ text, location, narrationAudioUrl, isLoading }: NarrationBoxProps) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Typewriter effect
  useEffect(() => {
    if (!text) return;
    setIsTyping(true);
    setDisplayText('');

    let i = 0;
    const speed = 18; // ms per character
    const timer = setInterval(() => {
      i++;
      setDisplayText(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setIsTyping(false);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text]);

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
    <div className="relative bg-[#12121f]/80 backdrop-blur-sm border border-gold/10 rounded-xl p-6 shadow-xl">
      {/* Location banner */}
      {location && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-gold/40 text-xs">&#9670;</span>
          <span className="font-display text-gold/60 text-xs tracking-[0.2em] uppercase">{location}</span>
          <div className="flex-1 h-px bg-gold/10" />
        </div>
      )}

      {/* Narration text */}
      <div className="min-h-[80px]">
        {isLoading ? (
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-gold/40 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-gold/40 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-gold/40 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-gold/40 italic text-sm">The Dungeon Master speaks...</span>
          </div>
        ) : displayText ? (
          <p className="text-parchment text-lg leading-relaxed font-body italic">
            &ldquo;{displayText}&rdquo;
            {isTyping && <span className="inline-block w-[2px] h-5 bg-gold ml-1 animate-pulse" />}
            {narrationAudioUrl && (
              <button
                type="button"
                onClick={playNarration}
                disabled={isTyping || isPlayingAudio}
                className="ml-3 text-gold/60 hover:text-gold text-sm font-mono disabled:opacity-50"
                title="Hear narration"
              >
                {isPlayingAudio ? '🔊 Playing…' : '▶ Hear'}
              </button>
            )}
          </p>
        ) : (
          <p className="text-parchment/30 text-lg font-body italic">
            Enter an action to begin…
          </p>
        )}
      </div>
    </div>
  );
}
