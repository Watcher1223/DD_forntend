'use client';

import { useState, useEffect, useRef } from 'react';

interface StoryWorldProps {
  imageUrl: string | null;
  imageSource?: 'nanobanana' | 'imagen' | null;
  isLoading: boolean;
  eventNumber: number;
  /** Optional location label overlay */
  location?: string;
}

export default function StoryWorld({
  imageUrl,
  imageSource,
  isLoading,
  eventNumber,
  location,
}: StoryWorldProps) {
  const [flipKey, setFlipKey] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const prevImageUrl = useRef<string | null>(null);

  useEffect(() => {
    if (imageUrl && imageUrl !== prevImageUrl.current) {
      prevImageUrl.current = imageUrl;
      setFlipKey((k) => k + 1);
    }
  }, [imageUrl]);

  return (
    <section
      className="relative w-full aspect-video min-h-[280px] rounded-2xl overflow-hidden border-2 border-gold/30 shadow-[0_0_60px_rgba(212,168,83,0.15)]"
      aria-label="Story World"
    >
      {/* Decorative corner */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold/50 to-transparent z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-lavender/30 to-transparent z-10" />

      {/* Loading / placeholder */}
      {(isLoading || (!imgLoaded && imageUrl)) && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-midnight-light/95">
          <div className="text-center">
            <div className="text-5xl mb-3 animate-pulse" aria-hidden>🌙</div>
            <p className="font-story text-gold-soft/90 text-lg italic">The scene unfolds...</p>
            <div className="flex justify-center gap-1 mt-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-8 rounded-full bg-lavender/40 waveform-bar"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scene image with page-turn on change */}
      {imageUrl ? (
        <div
          key={flipKey}
          className={`absolute inset-0 page-turn ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <img
            src={imageUrl}
            alt="Story scene"
            className="w-full h-full object-cover transition-opacity duration-500"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-midnight-light via-midnight to-midnight-light flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🌙</div>
            <p className="font-display text-gold text-2xl tracking-widest">STORY WORLD</p>
            <p className="font-story text-parchment-dim/60 text-base mt-2 italic">
              Say a theme or take an action to begin...
            </p>
          </div>
        </div>
      )}

      {/* Overlay gradient for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-midnight/80 via-transparent to-transparent pointer-events-none z-[5]" />

      {/* Location + scene badge */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-10">
        {location && (
          <span className="font-display text-gold-soft/90 text-sm tracking-wider uppercase drop-shadow-lg">
            ✦ {location}
          </span>
        )}
        <div className="flex items-center gap-2">
          {imageSource && (
            <span className="bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-gold/90 uppercase">
              AI
            </span>
          )}
          {eventNumber > 0 && (
            <span className="bg-black/50 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-xs font-mono text-parchment/80">
              Scene {eventNumber}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
