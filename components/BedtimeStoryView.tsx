'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  HealthResponse,
  StoryStatusResponse,
  StoryBeatResponse,
  AudioChunkMessage,
  MusicSessionEndedMessage,
  CharacterInjectionMessage,
  StageVisionTickMessage,
  StoryExportResponse,
  ActionImage,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';
const WS_URL = API_BASE.replace(/^http/, 'ws');

// ── Helpers ──

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function captureVideoFrame(video: HTMLVideoElement): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// ── Types ──

type Phase = 'setup' | 'playing' | 'export';

interface StoryScene {
  narration: string;
  narrationAudioUrl?: string;
  imageUrl?: string;
  location?: string;
  theme?: string;
  mood?: string;
  isCharacterInjection?: boolean;
}

// ── Component ──

export default function BedtimeStoryView() {
  // Health
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Phase
  const [phase, setPhase] = useState<Phase>('setup');

  // Setup state
  const [themeInput, setThemeInput] = useState('');
  const [userTheme, setUserTheme] = useState('');
  const [language, setLanguage] = useState('en');
  const [protagonist, setProtagonist] = useState('');
  const [faceStored, setFaceStored] = useState(false);

  // Story state
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(-1);
  const [beatInput, setBeatInput] = useState('');
  const [isBeating, setIsBeating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [peopleCount, setPeopleCount] = useState(0);
  const [detectedEmotion, setDetectedEmotion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);

  // Camera
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const subscribedRef = useRef(false);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);

  // Intervals
  const emotionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const visionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoAdvanceRef = useRef<NodeJS.Timeout | null>(null);

  // ── Health check ──
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setError('Cannot reach the backend. Is it running on port 4300?'));
  }, []);

  // ── WebSocket for Lyria audio + events ──
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
      subscribedRef.current = true;
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());

        if (msg.type === 'audio_chunk' && msg.payload) {
          playPCMChunk(msg as AudioChunkMessage);
        } else if (msg.type === 'music_session_ended') {
          setSessionActive(false);
        } else if (msg.type === 'character_injection') {
          handleCharacterInjection(msg as CharacterInjectionMessage);
        } else if (msg.type === 'stage_vision_tick') {
          const tick = msg as StageVisionTickMessage;
          setPeopleCount(tick.people_count);
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      subscribedRef.current = false;
    };

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // ── PCM playback ──
  const playPCMChunk = useCallback((msg: AudioChunkMessage) => {
    const int16 = new Int16Array(decodeBase64ToArrayBuffer(msg.payload));
    const sampleRate = msg.sampleRate || 48000;
    const channels = msg.channels || 2;
    const numFrames = int16.length / channels;
    if (numFrames < 100) return;

    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      nextStartTimeRef.current = ctx.currentTime;
    }
    if (ctx.state === 'suspended') ctx.resume();

    const buffer = ctx.createBuffer(channels, numFrames, sampleRate);
    const ch0 = buffer.getChannelData(0);
    const ch1 = channels > 1 ? buffer.getChannelData(1) : ch0;
    for (let i = 0; i < numFrames; i++) {
      ch0[i] = int16[i * channels] / 32768;
      if (channels > 1) ch1[i] = int16[i * channels + 1] / 32768;
    }

    const gain = ctx.createGain();
    gain.gain.value = 0.4; // Background music volume
    gain.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    source.start(startTime);
  }, []);

  // ── Character injection from WebSocket ──
  const handleCharacterInjection = useCallback((msg: CharacterInjectionMessage) => {
    const scene: StoryScene = {
      narration: msg.narration || 'A new character appears in the story...',
      imageUrl: msg.imageUrl,
      isCharacterInjection: true,
    };
    setScenes((prev) => [...prev, scene]);
    setCurrentSceneIdx((prev) => prev + 1);
  }, []);

  // ── Camera management ──
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      setError('Camera access denied. Allow camera to use face/doll detection.');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    if (emotionIntervalRef.current) clearInterval(emotionIntervalRef.current);
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
  };

  // ── Capture face ──
  const captureFace = async () => {
    if (!videoRef.current) return;
    const frame = captureVideoFrame(videoRef.current);
    if (!frame) return;
    try {
      const res = await fetch(`${API_BASE}/api/camera/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
      });
      if (res.ok) {
        setFaceStored(true);
      }
    } catch {
      // silent
    }
  };

  // ── Detect doll/toy ──
  const detectDoll = async () => {
    if (!videoRef.current) return;
    const frame = captureVideoFrame(videoRef.current);
    if (!frame) return;
    try {
      const res = await fetch(`${API_BASE}/api/story/detect-object`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
      });
      const data = await res.json();
      if (data.protagonist_description) {
        setProtagonist(data.protagonist_description);
        await fetch(`${API_BASE}/api/story/set-protagonist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ protagonist_description: data.protagonist_description }),
        });
      }
    } catch {
      // silent
    }
  };

  // ── Start story session ──
  const handleStart = async () => {
    setError(null);
    setIsStarting(true);
    try {
      // Ensure WebSocket is subscribed
      if (!subscribedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
        subscribedRef.current = true;
        await new Promise((r) => setTimeout(r, 500));
      }

      // Resume audio context (needs user gesture)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // Start session with theme
      const body: Record<string, string> = {};
      if (themeInput.trim()) body.themeDescription = themeInput.trim();
      if (language !== 'en') body.language = language;

      const res = await fetch(`${API_BASE}/api/story/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.details || `Failed to start (${res.status})`);
        return;
      }

      setSessionActive(true);
      setUserTheme(data.userTheme || themeInput.trim() || 'bedtime');
      setPhase('playing');

      // Start emotion + vision polling if camera is on
      if (cameraActive) {
        startEmotionPolling();
        startVisionPolling();
      }
    } finally {
      setIsStarting(false);
    }
  };

  // ── Stop session ──
  const handleStop = async () => {
    try {
      await fetch(`${API_BASE}/api/story/stop`, { method: 'POST' });
    } catch {
      // silent
    }
    setSessionActive(false);
    if (emotionIntervalRef.current) clearInterval(emotionIntervalRef.current);
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
  };

  // ── Story beat ──
  const handleBeat = async (actionOverride?: string) => {
    const action = actionOverride || beatInput.trim() || 'The story continues...';
    setError(null);
    setIsBeating(true);
    try {
      const res = await fetch(`${API_BASE}/api/story/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as StoryBeatResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || 'Story beat failed');
        return;
      }

      const scene: StoryScene = {
        narration: data.narration || '',
        narrationAudioUrl: data.narrationAudioUrl,
        imageUrl: data.image?.imageUrl,
        location: data.location,
        theme: data.theme,
        mood: data.mood,
      };

      setScenes((prev) => [...prev, scene]);
      setCurrentSceneIdx((prev) => prev + 1);
      setBeatInput('');

      // Play narration audio
      if (data.narrationAudioUrl) {
        playNarration(data.narrationAudioUrl);
      }

      // Update music with new mood
      if (sessionActive && (data.theme || data.mood || data.emotion)) {
        fetch(`${API_BASE}/api/music/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: data.theme,
            mood: data.mood,
            emotion: data.emotion,
            intensity: data.intensity,
          }),
        }).catch(() => {});
      }

      // Auto-advance: queue next beat after narration
      if (autoAdvance) {
        autoAdvanceRef.current = setTimeout(() => {
          handleBeat('The story continues naturally...');
        }, 12000);
      }
    } catch {
      setError('Story beat request failed');
    } finally {
      setIsBeating(false);
    }
  };

  // ── Narration playback ──
  const playNarration = (url: string) => {
    if (narrationAudioRef.current) {
      narrationAudioRef.current.pause();
    }
    const audio = new Audio(url);
    audio.volume = 1.0;
    narrationAudioRef.current = audio;
    audio.play().catch(() => {});
  };

  // ── Emotion polling (camera → music) ──
  const startEmotionPolling = () => {
    if (emotionIntervalRef.current) clearInterval(emotionIntervalRef.current);
    emotionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !cameraActive) return;
      const frame = captureVideoFrame(videoRef.current);
      if (!frame) return;
      try {
        const res = await fetch(`${API_BASE}/api/story/emotion-from-camera`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame, updateMusic: true }),
        });
        if (res.ok) {
          const data = await res.json();
          setDetectedEmotion(data.emotion || '');
        }
      } catch {
        // silent
      }
    }, 4000);
  };

  // ── Vision polling (detect new people) ──
  const startVisionPolling = () => {
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    visionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !cameraActive) return;
      const frame = captureVideoFrame(videoRef.current);
      if (!frame) return;
      try {
        await fetch(`${API_BASE}/api/story/stage-vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame, generateImage: true }),
        });
      } catch {
        // silent
      }
    }, 6000);
  };

  // ── Export storybook ──
  const handleExport = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/story/export`);
      const data = (await res.json()) as StoryExportResponse;
      setPhase('export');
      // Scenes already in state; export data enriches them
      if (data.pages?.length) {
        const exportScenes: StoryScene[] = data.pages.map((p) => ({
          narration: p.narration,
          imageUrl: p.imageUrl,
        }));
        setScenes(exportScenes);
        setCurrentSceneIdx(0);
      }
    } catch {
      setError('Export failed');
    }
  };

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      stopCamera();
      if (emotionIntervalRef.current) clearInterval(emotionIntervalRef.current);
      if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  // Current scene
  const currentScene = currentSceneIdx >= 0 ? scenes[currentSceneIdx] : null;

  // ── RENDER ──

  // Setup phase
  if (phase === 'setup') {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        {error && (
          <div className="rounded-xl bg-red-900/20 border border-red-500/30 px-4 py-3 text-red-200 text-sm text-center">
            {error}
          </div>
        )}

        {/* Theme input */}
        <div className="bg-midnight-light/50 border border-gold/10 rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-gold text-lg tracking-wider text-center">
            What&rsquo;s tonight&rsquo;s story about?
          </h2>
          <p className="text-parchment-dim/50 text-xs text-center">
            Say a theme or type it — e.g. &ldquo;forest adventure&rdquo;, &ldquo;under the sea&rdquo;, &ldquo;space mission&rdquo;
          </p>
          <input
            type="text"
            value={themeInput}
            onChange={(e) => setThemeInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && themeInput.trim() && handleStart()}
            placeholder="forest adventure, under the sea, space..."
            className="w-full bg-midnight border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment-dim/30 font-body focus:outline-none focus:border-gold/50 transition-all"
          />

          {/* Language select */}
          <div className="flex items-center gap-3">
            <label className="text-gold/50 text-xs font-mono shrink-0">Language:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-midnight border border-gold/20 rounded-lg px-3 py-1.5 text-parchment text-sm font-body focus:outline-none focus:border-gold/50"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="sw">Swahili</option>
              <option value="ru">Russian</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
            </select>
          </div>
        </div>

        {/* Camera setup */}
        <div className="bg-midnight-light/50 border border-gold/10 rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-gold/80 text-base tracking-wider text-center">
            Camera (optional)
          </h2>
          <p className="text-parchment-dim/40 text-xs text-center">
            Enable camera so your face appears in the story, detect your doll as the hero, and adapt music to your mood
          </p>

          {!cameraActive ? (
            <button
              onClick={startCamera}
              className="mx-auto block bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-5 py-2.5 font-display text-gold text-sm tracking-wider transition-all"
            >
              Enable Camera
            </button>
          ) : (
            <div className="space-y-3">
              <div className="relative w-48 h-36 mx-auto rounded-xl overflow-hidden border border-gold/20">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={captureFace}
                  disabled={faceStored}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    faceStored
                      ? 'border-emerald-500/40 text-emerald-400/80 bg-emerald-900/20'
                      : 'border-gold/30 text-gold/70 hover:bg-gold/10'
                  }`}
                >
                  {faceStored ? 'Face stored' : 'Capture my face'}
                </button>

                <button
                  onClick={detectDoll}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                    protagonist
                      ? 'border-emerald-500/40 text-emerald-400/80 bg-emerald-900/20'
                      : 'border-gold/30 text-gold/70 hover:bg-gold/10'
                  }`}
                >
                  {protagonist ? `Hero: ${protagonist.slice(0, 30)}...` : 'Detect my doll'}
                </button>

                <button
                  onClick={stopCamera}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400/70 hover:bg-red-900/20 transition-all"
                >
                  Stop camera
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Start button */}
        <div className="text-center">
          <button
            onClick={handleStart}
            disabled={isStarting || !health}
            className="bg-gold/15 hover:bg-gold/25 border border-gold/40 rounded-2xl px-10 py-4 font-display text-gold text-lg tracking-[0.15em] transition-all disabled:opacity-40 hover:shadow-[0_0_30px_rgba(212,168,83,0.15)]"
          >
            {isStarting ? 'Starting...' : 'Begin the Story'}
          </button>
          {!themeInput.trim() && (
            <p className="text-parchment-dim/30 text-[10px] mt-2">
              A magical bedtime story will begin with a default theme
            </p>
          )}
        </div>
      </div>
    );
  }

  // Export phase
  if (phase === 'export') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <h2 className="font-display text-gold text-2xl text-center tracking-wider">
          Your Storybook
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenes.map((s, i) => (
            <div
              key={i}
              className="bg-midnight-light/50 border border-gold/10 rounded-2xl overflow-hidden"
            >
              {s.imageUrl && (
                <img
                  src={s.imageUrl}
                  alt={`Scene ${i + 1}`}
                  className="w-full aspect-video object-cover"
                />
              )}
              <div className="p-4">
                <p className="text-parchment font-story italic text-sm leading-relaxed">
                  &ldquo;{s.narration}&rdquo;
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center">
          <button
            onClick={() => setPhase('playing')}
            className="text-gold/50 hover:text-gold text-sm transition-colors"
          >
            Back to story
          </button>
        </div>
      </div>
    );
  }

  // ── Playing phase ──
  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-fade-in">
      {error && (
        <div className="rounded-xl bg-red-900/20 border border-red-500/30 px-4 py-2 text-red-200 text-sm text-center">
          {error}
        </div>
      )}

      {/* Scene display — the "video" */}
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-gold/15 shadow-2xl bg-midnight">
        {currentScene?.imageUrl ? (
          <img
            key={currentSceneIdx}
            src={currentScene.imageUrl}
            alt="Story scene"
            className="w-full h-full object-cover animate-fade-in"
          />
        ) : isBeating ? (
          <div className="absolute inset-0 shimmer flex items-center justify-center">
            <div className="text-center">
              <div className="text-gold text-5xl animate-pulse-slow">&#9733;</div>
              <p className="text-gold/60 text-sm mt-3 font-story">Creating the next scene...</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-midnight-light to-midnight flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">&#127769;</div>
              <p className="font-display text-gold text-xl tracking-widest">
                {userTheme || 'Bedtime Story'}
              </p>
              <p className="text-gold/30 text-sm mt-2 font-story italic">
                Music is playing... add a story beat to begin
              </p>
            </div>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-midnight via-transparent to-transparent pointer-events-none" />

        {/* Scene counter */}
        {scenes.length > 0 && (
          <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full border border-gold/20">
            <span className="text-gold/70 text-xs font-mono">
              Scene {currentSceneIdx + 1} / {scenes.length}
            </span>
          </div>
        )}

        {/* Character injection badge */}
        {currentScene?.isCharacterInjection && (
          <div className="absolute top-3 left-3 bg-lavender/20 backdrop-blur-sm px-3 py-1 rounded-full border border-lavender/30">
            <span className="text-lavender text-xs font-display tracking-wider">
              New Character!
            </span>
          </div>
        )}

        {/* Emotion indicator */}
        {detectedEmotion && (
          <div className="absolute bottom-3 left-3 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full border border-gold/20">
            <span className="text-gold/60 text-xs font-mono">
              Mood: {detectedEmotion}
            </span>
          </div>
        )}

        {/* People counter */}
        {peopleCount > 0 && (
          <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full border border-gold/20">
            <span className="text-gold/60 text-xs font-mono">
              {peopleCount} {peopleCount === 1 ? 'person' : 'people'} on stage
            </span>
          </div>
        )}
      </div>

      {/* Scene navigation (for scrolling through generated scenes) */}
      {scenes.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentSceneIdx(Math.max(0, currentSceneIdx - 1))}
            disabled={currentSceneIdx <= 0}
            className="text-gold/40 hover:text-gold disabled:opacity-20 transition-colors text-xl"
          >
            &#9664;
          </button>
          <div className="flex gap-1.5">
            {scenes.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSceneIdx(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentSceneIdx ? 'bg-gold scale-125' : 'bg-gold/20 hover:bg-gold/40'
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => setCurrentSceneIdx(Math.min(scenes.length - 1, currentSceneIdx + 1))}
            disabled={currentSceneIdx >= scenes.length - 1}
            className="text-gold/40 hover:text-gold disabled:opacity-20 transition-colors text-xl"
          >
            &#9654;
          </button>
        </div>
      )}

      {/* Narration text */}
      {currentScene?.narration && (
        <div className="bg-midnight-light/40 border border-gold/10 rounded-2xl p-5">
          {currentScene.location && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-gold/30 text-xs">&#9670;</span>
              <span className="font-display text-gold/50 text-[10px] tracking-[0.2em] uppercase">
                {currentScene.location}
              </span>
              <div className="flex-1 h-px bg-gold/10" />
            </div>
          )}
          <p className="text-parchment font-story italic text-lg leading-relaxed">
            &ldquo;{currentScene.narration}&rdquo;
          </p>
          {currentScene.narrationAudioUrl && (
            <button
              onClick={() => playNarration(currentScene.narrationAudioUrl!)}
              className="mt-2 text-gold/40 hover:text-gold text-xs font-mono transition-colors"
            >
              &#9654; Replay narration
            </button>
          )}
        </div>
      )}

      {/* Story input + controls */}
      <div className="flex gap-2">
        <input
          type="text"
          value={beatInput}
          onChange={(e) => setBeatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isBeating && handleBeat()}
          placeholder='What happens next? e.g. "The hero finds a glowing cave" or "Continue in Swahili"'
          disabled={isBeating}
          className="flex-1 bg-midnight border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment-dim/25 font-body text-sm focus:outline-none focus:border-gold/50 transition-all disabled:opacity-50"
        />
        <button
          onClick={() => handleBeat()}
          disabled={isBeating}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-5 py-3 font-display text-gold text-sm tracking-wider transition-all disabled:opacity-40"
        >
          {isBeating ? (
            <span className="animate-pulse">...</span>
          ) : (
            'Next'
          )}
        </button>
      </div>

      {/* Bottom controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Auto-advance toggle */}
        <label className="flex items-center gap-2 text-xs text-parchment-dim/40 cursor-pointer">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => {
              setAutoAdvance(e.target.checked);
              if (!e.target.checked && autoAdvanceRef.current) {
                clearTimeout(autoAdvanceRef.current);
              }
            }}
            className="accent-gold"
          />
          Auto-advance story
        </label>

        {/* Camera toggle */}
        {!cameraActive ? (
          <button
            onClick={async () => {
              await startCamera();
              if (sessionActive) {
                startEmotionPolling();
                startVisionPolling();
              }
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gold/20 text-gold/50 hover:text-gold/80 hover:bg-gold/5 transition-all"
          >
            Enable camera
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400/60">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Camera on
            {detectedEmotion && <span className="text-gold/40">({detectedEmotion})</span>}
          </span>
        )}

        <div className="flex-1" />

        {/* Session controls */}
        {sessionActive && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Music streaming
          </span>
        )}

        <button
          onClick={handleExport}
          disabled={scenes.length === 0}
          className="text-xs px-3 py-1.5 rounded-lg border border-gold/20 text-gold/50 hover:text-gold/80 hover:bg-gold/5 transition-all disabled:opacity-30"
        >
          Export storybook
        </button>

        <button
          onClick={handleStop}
          className="text-xs px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400/50 hover:text-red-400/80 hover:bg-red-900/10 transition-all"
        >
          End story
        </button>
      </div>

      {/* Mini camera preview when active during story */}
      {cameraActive && (
        <div className="fixed bottom-4 right-4 w-32 h-24 rounded-xl overflow-hidden border border-gold/20 shadow-xl z-40">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </div>
  );
}
