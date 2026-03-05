'use client';

interface DiceDisplayProps {
  value: number | null;
  isRolling: boolean;
}

export default function DiceDisplay({ value, isRolling }: DiceDisplayProps) {
  const getColor = (v: number) => {
    if (v === 20) return 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]';
    if (v === 1) return 'text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]';
    if (v >= 16) return 'text-emerald-400';
    if (v >= 11) return 'text-parchment';
    if (v >= 6) return 'text-orange-400';
    return 'text-red-400';
  };

  const getLabel = (v: number) => {
    if (v === 20) return 'CRITICAL!';
    if (v === 1) return 'FUMBLE!';
    if (v >= 16) return 'Great Success';
    if (v >= 11) return 'Success';
    if (v >= 6) return 'Partial Fail';
    return 'Failure';
  };

  return (
    <div className="flex flex-col items-center justify-center bg-[#12121f]/80 backdrop-blur-sm border border-gold/10 rounded-xl p-4 shadow-xl">
      <span className="font-display text-gold/40 text-[10px] tracking-[0.3em] uppercase mb-2">d20 Roll</span>

      {isRolling ? (
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 border-2 border-gold/30 rounded-lg animate-spin" />
          <span className="font-display text-gold text-2xl animate-pulse">?</span>
        </div>
      ) : value !== null ? (
        <div className="dice-reveal">
          <div className={`relative w-16 h-16 flex items-center justify-center ${value === 20 ? 'animate-glow' : ''}`}>
            {/* D20 shape (simplified) */}
            <div className={`absolute inset-0 border-2 rounded-lg rotate-45 ${
              value === 20 ? 'border-yellow-400/50 bg-yellow-400/5' :
              value === 1 ? 'border-red-500/50 bg-red-500/5' :
              'border-gold/20 bg-gold/5'
            }`} />
            <span className={`font-display text-3xl font-bold relative z-10 ${getColor(value)}`}>
              {value}
            </span>
          </div>
          <span className={`text-xs font-display tracking-wider mt-2 block text-center ${getColor(value)}`}>
            {getLabel(value)}
          </span>
        </div>
      ) : (
        <div className="w-16 h-16 flex items-center justify-center">
          <div className="border-2 border-gold/10 rounded-lg rotate-45 w-full h-full flex items-center justify-center">
            <span className="text-gold/20 -rotate-45 font-display text-xl">20</span>
          </div>
        </div>
      )}
    </div>
  );
}
