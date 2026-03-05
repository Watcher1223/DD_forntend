'use client';

import { useState } from 'react';

interface SceneArtworkProps {
  imageUrl: string | null;
  imageSource?: 'nanobanana' | 'imagen' | 'placeholder' | null;
  isLoading: boolean;
  eventNumber: number;
}

export default function SceneArtwork({ imageUrl, imageSource, isLoading, eventNumber }: SceneArtworkProps) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-gold/20 shadow-2xl">
      {/* Loading shimmer */}
      {(isLoading || (!imgLoaded && imageUrl)) && (
        <div className="absolute inset-0 shimmer flex items-center justify-center z-10">
          <div className="text-center">
            <div className="text-gold text-4xl animate-pulse-slow">&#9876;</div>
            <p className="text-gold/60 text-sm mt-2 font-body">The scene unfolds...</p>
          </div>
        </div>
      )}

      {/* Scene image */}
      {imageUrl ? (
        <img
          key={eventNumber}
          src={imageUrl}
          alt="Scene artwork"
          className={`w-full h-full object-cover transition-opacity duration-700 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a2e] to-[#0a0a12] flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">&#9876;</div>
            <p className="font-display text-gold text-xl tracking-widest">LIVING WORLDS</p>
            <p className="text-gold/40 text-sm mt-1 font-body italic">Speak your action to begin...</p>
          </div>
        </div>
      )}

      {/* Cinematic overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a12] via-transparent to-transparent pointer-events-none" />

      {/* Event counter + image source label */}
      {(eventNumber > 0 || imageSource) && (
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {imageSource === 'placeholder' && (
            <span className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded border border-gold/20 text-gold/60 text-[10px] font-mono uppercase">
              Preview
            </span>
          )}
          {imageSource && imageSource !== 'placeholder' && (
            <span className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded border border-gold/20 text-gold/80 text-[10px] font-mono uppercase">
              AI
            </span>
          )}
          {eventNumber > 0 && (
            <span className="bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full border border-gold/20 text-gold/80 text-xs font-mono">
              Scene {eventNumber}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
