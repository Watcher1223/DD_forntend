'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SceneArtwork from '@/components/SceneArtwork';
import NarrationBox from '@/components/NarrationBox';
import DiceDisplay from '@/components/DiceDisplay';
import MusicMood from '@/components/MusicMood';
import ActionBar from '@/components/ActionBar';
import EventLog from '@/components/EventLog';
import type {
  HealthResponse,
  ActionResponse,
  CampaignResponse,
  DiceResponse,
  StoryUpdateMessage,
  CampaignEvent,
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
  });

  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket connection (real-time story_update broadcasts) ──
  useEffect(() => {
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
          const data = JSON.parse(evt.data) as StoryUpdateMessage;
          if (data.type === 'story_update') {
            applyStoryUpdate(data);
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
  }, []);

  // ── Health check on load ──
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setGame((prev) => ({ ...prev, health: data, error: null }));
      })
      .catch(() => {
        setGame((prev) => ({
          ...prev,
          health: {
            status: 'error',
            service: 'living-worlds',
            campaign_events: 0,
            has_gemini: false,
            has_nanobanana: false,
            has_lyria: false,
          },
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
          finalDiceRoll = Math.floor(Math.random() * 20) + 1;
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
      }));
    } catch {
      // ignore
    }
  };

  return (
    <main className="min-h-screen relative">
      {/* Background atmosphere */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#0a0a14] via-[#12121f] to-[#0a0a14] -z-10" />

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <header className="text-center mb-2">
          <h1 className="font-display text-gold text-3xl tracking-[0.15em] uppercase">
            Living Worlds
          </h1>
          <p className="text-parchment/30 text-xs tracking-[0.3em] uppercase mt-1">
            Real-Time AI Dungeon Master
          </p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <div className="h-px w-16 bg-gold/20" />
            <span className="text-gold/30 text-xs font-mono">Event {game.eventNumber}</span>
            <div className="h-px w-16 bg-gold/20" />
          </div>
        </header>

        {/* Health / demo mode / errors */}
        {game.health && !game.health.has_gemini && (
          <div className="rounded-lg bg-amber-900/20 border border-amber-600/30 px-4 py-2 text-center text-amber-200/90 text-sm">
            Demo mode — connect API for full AI narration.
          </div>
        )}
        {game.error && (
          <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
            {game.error}
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column — Scene artwork */}
          <div className="lg:col-span-2">
            <SceneArtwork
              imageUrl={game.sceneImage}
              imageSource={game.imageSource}
              isLoading={game.isProcessing}
              eventNumber={game.eventNumber}
            />
          </div>

          {/* Right column — Dice + Music */}
          <div className="flex flex-col gap-4">
            <DiceDisplay value={game.diceValue} isRolling={game.isRolling} />
            <MusicMood
              mood={game.musicMood}
              audioUrl={game.musicUrl}
              hasLyria={game.health?.has_lyria ?? true}
              musicPlayRequest={game.musicPlayRequest}
            />
          </div>
        </div>

        {/* Narration */}
        <NarrationBox
          text={game.narration}
          location={game.location}
          narrationAudioUrl={game.narrationAudioUrl}
          isLoading={game.isProcessing}
        />

        {/* Action bar */}
        <ActionBar onAction={handleAction} isProcessing={game.isProcessing} />

        {/* Event log */}
        <EventLog events={game.events} />

        {/* Footer controls */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-parchment/20 text-[10px] font-mono">
            Powered by Gemini 3.1 + NanoBanana 2 + Lyria
            {' · '}
            <a
              href={`${API_BASE}/test-audio.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold/40 hover:text-gold transition-colors"
            >
              Test audio
            </a>
          </span>
          <button
            onClick={handleReset}
            className="text-parchment/20 hover:text-red-400/60 text-[10px] font-mono transition-colors"
          >
            Reset Campaign
          </button>
        </div>
      </div>
    </main>
  );
}
