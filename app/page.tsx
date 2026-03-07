'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import StoryWorld from '@/components/StoryWorld';
import NarrationPanel from '@/components/NarrationPanel';
import MusicMoodPanel from '@/components/MusicMoodPanel';
import CharacterPanel from '@/components/CharacterPanel';
import CameraRecognitionPanel from '@/components/CameraRecognitionPanel';
import DiceDisplay from '@/components/DiceDisplay';
import ActionBar from '@/components/ActionBar';
import EventLog from '@/components/EventLog';
import CharacterSetup from '@/components/CharacterSetup';
import BedtimeStoryView from '@/components/BedtimeStoryView';
import type {
  HealthResponse,
  ActionResponse,
  CampaignResponse,
  DiceResponse,
  StoryUpdateMessage,
  CampaignEvent,
  CameraProfile,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';

interface GameEvent {
  action: string;
  diceRoll: number | null;
  narration: string;
  music_mood: string;
  location: string;
  timestamp: number;
}

interface GameState {
  narration: string;
  narrationAudioUrl: string | null;
  sceneImage: string | null;
  imageSource: 'nanobanana' | 'imagen' | 'placeholder' | null;
  diceValue: number | null;
  musicMood: string;
  musicUrl: string | null;
  location: string;
  isProcessing: boolean;
  isRolling: boolean;
  events: GameEvent[];
  eventNumber: number;
  health: HealthResponse | null;
  error: string | null;
  /** Set when narration ends so MusicMood starts playing (after user gesture). */
  musicPlayRequest: number | null;
  showCharacterSetup: boolean;
}

export default function HomePage() {
  const [game, setGame] = useState<GameState>({
    narration: '',
    narrationAudioUrl: null,
    sceneImage: null,
    imageSource: null,
    diceValue: null,
    musicMood: 'tavern',
    musicUrl: null,
    location: '',
    isProcessing: false,
    isRolling: false,
    events: [],
    eventNumber: 0,
    health: null,
    error: null,
    musicPlayRequest: null,
    showCharacterSetup: true,
  });

  type AppMode = 'bedtime' | 'dungeon';
  const [mode, setMode] = useState<AppMode>('bedtime');
  const [cameraProfiles, setCameraProfiles] = useState<CameraProfile[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket connection (only for dungeon mode story_update) ──
  useEffect(() => {
    if (mode !== 'dungeon') return;
    const wsUrl = API_BASE.replace(/^http/, 'ws');
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Living Worlds] WebSocket connected');
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'story_update') {
            applyStoryUpdate(data as StoryUpdateMessage);
          } else if (data.type === 'profiles_updated') {
            console.log(
              `[Living Worlds] Profiles updated via ${data.source} — ${data.stored} stored`
            );
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        console.log('[Living Worlds] WebSocket disconnected, reconnecting...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [mode]);

  // ── Health check on load ──
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setGame((prev) => ({
          ...prev,
          health: data,
          error: null,
          showCharacterSetup: data.has_vision ? prev.showCharacterSetup : false,
        }));
      })
      .catch(() => {
        setGame((prev) => ({
          ...prev,
          error: 'Cannot reach the Dungeon Master. Is the backend running?',
        }));
      });
  }, []);

  // ── Load campaign on mount (persisted state) ──
  useEffect(() => {
    fetch(`${API_BASE}/api/campaign`)
      .then((r) => {
        if (!r.ok) throw new Error('Campaign not found');
        return r.json();
      })
      .then((data: CampaignResponse) => {
        const events: GameEvent[] = (data.recentEvents || []).map((e: CampaignEvent) => ({
          action: e.action,
          diceRoll: e.diceRoll ?? null,
          narration: e.narration,
          music_mood: e.music_mood,
          location: e.location,
          timestamp: e.timestamp ?? Date.now(),
        }));
        if (events.length > 0) {
          const last = events[events.length - 1];
          setGame((prev) => ({
            ...prev,
            events,
            eventNumber: data.eventCount ?? events.length,
            narration: last.narration || prev.narration,
            location: last.location || prev.location,
            musicMood: last.music_mood || prev.musicMood,
          }));
        }
      })
      .catch(() => {
        // Backend not running or no campaign — that's fine
      });
  }, []);

  // ── Load camera profiles when in dungeon mode ──
  useEffect(() => {
    if (mode !== 'dungeon') return;
    fetch(`${API_BASE}/api/camera/profiles`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: { profiles: CameraProfile[] }) => setCameraProfiles(data.profiles || []))
      .catch(() => setCameraProfiles([]));
  }, [mode]);

  const applyStoryUpdate = (data: ActionResponse | StoryUpdateMessage) => {
    const imageUrl = data.image?.imageUrl ?? null;
    const imageSource = data.image?.source ?? null;
    const musicUrl = data.music?.audioUrl ?? null;
    const musicMood = data.music?.mood ?? data.music_mood ?? '';
    setGame((prev) => ({
      ...prev,
      narration: data.narration ?? prev.narration,
      narrationAudioUrl: data.narrationAudioUrl ?? prev.narrationAudioUrl,
      sceneImage: imageUrl ?? prev.sceneImage,
      imageSource: imageSource ?? prev.imageSource,
      diceValue: data.diceRoll ?? prev.diceValue,
      musicMood: musicMood || prev.musicMood,
      musicUrl: musicUrl ?? prev.musicUrl,
      location: data.location ?? prev.location,
      isProcessing: false,
      isRolling: false,
      eventNumber: data.event_number ?? prev.eventNumber,
      events:
        prev.events.length > 0 && prev.events[prev.events.length - 1].narration === data.narration
          ? prev.events
          : [
              ...prev.events,
              {
                action: (data as any).action || '???',
                diceRoll: data.diceRoll ?? null,
                narration: data.narration || '',
                music_mood: musicMood || prev.musicMood,
                location: data.location || prev.location,
                timestamp: Date.now(),
              },
            ],
    }));
  };

  // ── Main action handler ──
  const handleAction = useCallback(
    async (action: string, diceRoll: number | null, webcamFrame: string | null) => {
      setGame((prev) => ({
        ...prev,
        isProcessing: true,
        isRolling: diceRoll !== null || webcamFrame !== null,
        error: null,
      }));

      let finalDiceRoll = diceRoll;
      if (webcamFrame && diceRoll == null) {
        try {
          const diceRes = await fetch(`${API_BASE}/api/dice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webcamFrame }),
          });
          const diceData = (await diceRes.json()) as DiceResponse;
          finalDiceRoll = diceData.value;
        } catch {
          // Leave null; backend will not have a dice value from this request
          finalDiceRoll = null;
        }
      }

      if (finalDiceRoll !== null) {
        setGame((prev) => ({ ...prev, diceValue: finalDiceRoll, isRolling: false }));
      }

      try {
        const res = await fetch(`${API_BASE}/api/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            diceRoll: finalDiceRoll,
            webcamFrame: webcamFrame ?? undefined,
          }),
        });

        const data = (await res.json()) as ActionResponse & { error?: string; details?: string };

        if (!res.ok) {
          const msg =
            res.status === 400
              ? data.error || 'Action is required.'
              : res.status === 404
                ? data.error || 'Campaign not found.'
                : res.status === 502
                  ? data.error || data.details || 'Music unavailable. Lyria may need configuration.'
                  : res.status === 503
                    ? data.details || data.error || 'Story, image, or music requires API configuration (Gemini, NanoBanana/Imagen, or Lyria).'
                    : data.error || data.details || 'Something went wrong.';
          setGame((prev) => ({
            ...prev,
            isProcessing: false,
            isRolling: false,
            error: msg,
          }));
          return;
        }

        const payload: ActionResponse = {
          narration: data.narration,
          narrationAudioUrl: data.narrationAudioUrl,
          diceRoll: data.diceRoll ?? finalDiceRoll ?? null,
          image: data.image,
          music: data.music,
          location: data.location,
          music_mood: data.music_mood,
          elapsed_ms: data.elapsed_ms,
          event_number: data.event_number,
        };
        applyStoryUpdate({
          ...payload,
          type: 'story_update',
          action,
        });

        // Play narration then music (in same user-gesture chain per backend docs).
        // First playback must follow a user action; we're in the callback from "Act" click.
        const narrationUrl = payload.narrationAudioUrl;
        const musicUrlToPlay = payload.music?.audioUrl;
        if (narrationUrl || musicUrlToPlay) {
          if (narrationUrl && musicUrlToPlay) {
            const narrationAudio = new Audio(narrationUrl);
            narrationAudio.onended = () => {
              setGame((prev) => ({ ...prev, musicPlayRequest: Date.now() }));
            };
            narrationAudio.play().catch((e) => console.error('[Living Worlds] Narration play failed:', e));
          } else if (narrationUrl) {
            new Audio(narrationUrl).play().catch((e) => console.error('[Living Worlds] Narration play failed:', e));
          } else if (musicUrlToPlay) {
            setGame((prev) => ({ ...prev, musicPlayRequest: Date.now() }));
          }
        }
      } catch (err) {
        console.error('[Living Worlds] Action failed:', err);
        setGame((prev) => ({
          ...prev,
          isProcessing: false,
          isRolling: false,
          error: 'The Dungeon Master is unreachable. Check that the backend is running.',
        }));
      }
    },
    []
  );

  const handleReset = async () => {
    try {
      await fetch(`${API_BASE}/api/campaign/reset`, { method: 'POST' });
      setGame((prev) => ({
        ...prev,
        narration: '',
        narrationAudioUrl: null,
        sceneImage: null,
        imageSource: null,
        diceValue: null,
        musicMood: 'tavern',
        musicUrl: null,
        location: '',
        isProcessing: false,
        isRolling: false,
        events: [],
        eventNumber: 0,
        error: null,
        musicPlayRequest: null,
        showCharacterSetup: true,
      }));
      setCameraProfiles([]);
    } catch {
      // ignore
    }
  };

  return (
    <main className="min-h-screen relative">
      {/* Storybook atmosphere */}
      <div className="fixed inset-0 bg-gradient-to-b from-midnight via-midnight-light/30 to-midnight -z-10" />

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {/* Header + mode toggle */}
        <header className="text-center mb-2">
          <h1 className="font-display text-gold text-3xl tracking-[0.12em] uppercase">
            🌙 The Magical Bedtime Adventure
          </h1>
          <p className="text-parchment-dim/60 text-xs tracking-[0.2em] uppercase mt-1 font-body">
            {mode === 'bedtime' ? 'Bedtime Story' : 'Real-Time AI Dungeon Master'}
          </p>

          {/* Toggle: Bedtime story (default) | Dungeon Master */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => setMode('bedtime')}
              className={`rounded-lg border px-4 py-2 text-xs font-display tracking-wider transition-all ${
                mode === 'bedtime'
                  ? 'bg-gold/20 border-gold/50 text-gold'
                  : 'border-gold/20 text-parchment-dim/50 hover:text-parchment-dim/70 hover:border-gold/30'
              }`}
            >
              Bedtime story
            </button>
            <button
              type="button"
              onClick={() => setMode('dungeon')}
              className={`rounded-lg border px-4 py-2 text-xs font-display tracking-wider transition-all ${
                mode === 'dungeon'
                  ? 'bg-gold/20 border-gold/50 text-gold'
                  : 'border-gold/20 text-parchment-dim/50 hover:text-parchment-dim/70 hover:border-gold/30'
              }`}
            >
              Dungeon Master
            </button>
          </div>

          {mode === 'dungeon' && (
            <div className="flex items-center justify-center gap-4 mt-2">
              <div className="h-px w-16 bg-gold/20" />
              <span className="text-gold/50 text-xs font-mono">Event {game.eventNumber}</span>
              <div className="h-px w-16 bg-gold/20" />
            </div>
          )}
        </header>

        {/* Bedtime story mode (default) */}
        {mode === 'bedtime' ? (
          <BedtimeStoryView />
        ) : (
          <>
        {/* Character setup gate — shown before the game when vision is available */}
        {game.showCharacterSetup && game.health === null && !game.error ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
          </div>
        ) : game.showCharacterSetup && game.health?.has_vision ? (
          <CharacterSetup
            hasVision
            onComplete={(profiles) => {
              setGame((prev) => ({ ...prev, showCharacterSetup: false }));
              setCameraProfiles(profiles);
            }}
            onSkip={() => setGame((prev) => ({ ...prev, showCharacterSetup: false }))}
          />
        ) : (
          <>
            {/* Health / config / errors */}
            {game.health && !game.health.has_gemini && (
              <div className="rounded-lg bg-amber-900/20 border border-amber-600/30 px-4 py-2 text-center text-amber-200/90 text-sm">
                Configure Gemini API — actions will return 503 until GEMINI_API_KEY is set.
              </div>
            )}
            {game.health && !game.health.has_lyria && (
              <div className="rounded-lg bg-amber-900/15 border border-amber-600/20 px-4 py-1.5 text-center text-amber-200/70 text-xs">
                Music unavailable until GOOGLE_CLOUD_PROJECT and billing are configured.
              </div>
            )}
            {game.error && (
              <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
                {game.error}
              </div>
            )}

            {/* 1. Story World (main) */}
            <StoryWorld
              imageUrl={game.sceneImage}
              imageSource={game.imageSource}
              isLoading={game.isProcessing}
              eventNumber={game.eventNumber}
              location={game.location}
            />

            {/* 2. Bottom bar: Narration | Music Mood | Characters | Camera */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <NarrationPanel
                lastInput={game.events[game.events.length - 1]?.action}
                narration={game.narration}
                location={game.location}
                narrationAudioUrl={game.narrationAudioUrl}
                isLoading={game.isProcessing}
              />
              <MusicMoodPanel
                mood={game.musicMood}
                audioUrl={game.musicUrl}
                hasLyria={game.health?.has_lyria ?? true}
                musicPlayRequest={game.musicPlayRequest}
              />
              <CharacterPanel profiles={cameraProfiles} />
              <CameraRecognitionPanel
                detectedLabels={cameraProfiles.map((p) => p.label)}
              />
            </div>

            {/* Action bar + dice */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="hidden sm:block shrink-0">
                <DiceDisplay value={game.diceValue} isRolling={game.isRolling} />
              </div>
              <ActionBar
                onAction={handleAction}
                isProcessing={game.isProcessing}
                actionDisabled={game.health !== null && !game.health.has_gemini}
                hasSpeech={game.health?.has_speech ?? false}
              />
            </div>

            {/* Event log (collapsible feel) */}
            <EventLog events={game.events} />
          </>
        )}
          </>
        )}

        {/* Footer controls — show for both modes */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-parchment-dim/50 text-[10px] font-mono">
            Powered by Gemini 3.1 + NanoBanana 2 + Lyria
            {' · '}
            <a
              href={`${API_BASE}/test-audio.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold/60 hover:text-gold transition-colors"
            >
              Test audio
            </a>
          </span>
          {mode === 'dungeon' && (
            <button
              onClick={handleReset}
              className="text-parchment-dim/50 hover:text-soft-pink-muted text-[10px] font-mono transition-colors"
            >
              Reset Campaign
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
