'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SceneArtwork from '@/components/SceneArtwork';
import NarrationBox from '@/components/NarrationBox';
import DiceDisplay from '@/components/DiceDisplay';
import MusicMood from '@/components/MusicMood';
import ActionBar from '@/components/ActionBar';
import EventLog from '@/components/EventLog';

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
  sceneImage: string | null;
  diceValue: number | null;
  musicMood: string;
  musicUrl: string | null;
  location: string;
  isProcessing: boolean;
  isRolling: boolean;
  events: GameEvent[];
  turnCount: number;
}

export default function HomePage() {
  const [game, setGame] = useState<GameState>({
    narration: '',
    sceneImage: null,
    diceValue: null,
    musicMood: 'tavern',
    musicUrl: null,
    location: '',
    isProcessing: false,
    isRolling: false,
    events: [],
    turnCount: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket connection ──
  useEffect(() => {
    const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
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
          if (data.type === 'game_update') {
            applyUpdate(data.payload);
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

  // ── Load campaign on mount ──
  useEffect(() => {
    fetch(`${API_BASE}/api/campaign`)
      .then((r) => r.json())
      .then((data) => {
        if (data.events?.length > 0) {
          const lastEvt = data.events[data.events.length - 1];
          setGame((prev) => ({
            ...prev,
            events: data.events,
            turnCount: data.turnCount || data.events.length,
            narration: lastEvt.narration || prev.narration,
            location: lastEvt.location || prev.location,
            musicMood: lastEvt.music_mood || prev.musicMood,
          }));
        }
      })
      .catch(() => {
        // Backend not running yet — that's fine
      });
  }, []);

  const applyUpdate = (payload: any) => {
    setGame((prev) => ({
      ...prev,
      narration: payload.narration ?? prev.narration,
      sceneImage: payload.image_url ?? prev.sceneImage,
      diceValue: payload.dice_roll ?? prev.diceValue,
      musicMood: payload.music_mood ?? prev.musicMood,
      musicUrl: payload.music_url ?? prev.musicUrl,
      location: payload.location ?? prev.location,
      isProcessing: false,
      isRolling: false,
      turnCount: prev.turnCount + 1,
      events: [
        ...prev.events,
        {
          action: payload.action || '???',
          diceRoll: payload.dice_roll || null,
          narration: payload.narration || '',
          music_mood: payload.music_mood || prev.musicMood,
          location: payload.location || prev.location,
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
      }));

      // If webcam frame provided, detect dice first
      let finalDiceRoll = diceRoll;
      if (webcamFrame && !diceRoll) {
        try {
          const diceRes = await fetch(`${API_BASE}/api/dice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frame: webcamFrame }),
          });
          const diceData = await diceRes.json();
          finalDiceRoll = diceData.value;
        } catch {
          finalDiceRoll = Math.floor(Math.random() * 20) + 1;
        }
      }

      // Show the dice value immediately
      if (finalDiceRoll !== null) {
        setGame((prev) => ({ ...prev, diceValue: finalDiceRoll, isRolling: false }));
      }

      // Send the action to the backend
      try {
        const res = await fetch(`${API_BASE}/api/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            diceRoll: finalDiceRoll,
            webcamFrame: webcamFrame,
          }),
        });

        const data = await res.json();

        // Apply the response (WebSocket may also deliver it, but we apply directly for reliability)
        setGame((prev) => ({
          ...prev,
          narration: data.narration || prev.narration,
          sceneImage: data.image_url || prev.sceneImage,
          diceValue: data.dice_roll ?? finalDiceRoll ?? prev.diceValue,
          musicMood: data.music_mood || prev.musicMood,
          musicUrl: data.music_url || prev.musicUrl,
          location: data.location || prev.location,
          isProcessing: false,
          isRolling: false,
          turnCount: prev.turnCount + 1,
          events: [
            ...prev.events,
            {
              action,
              diceRoll: data.dice_roll ?? finalDiceRoll,
              narration: data.narration || '',
              music_mood: data.music_mood || prev.musicMood,
              location: data.location || prev.location,
              timestamp: Date.now(),
            },
          ],
        }));
      } catch (err) {
        console.error('[Living Worlds] Action failed:', err);
        setGame((prev) => ({
          ...prev,
          isProcessing: false,
          isRolling: false,
          narration: 'The magical connection wavers... The Dungeon Master is unreachable. Check that the backend server is running.',
        }));
      }
    },
    []
  );

  const handleReset = async () => {
    try {
      await fetch(`${API_BASE}/api/campaign/reset`, { method: 'POST' });
      setGame({
        narration: '',
        sceneImage: null,
        diceValue: null,
        musicMood: 'tavern',
        musicUrl: null,
        location: '',
        isProcessing: false,
        isRolling: false,
        events: [],
        turnCount: 0,
      });
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
            <span className="text-gold/30 text-xs font-mono">Turn {game.turnCount}</span>
            <div className="h-px w-16 bg-gold/20" />
          </div>
        </header>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column — Scene artwork */}
          <div className="lg:col-span-2">
            <SceneArtwork
              imageUrl={game.sceneImage}
              isLoading={game.isProcessing}
              eventNumber={game.turnCount}
            />
          </div>

          {/* Right column — Dice + Music */}
          <div className="flex flex-col gap-4">
            <DiceDisplay value={game.diceValue} isRolling={game.isRolling} />
            <MusicMood mood={game.musicMood} audioUrl={game.musicUrl} />
          </div>
        </div>

        {/* Narration */}
        <NarrationBox
          text={game.narration}
          location={game.location}
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
