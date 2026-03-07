'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import type {
  CameraProfile,
  CameraAnalyzeResponse,
  CameraProfilesResponse,
  CharacterAppearance,
  PairResponse,
  ProfilesUpdatedMessage,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';

type Phase = 'loading' | 'prompt' | 'camera' | 'capturing' | 'analyzing' | 'pairing' | 'results';

const FRAME_COUNT = 3;
const FRAME_DELAY_MS = 1500;

interface CharacterSetupProps {
  hasVision: boolean;
  hasSubjectCustomization?: boolean;
  campaignId?: number;
  onComplete: (profiles: CameraProfile[]) => void;
  onSkip: () => void;
}

/**
 * Pre-game camera flow: captures webcam frames, sends them to Gemini Vision
 * for character appearance analysis, and stores reference frames for
 * personalized image generation (Imagen 3 Subject Customization).
 */
export default function CharacterSetup({
  hasVision,
  hasSubjectCustomization = false,
  campaignId,
  onComplete,
  onSkip,
}: CharacterSetupProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [people, setPeople] = useState<CharacterAppearance[]>([]);
  const [setting, setSetting] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [frameProgress, setFrameProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Load existing profiles on mount ──
  useEffect(() => {
    if (!hasVision) {
      onSkip();
      return;
    }
    loadExistingProfiles();
  }, [hasVision]);

  async function loadExistingProfiles() {
    try {
      const url = campaignId
        ? `${API_BASE}/api/camera/profiles?campaignId=${campaignId}`
        : `${API_BASE}/api/camera/profiles`;
      const res = await fetch(url);
      const data = (await res.json()) as CameraProfilesResponse;

      if (data.profiles.length > 0) {
        setPeople(data.profiles.map((p) => p.appearance));
        setIsReturning(true);
        setPhase('results');
      } else {
        setPhase('prompt');
      }
    } catch {
      setPhase('prompt');
    }
  }

  // ── Camera lifecycle ──

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      setPhase('camera');
    } catch {
      setError(
        'Camera access denied. Please allow camera permissions and try again.'
      );
    }
  }, []);

  // Connect the stream to the <video> element after React renders it.
  // This runs every time phase changes to 'camera', which is when the
  // video DOM node becomes available via videoRef.
  useEffect(() => {
    if (phase === 'camera' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // ── Capture & analyze (multi-frame) ──

  /** Sends a single frame to the backend and returns the analysis response. */
  async function sendFrame(frame: string): Promise<CameraAnalyzeResponse> {
    const res = await fetch(`${API_BASE}/api/camera/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame, campaignId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as any).details || (body as any).error || `Server error (${res.status})`
      );
    }

    return (await res.json()) as CameraAnalyzeResponse;
  }

  /**
   * Captures multiple frames with a short delay between each for better
   * likeness matching. Each frame is sent to /api/camera/analyze which
   * stores it as a reference for Imagen 3 Subject Customization.
   */
  async function captureAndAnalyze() {
    const firstFrame = captureFrame();
    if (!firstFrame) {
      setError('Could not capture frame. Please try again.');
      return;
    }

    setPhase('capturing');
    setFrameProgress(1);
    setError(null);

    try {
      const data = await sendFrame(firstFrame);

      if (data.people.length === 0) {
        setError(
          'No people detected in the frame. Make sure you are visible and try again.'
        );
        setPhase('camera');
        return;
      }

      let latestData = data;

      for (let i = 2; i <= FRAME_COUNT; i++) {
        await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
        const frame = captureFrame();
        if (!frame) break;
        setFrameProgress(i);
        try {
          latestData = await sendFrame(frame);
        } catch {
          // Non-fatal: first frame already stored, continue with what we have
          break;
        }
      }

      stopCamera();
      setPeople(latestData.people);
      setSetting(latestData.setting);
      setIsReturning(false);
      setPhase('results');
    } catch (err: any) {
      setError(err.message || 'Analysis failed. Please try again.');
      setPhase('camera');
    }
  }

  function captureFrame(): string | null {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  function handleStartAdventure() {
    stopCamera();
    const finalProfiles: CameraProfile[] = people.map((p) => ({
      label: p.label,
      appearance: p,
      updated_at: Date.now(),
    }));
    onComplete(finalProfiles);
  }

  async function handleRecapture() {
    setError(null);
    setPeople([]);
    setSetting('');
    await startCamera();
  }

  // ── Phone pairing ──

  const [pairData, setPairData] = useState<PairResponse | null>(null);

  async function startPairing() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/camera/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      if (!res.ok) throw new Error('Could not generate pairing code');
      const data = (await res.json()) as PairResponse;
      setPairData(data);
      setPhase('pairing');
    } catch {
      setError('Failed to generate pairing code. Is the backend running?');
    }
  }

  function handlePairingSuccess(msg: ProfilesUpdatedMessage) {
    setPeople(msg.people);
    setSetting(msg.setting);
    setIsReturning(false);
    setPhase('results');
  }

  // ── Render helpers ──

  return (
    <div className="animate-fade-in max-w-2xl mx-auto space-y-6">
      {/* Title */}
      <div className="text-center">
        <h2 className="font-display text-gold text-2xl tracking-[0.12em] uppercase">
          {isReturning && phase === 'results'
            ? 'Welcome Back'
            : hasSubjectCustomization
              ? "Let's See Our Hero"
              : 'Character Scan'}
        </h2>
        <div className="flex items-center justify-center gap-3 mt-2">
          <div className="h-px w-12 bg-gold/20" />
          <span className="text-parchment/30 text-xs tracking-[0.2em] uppercase font-mono">
            {phase === 'loading' && 'Loading...'}
            {phase === 'prompt' && 'Personalize your story'}
            {phase === 'camera' && 'Position yourself in frame'}
            {phase === 'capturing' && `Capturing frame ${frameProgress} of ${FRAME_COUNT}...`}
            {phase === 'analyzing' && 'Gemini is analyzing...'}
            {phase === 'pairing' && 'Waiting for phone capture...'}
            {phase === 'results' && `${people.length} character${people.length !== 1 ? 's' : ''} detected`}
          </span>
          <div className="h-px w-12 bg-gold/20" />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {/* Phase: loading */}
      {phase === 'loading' && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
        </div>
      )}

      {/* Phase: prompt */}
      {phase === 'prompt' && (
        <PromptPhase
          onCapture={startCamera}
          onPhonePair={startPairing}
          onSkip={onSkip}
          hasSubjectCustomization={hasSubjectCustomization}
        />
      )}

      {/* Phase: camera */}
      {phase === 'camera' && (
        <CameraPhase
          videoRef={videoRef}
          onAnalyze={captureAndAnalyze}
          onCancel={() => { stopCamera(); setPhase('prompt'); }}
        />
      )}

      {/* Phase: capturing (multi-frame) */}
      {phase === 'capturing' && (
        <CapturingPhase
          videoRef={videoRef}
          frameProgress={frameProgress}
          frameCount={FRAME_COUNT}
        />
      )}

      {/* Phase: pairing */}
      {phase === 'pairing' && pairData && (
        <PairingPhase
          pairData={pairData}
          onSuccess={handlePairingSuccess}
          onCancel={() => setPhase('prompt')}
          onRetry={startPairing}
        />
      )}

      {/* Phase: analyzing */}
      {phase === 'analyzing' && <AnalyzingPhase />}

      {/* Phase: results */}
      {phase === 'results' && (
        <ResultsPhase
          people={people}
          setting={setting}
          isReturning={isReturning}
          onStart={handleStartAdventure}
          onRecapture={handleRecapture}
          onSkip={onSkip}
        />
      )}

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// ── Sub-components (phase renderers) ──

function PromptPhase({
  onCapture,
  onPhonePair,
  onSkip,
  hasSubjectCustomization = false,
}: {
  onCapture: () => void;
  onPhonePair: () => void;
  onSkip: () => void;
  hasSubjectCustomization?: boolean;
}) {
  return (
    <div className="text-center space-y-6 py-4 animate-fade-in">
      <p className="text-parchment/70 font-body text-lg leading-relaxed max-w-md mx-auto">
        {hasSubjectCustomization
          ?           'Scan your face so you become the hero of tonight\'s story. Your likeness will appear in every scene.'
          : 'Enable your camera so we can see our storyteller. Your appearance will be woven into the bedtime tale and artwork.'}
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <button
          onClick={onCapture}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
        >
          Enable Camera
        </button>
        <button
          onClick={onPhonePair}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
        >
          Use Phone Camera
        </button>
        <button
          onClick={onSkip}
          className="border border-parchment/10 rounded-xl px-6 py-3 font-display text-parchment/40 text-sm tracking-wider transition-all hover:text-parchment/60 hover:border-parchment/20"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function CameraPhase({
  videoRef,
  onAnalyze,
  onCancel,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  onAnalyze: () => void;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="relative rounded-xl overflow-hidden border border-gold/20 shadow-[0_0_30px_rgba(201,169,110,0.08)]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full aspect-video object-cover"
        />
        <div className="absolute inset-0 border-2 border-gold/10 rounded-xl pointer-events-none" />
      </div>
      <div className="flex justify-center gap-4">
        <button
          onClick={onAnalyze}
          disabled={!ready}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {ready ? 'Analyze' : 'Warming up...'}
        </button>
        <button
          onClick={onCancel}
          className="border border-parchment/10 rounded-xl px-6 py-3 font-display text-parchment/40 text-sm tracking-wider transition-all hover:text-parchment/60 hover:border-parchment/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Shows the live camera feed with a progress indicator while capturing multiple frames. */
function CapturingPhase({
  videoRef,
  frameProgress,
  frameCount,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  frameProgress: number;
  frameCount: number;
}) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="relative rounded-xl overflow-hidden border border-gold/20 shadow-[0_0_30px_rgba(201,169,110,0.08)]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full aspect-video object-cover"
        />
        <div className="absolute inset-0 border-2 border-gold/30 rounded-xl pointer-events-none animate-pulse" />
        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5 flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-gold/40 border-t-gold rounded-full animate-spin" />
            <span className="text-gold text-xs font-mono tracking-wider">
              Frame {frameProgress} / {frameCount}
            </span>
          </div>
        </div>
      </div>
      <p className="text-center text-parchment/40 text-xs font-body">
        Hold still — capturing from slightly different moments for better likeness...
      </p>
    </div>
  );
}

function AnalyzingPhase() {
  return (
    <div className="text-center py-10 space-y-4 animate-fade-in">
      <div className="flex justify-center">
        <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
      <p className="text-parchment/50 font-body text-base">
        Studying your appearance for the story...
      </p>
    </div>
  );
}

/**
 * Displays a QR code + pairing code for phone camera capture.
 * Opens a WebSocket to listen for the `profiles_updated` event from the backend.
 */
function PairingPhase({
  pairData,
  onSuccess,
  onCancel,
  onRetry,
}: {
  pairData: PairResponse;
  onSuccess: (msg: ProfilesUpdatedMessage) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(pairData.phoneUrl, { width: 256, margin: 2 }).then(
      (url) => { if (!cancelled) setQrDataUrl(url); }
    );
    return () => { cancelled = true; };
  }, [pairData.phoneUrl]);

  // Expiry timer
  useEffect(() => {
    const remaining = pairData.expiresAt - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [pairData.expiresAt]);

  // WebSocket listener for profiles_updated
  useEffect(() => {
    const wsProtocol = API_BASE.startsWith('https') ? 'wss' : 'ws';
    const wsHost = API_BASE.replace(/^https?:\/\//, '');
    const ws = new WebSocket(`${wsProtocol}://${wsHost}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'profiles_updated') {
          onSuccess(msg as ProfilesUpdatedMessage);
        }
      } catch { /* ignore non-JSON messages */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [pairData.code, onSuccess]);

  const formattedCode = pairData.code.split('').join(' ');

  if (expired) {
    return (
      <div className="text-center space-y-5 py-6 animate-fade-in">
        <p className="text-parchment/50 font-body text-base">
          Pairing code has expired.
        </p>
        <div className="flex justify-center gap-4">
          <button
            onClick={onRetry}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
          >
            Generate New Code
          </button>
          <button
            onClick={onCancel}
            className="border border-parchment/10 rounded-xl px-6 py-3 font-display text-parchment/40 text-sm tracking-wider transition-all hover:text-parchment/60 hover:border-parchment/20"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center space-y-6 py-4 animate-fade-in">
      {/* QR code */}
      <div className="flex justify-center">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Scan to open phone camera"
            className="w-56 h-56 rounded-xl border border-gold/20 shadow-[0_0_30px_rgba(201,169,110,0.08)]"
          />
        ) : (
          <div className="w-56 h-56 rounded-xl border border-gold/20 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Pairing code */}
      <div>
        <p className="text-parchment/40 text-xs font-mono tracking-wider uppercase mb-2">
          Or enter this code on your phone
        </p>
        <p className="font-mono text-gold text-3xl tracking-[0.4em] font-bold select-all">
          {formattedCode}
        </p>
      </div>

      <p className="text-parchment/40 text-sm font-body">
        Open the link on your phone, point the camera at the players, and capture.
      </p>

      {/* Waiting indicator */}
      <div className="flex items-center justify-center gap-3">
        <div className="w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
        <span className="text-parchment/40 text-xs font-mono tracking-wider">
          Waiting for phone capture...
        </span>
      </div>

      <button
        onClick={onCancel}
        className="border border-parchment/10 rounded-xl px-6 py-3 font-display text-parchment/40 text-sm tracking-wider transition-all hover:text-parchment/60 hover:border-parchment/20"
      >
        Cancel
      </button>
    </div>
  );
}

function ResultsPhase({
  people,
  setting,
  isReturning,
  onStart,
  onRecapture,
  onSkip,
}: {
  people: CharacterAppearance[];
  setting: string;
  isReturning: boolean;
  onStart: () => void;
  onRecapture: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-5 animate-fade-in">
      {isReturning && (
        <p className="text-center text-parchment/50 font-body text-base">
          We still remember you from last time.
        </p>
      )}

      {/* Character cards */}
      <div className="grid gap-3">
        {people.map((person, i) => (
          <CharacterCard key={`${person.label}-${i}`} person={person} />
        ))}
      </div>

      {/* Setting */}
      {setting && (
        <p className="text-center text-parchment/30 text-xs font-mono tracking-wide">
          Setting: {setting}
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-center gap-4 pt-2">
        <button
          onClick={onStart}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
        >
          {isReturning ? 'Continue Story' : 'Continue'}
        </button>
        <button
          onClick={onRecapture}
          className="border border-parchment/10 rounded-xl px-6 py-3 font-display text-parchment/40 text-sm tracking-wider transition-all hover:text-parchment/60 hover:border-parchment/20"
        >
          Re-capture
        </button>
        {isReturning && (
          <button
            onClick={onSkip}
            className="border border-parchment/10 rounded-xl px-5 py-3 font-display text-parchment/30 text-xs tracking-wider transition-all hover:text-parchment/50 hover:border-parchment/15"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

/** Displays a single detected character's appearance details. */
function CharacterCard({ person }: { person: CharacterAppearance }) {
  const displayName = person.fantasy_name || person.label;

  return (
    <div className="bg-[#12121f] border border-gold/15 rounded-xl px-5 py-4 animate-slide-up">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-display text-gold text-sm tracking-wider uppercase">
          {displayName}
        </span>
        {person.age_range && (
          <span className="text-parchment/30 text-xs font-mono">
            Age {person.age_range}
          </span>
        )}
        {person.fantasy_name && person.fantasy_name !== person.label && (
          <span className="text-parchment/20 text-[10px] font-mono">
            ({person.label})
          </span>
        )}
      </div>
      {person.character_description && (
        <p className="text-parchment/60 font-body text-sm italic mb-2">
          {person.character_description}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
        <Detail label="Hair" value={person.hair} />
        <Detail label="Clothing" value={person.clothing} />
        <Detail label="Features" value={person.features} />
        <Detail label="Skin tone" value={person.skin_tone || ''} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-parchment/30 text-xs">{label}</span>
      <p className="text-parchment/70 font-body">{value}</p>
    </div>
  );
}
