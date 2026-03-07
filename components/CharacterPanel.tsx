'use client';

import type { CameraProfile, CharacterAppearance } from '@/lib/api-types';

interface CharacterPanelProps {
  /** Profiles from GET /api/camera/profiles or CharacterSetup onComplete */
  profiles: CameraProfile[];
  /** Optional: map profile label to story character name, e.g. { adult: "Captain Alex", child: "First Mate" } */
  storyNames?: Record<string, string>;
}

const LABEL_ICONS: Record<string, string> = {
  child: '🧒',
  adult: '🧑',
  child_1: '👧',
  child_2: '👦',
  default: '🎭',
};

function getIcon(label: string): string {
  const key = label.toLowerCase().replace(/\s/g, '_');
  return LABEL_ICONS[key] || LABEL_ICONS.default;
}

function CharacterCard({
  profile,
  storyName,
}: {
  profile: CameraProfile;
  storyName?: string;
}) {
  const { label, appearance } = profile;
  const summary = [appearance.hair, appearance.clothing, appearance.features]
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ') || 'In the story';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gold/15 bg-black/20 p-2.5">
      <div className="w-10 h-10 rounded-full bg-midnight-light border border-gold/20 flex items-center justify-center text-xl shrink-0">
        {getIcon(label)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-gold text-xs tracking-wider truncate">
          {storyName || label}
        </p>
        <p className="text-[10px] text-parchment-dim/70 truncate" title={summary}>
          {summary}
        </p>
      </div>
      {storyName && storyName !== label && (
        <span className="text-[10px] font-mono text-lavender-soft/80">→</span>
      )}
    </div>
  );
}

export default function CharacterPanel({ profiles, storyNames = {} }: CharacterPanelProps) {
  return (
    <section
      className="flex flex-col rounded-xl border border-gold/20 bg-midnight-light/90 backdrop-blur-sm overflow-hidden min-h-[120px]"
      aria-label="Characters in story"
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gold/20 bg-black/20">
        <span className="text-lg" aria-hidden>🎭</span>
        <span className="font-display text-gold text-xs tracking-widest uppercase">Characters</span>
      </div>
      <div className="flex-1 p-3 space-y-2 overflow-y-auto max-h-[140px]">
        {profiles.length === 0 ? (
          <p className="text-parchment-dim/50 text-xs italic py-2">
            Enable camera to see yourself in the story.
          </p>
        ) : (
          profiles.map((p) => (
            <CharacterCard
              key={p.label}
              profile={p}
              storyName={storyNames[p.label]}
            />
          ))
        )}
      </div>
    </section>
  );
}
