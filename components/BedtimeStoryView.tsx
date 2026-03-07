'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  HealthResponse,
  StoryStatusResponse,
  StoryBeatResponse,
  AudioChunkMessage,
  MusicSessionEndedMessage,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';
const WS_URL = API_BASE.replace(/^http/, 'ws');

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default function BedtimeStoryView() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [active, setActive] = useState(false);
  const [narration, setNarration] = useState('');
  const [beatInput, setBeatInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isBeating, setIsBeating] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const subscribedRef = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setError('Cannot reach the backend.'));
  }, []);

  const setupStoryAudio = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
    subscribedRef.current = true;
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setupStoryAudio();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as AudioChunkMessage | MusicSessionEndedMessage;
        if (msg.type === 'audio_chunk' && 'payload' in msg && msg.payload) {
          const int16 = new Int16Array(decodeBase64ToArrayBuffer(msg.payload));
          const sampleRate = msg.sampleRate || 48000;
          const channels = msg.channels || 2;
          const numFrames = int16.length / channels;

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

          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          const startTime = nextStartTimeRef.current;
          nextStartTimeRef.current = startTime + buffer.duration;
          source.start(startTime);
        } else if (msg.type === 'music_session_ended') {
          setActive(false);
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
  }, [setupStoryAudio]);

  const handleStart = async () => {
    setError(null);
    setIsStarting(true);
    try {
      if (!subscribedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
        subscribedRef.current = true;
        await new Promise((r) => setTimeout(r, 500));
      }
      const res = await fetch(`${API_BASE}/api/story/start`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as any).error || (data as any).details || `Failed to start (${res.status})`);
        return;
      }
      setActive(true);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await fetch(`${API_BASE}/api/story/stop`, { method: 'POST' });
      setActive(false);
    } catch {
      setError('Failed to stop session');
    }
  };

  const handleBeat = async () => {
    const action = beatInput.trim() || 'The story continues gently.';
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
        setError(data.error || 'Beat failed');
        return;
      }
      setNarration(data.narration || narration);
      setBeatInput('');

      if (active && (data.theme || data.mood || data.emotion != null)) {
        await fetch(`${API_BASE}/api/music/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: data.theme,
            mood: data.mood,
            emotion: data.emotion,
            intensity: data.intensity,
          }),
        });
      }
    } catch {
      setError('Beat request failed');
    } finally {
      setIsBeating(false);
    }
  };

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/story/status`);
      const data = (await res.json()) as StoryStatusResponse;
      setActive(data.active);
    } catch {
      setActive(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <p className="text-parchment/40 text-sm text-center">
        Lyria RealTime streams continuous adaptive music. Start a session, then add story beats.
      </p>

      {health && !health.has_lyria && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-600/30 px-4 py-2 text-center text-amber-200/90 text-sm">
          Music unavailable. Configure Lyria (GOOGLE_CLOUD_PROJECT / billing) to use bedtime story.
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        {!active ? (
          <button
            onClick={handleStart}
            disabled={!health?.has_lyria || isStarting}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider disabled:opacity-50"
          >
            {isStarting ? 'Starting…' : 'Start story session'}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="bg-red-900/20 hover:bg-red-900/30 border border-red-600/40 rounded-xl px-6 py-3 font-display text-red-200 text-sm tracking-wider"
          >
            Stop session
          </button>
        )}
      </div>

      {active && (
        <>
          <div className="space-y-2">
            <label className="block text-gold/60 text-xs font-mono uppercase tracking-wider">
              Story beat (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={beatInput}
                onChange={(e) => setBeatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBeat()}
                placeholder="e.g. The dragon falls asleep..."
                disabled={isBeating}
                className="flex-1 bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50"
              />
              <button
                onClick={handleBeat}
                disabled={isBeating}
                className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-5 py-3 font-display text-gold text-sm tracking-wider disabled:opacity-50"
              >
                {isBeating ? '…' : 'Beat'}
              </button>
            </div>
          </div>

          {narration && (
            <div className="bg-[#12121f]/80 backdrop-blur-sm border border-gold/10 rounded-xl p-5">
              <p className="text-parchment font-body italic leading-relaxed">&ldquo;{narration}&rdquo;</p>
            </div>
          )}
        </>
      )}

      <p className="text-center text-parchment/30 text-xs">
        <a
          href={`${API_BASE}/test-story-audio.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold/50 hover:text-gold"
        >
          Test story audio
        </a>
      </p>
    </div>
  );
}
