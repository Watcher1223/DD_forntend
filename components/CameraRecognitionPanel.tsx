'use client';

import { useRef, useEffect, useState } from 'react';
import type { CameraProfile } from '@/lib/api-types';

interface CameraRecognitionPanelProps {
  /** Show the live camera feed */
  showFeed?: boolean;
  /** Detected profile labels to show as checkmarks */
  detectedLabels: string[];
  /** Callback to request camera (parent starts stream and passes videoRef or sets showFeed) */
  onRequestCamera?: () => void;
  /** Optional video stream for preview */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export default function CameraRecognitionPanel({
  showFeed = false,
  detectedLabels,
  onRequestCamera,
  videoRef: externalVideoRef,
}: CameraRecognitionPanelProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || localVideoRef;
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    if (!showFeed || !videoRef?.current) return;
    const v = videoRef.current;
    const check = () => setHasStream(!!v.srcObject);
    check();
    const obs = new MutationObserver(check);
    obs.observe(v, { attributes: true, attributeFilter: ['srcObject'] });
    return () => obs.disconnect();
  }, [showFeed, videoRef]);

  return (
    <section
      className="rounded-xl border border-gold/20 bg-midnight-light/90 backdrop-blur-sm overflow-hidden w-full max-w-[200px]"
      aria-label="Camera recognition"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gold/20 bg-black/20">
        <span className="text-sm" aria-hidden>🎥</span>
        <span className="font-mono text-gold/90 text-[10px] uppercase tracking-wider">
          Camera
        </span>
      </div>
      <div className="p-2 space-y-2">
        {showFeed ? (
          <div className="relative aspect-video rounded-lg overflow-hidden bg-midnight border border-gold/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!hasStream && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-parchment-dim/50 text-xs">No feed</span>
              </div>
            )}
          </div>
        ) : (
          <div
            className="aspect-video rounded-lg bg-midnight/80 border border-gold/10 flex items-center justify-center cursor-pointer hover:border-gold/30 transition-colors"
            onClick={onRequestCamera}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onRequestCamera?.()}
          >
            <span className="text-parchment-dim/50 text-xs text-center">
              Tap to enable
            </span>
          </div>
        )}
        <div>
          <p className="text-[10px] font-mono text-gold/70 uppercase tracking-wider mb-1">
            Detected
          </p>
          <ul className="space-y-0.5">
            {detectedLabels.length === 0 ? (
              <li className="text-parchment-dim/50 text-xs">—</li>
            ) : (
              detectedLabels.map((label) => (
                <li key={label} className="flex items-center gap-1.5 text-xs text-parchment-dim/90">
                  <span className="text-lavender-soft">✓</span>
                  {label}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
