'use client';

interface GameEvent {
  action: string;
  diceRoll: number | null;
  narration: string;
  music_mood: string;
  location: string;
  timestamp: number;
}

interface EventLogProps {
  events: GameEvent[];
}

export default function EventLog({ events }: EventLogProps) {
  if (events.length === 0) return null;

  return (
    <div className="bg-[#12121f]/60 backdrop-blur-sm border border-gold/10 rounded-xl p-4 shadow-xl max-h-48 overflow-y-auto">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gold/40 text-xs">&#9670;</span>
        <span className="font-display text-gold/40 text-[10px] tracking-[0.3em] uppercase">Campaign Journal</span>
        <div className="flex-1 h-px bg-gold/10" />
        <span className="text-gold/30 text-xs font-mono">{events.length} entries</span>
      </div>

      <div className="space-y-2">
        {events.slice().reverse().map((evt, i) => (
          <div key={events.length - 1 - i} className="flex gap-3 text-xs">
            <span className="text-gold/30 font-mono shrink-0 w-4">{events.length - i}</span>
            {evt.diceRoll && (
              <span className={`shrink-0 font-mono font-bold ${
                evt.diceRoll >= 16 ? 'text-emerald-400' :
                evt.diceRoll >= 11 ? 'text-parchment/60' :
                evt.diceRoll >= 6 ? 'text-orange-400' :
                'text-red-400'
              }`}>
                [{evt.diceRoll}]
              </span>
            )}
            <p className="text-parchment/40 font-body line-clamp-1 italic">{evt.narration}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
