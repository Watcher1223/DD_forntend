'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import CharacterSetup from '@/components/CharacterSetup';
import StoryWorld from '@/components/StoryWorld';
import NarrationPanel from '@/components/NarrationPanel';
import MusicMoodPanel from '@/components/MusicMoodPanel';
import CharacterPanel from '@/components/CharacterPanel';
import EventLog from '@/components/EventLog';
import type {
  HealthResponse,
  StoryStatusResponse,
  StoryBeatResponse,
  AudioChunkMessage,
  MusicSessionEndedMessage,
  CharacterInjectionMessage,
  CameraProfile,
  SpeechTranscribeResponse,
  StoryExportResponse,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';
const WS_URL = API_BASE.replace(/^http/, 'ws');

interface StoryEvent {
  action: string;
  narration: string;
  music_mood: string;
  location: string;
  timestamp: number;
}

type MicState = 'idle' | 'recording' | 'transcribing';

/**
 * Full bedtime story experience: face scan -> configure -> session control ->
 * story beats with scene images, narration, character panel, music, and event log.
 */
export default function BedtimeStoryView() {
  // ── Health & gating ──
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [showFaceScan, setShowFaceScan] = useState(true);
  const [configured, setConfigured] = useState(false);

  // ── Story session ──
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isBeating, setIsBeating] = useState(false);

  // ── Story state (populated from beat responses) ──
  const [narration, setNarration] = useState('');
  const [narrationAudioUrl, setNarrationAudioUrl] = useState<string | null>(null);
  const [sceneImage, setSceneImage] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<'nanobanana' | 'imagen' | 'imagen_custom' | null>(null);
  const [location, setLocation] = useState('');
  const [musicMood, setMusicMood] = useState('calm');
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [eventNumber, setEventNumber] = useState(0);
  const [lastInput, setLastInput] = useState('');

  // ── Characters ──
  const [cameraProfiles, setCameraProfiles] = useState<CameraProfile[]>([]);

  // ── Input ──
  const [beatInput, setBeatInput] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  // ── Configure form ──
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [themeInput, setThemeInput] = useState('');
  const [language, setLanguage] = useState('en');

  // ── WebSocket / Audio ──
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const subscribedRef = useRef(false);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Health check on mount ──
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setHealth(data);
        if (!data.has_subject_customization && !data.has_vision) {
          setShowFaceScan(false);
        }
      })
      .catch(() => {
        setError('Cannot reach the backend.');
        setShowFaceScan(false);
      });
  }, []);

  // ── Check if already configured & active on mount ──
  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/story/status`);
      const data = (await res.json()) as StoryStatusResponse;
      setActive(data.active);
      if (data.active) setConfigured(true);
    } catch {
      setActive(false);
    }
  }, []);

  // ── Load camera profiles on mount ──
  useEffect(() => {
    fetch(`${API_BASE}/api/camera/profiles`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { profiles: CameraProfile[] }) => setCameraProfiles(data.profiles || []))
      .catch(() => {});
  }, []);

  // ── WebSocket for Lyria RealTime audio streaming + events ──
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
          playAudioChunk(msg as AudioChunkMessage);
        } else if (msg.type === 'music_session_ended') {
          setActive(false);
        } else if (msg.type === 'character_injection') {
          handleCharacterInjection(msg as CharacterInjectionMessage);
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

  /** Decode and schedule a PCM audio chunk for playback via Web Audio API. */
  function playAudioChunk(msg: AudioChunkMessage) {
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
    gain.gain.value = 0.4;
    gain.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    source.start(startTime);
  }

  /** Handle a character injection broadcast from the stage vision pipeline. */
  function handleCharacterInjection(msg: CharacterInjectionMessage) {
    const injectionNarration = msg.narration || 'A new character appears in the story...';
    setNarration(injectionNarration);
    if (msg.imageUrl) {
      setSceneImage(msg.imageUrl);
      setImageSource('imagen_custom');
    }
    setEvents((prev) => [
      ...prev,
      {
        action: 'New character arrives',
        narration: injectionNarration,
        music_mood: musicMood,
        location,
        timestamp: Date.now(),
      },
    ]);
  }

  // ── Story configure ──
  async function handleConfigure() {
    const name = childName.trim();
    const age = parseInt(childAge, 10);
    if (!name) {
      setError('Please enter a name.');
      return;
    }
    if (!age || age < 1 || age > 18) {
      setError('Please enter an age between 1 and 18.');
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/story/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childName: name, childAge: age }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Configure failed (${res.status})`);
      }
      setConfigured(true);
    } catch (err: any) {
      setError(err.message || 'Failed to configure story.');
    }
  }

  // ── Session start/stop ──
  async function handleStart() {
    setError(null);
    setIsStarting(true);
    try {
      if (!subscribedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
        subscribedRef.current = true;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const body: Record<string, string> = {};
      if (themeInput.trim()) body.themeDescription = themeInput.trim();
      if (language !== 'en') body.language = language;

      const res = await fetch(`${API_BASE}/api/story/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as any).error || (data as any).details || `Failed to start (${res.status})`);
        return;
      }
      setActive(true);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStop() {
    try {
      await fetch(`${API_BASE}/api/story/stop`, { method: 'POST' });
    } catch {
      // silent
    }
    setActive(false);
  }

  // ── Story beat ──
  async function handleBeat() {
    const action = beatInput.trim() || 'The story continues gently.';
    setError(null);
    setIsBeating(true);
    setLastInput(action);
    try {
      const res = await fetch(`${API_BASE}/api/story/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as StoryBeatResponse & { error?: string; details?: string };
      if (!res.ok) {
        setError(data.error || data.details || 'Beat failed');
        return;
      }

      applyBeatResponse(action, data);
      setBeatInput('');

      if (data.narrationAudioUrl) {
        playNarration(data.narrationAudioUrl);
      }

      if (active && (data.theme || data.mood || data.emotion)) {
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
    } catch {
      setError('Story beat request failed');
    } finally {
      setIsBeating(false);
    }
  }

  /** Update all story state from a beat response. */
  function applyBeatResponse(action: string, data: StoryBeatResponse) {
    setNarration(data.narration || '');
    setNarrationAudioUrl(data.narrationAudioUrl ?? null);
    setSceneImage(data.image?.imageUrl ?? sceneImage);
    setImageSource(data.image?.source ?? imageSource);
    setLocation(data.location || location);
    setMusicMood(data.music?.mood || data.mood || musicMood);
    if (data.event_number != null) setEventNumber(data.event_number);

    setEvents((prev) => [
      ...prev,
      {
        action,
        narration: data.narration || '',
        music_mood: data.music?.mood || data.mood || 'calm',
        location: data.location || location,
        timestamp: Date.now(),
      },
    ]);
  }

  /** Play narration TTS audio. */
  function playNarration(url: string) {
    if (narrationAudioRef.current) {
      narrationAudioRef.current.pause();
    }
    const audio = new Audio(url);
    audio.volume = 1.0;
    narrationAudioRef.current = audio;
    audio.play().catch(() => {});
  }

  // ── Export storybook ──
  async function handleExport() {
    try {
      const res = await fetch(`${API_BASE}/api/story/export`);
      const data = (await res.json()) as StoryExportResponse;
      if (data.pages?.length) {
        const win = window.open('', '_blank');
        if (win) {
          const html = data.pages
            .map(
              (p, i) =>
                `<div style="margin-bottom:2rem;"><h3>Scene ${i + 1}</h3>${p.imageUrl ? `<img src="${p.imageUrl}" style="max-width:100%;border-radius:12px;" />` : ''}<p style="font-style:italic;">${p.narration}</p></div>`
            )
            .join('');
          win.document.write(`<html><head><title>Storybook</title></head><body style="font-family:serif;max-width:800px;margin:0 auto;padding:2rem;">${html}</body></html>`);
        }
      }
    } catch {
      setError('Export failed');
    }
  }

  // ── Voice input (speech-to-text) ──
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => transcribeRecording(mimeType);
      recorderRef.current = recorder;
      recorder.start();
      setMicState('recording');
    } catch {
      setMicState('idle');
    }
  }, []);

  function stopRecording() {
    recorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }

  async function transcribeRecording(mimeType: string) {
    setMicState('transcribing');
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const base64 = await blobToDataUrl(blob);
    try {
      const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64 }),
      });
      if (!res.ok) throw new Error('Transcription failed');
      const data = (await res.json()) as SpeechTranscribeResponse;
      if (data.transcript) setBeatInput(data.transcript);
    } catch {
      // Silently fail — user can still type
    } finally {
      setMicState('idle');
    }
  }

  function handleMicClick() {
    if (micState === 'recording') {
      stopRecording();
    } else if (micState === 'idle') {
      startRecording();
    }
  }

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
    };
  }, []);

  // ── Face scan callbacks ──
  function handleFaceScanComplete(profiles: CameraProfile[]) {
    setCameraProfiles(profiles);
    setShowFaceScan(false);
  }

  function handleFaceScanSkip() {
    setShowFaceScan(false);
  }

  // ── Render: loading spinner ──
  if (!health && !error) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  // ── Render: face scan gate ──
  if (showFaceScan && (health?.has_subject_customization || health?.has_vision)) {
    return (
      <CharacterSetup
        hasVision={health?.has_vision ?? false}
        hasSubjectCustomization={health?.has_subject_customization ?? false}
        onComplete={handleFaceScanComplete}
        onSkip={handleFaceScanSkip}
      />
    );
  }

  // ── Render: configure step (child name + age + theme) ──
  if (!configured) {
    return (
      <ConfigureStep
        childName={childName}
        childAge={childAge}
        themeInput={themeInput}
        language={language}
        error={error}
        onNameChange={setChildName}
        onAgeChange={setChildAge}
        onThemeChange={setThemeInput}
        onLanguageChange={setLanguage}
        onSubmit={handleConfigure}
      />
    );
  }

  // ── Render: main story view ──
  const hasSpeech = health?.has_speech ?? false;
  const micDisabled = isBeating || micState === 'transcribing';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Health / config warnings */}
      {health && !health.has_gemini && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-600/30 px-4 py-2 text-center text-amber-200/90 text-sm">
          Configure Gemini API — story beats will return 503 until GEMINI_API_KEY is set.
        </div>
      )}
      {health && !health.has_lyria && (
        <div className="rounded-lg bg-amber-900/15 border border-amber-600/20 px-4 py-1.5 text-center text-amber-200/70 text-xs">
          Music unavailable until GOOGLE_CLOUD_PROJECT and billing are configured.
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Scene image */}
      <StoryWorld
        imageUrl={sceneImage}
        imageSource={imageSource}
        isLoading={isBeating}
        eventNumber={eventNumber}
        location={location}
      />

      {/* Session controls */}
      <div className="flex items-center justify-center gap-4">
        {!active ? (
          <button
            onClick={handleStart}
            disabled={!health?.has_lyria || isStarting}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider disabled:opacity-50 transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
          >
            {isStarting ? 'Starting...' : 'Start Music Session'}
          </button>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400/60">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Music streaming
            </span>
            <button
              onClick={handleStop}
              className="bg-red-900/20 hover:bg-red-900/30 border border-red-600/40 rounded-xl px-6 py-3 font-display text-red-200 text-sm tracking-wider transition-all"
            >
              Stop Music
            </button>
          </>
        )}
        {events.length > 0 && (
          <button
            onClick={handleExport}
            className="border border-gold/20 rounded-xl px-4 py-3 font-display text-gold/50 text-sm tracking-wider transition-all hover:text-gold/80 hover:bg-gold/5"
          >
            Export Storybook
          </button>
        )}
      </div>

      {/* Info panels: Narration | Music Mood | Characters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NarrationPanel
          lastInput={lastInput}
          narration={narration}
          location={location}
          narrationAudioUrl={narrationAudioUrl}
          isLoading={isBeating}
        />
        <MusicMoodPanel
          mood={musicMood}
          audioUrl={null}
          hasLyria={health?.has_lyria ?? false}
        />
        <CharacterPanel profiles={cameraProfiles} />
      </div>

      {/* Story beat input */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={beatInput}
            onChange={(e) => setBeatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isBeating && handleBeat()}
            placeholder='What happens next? "The dragon falls asleep..."'
            disabled={isBeating}
            className="flex-1 bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50 focus:shadow-[0_0_20px_rgba(201,169,110,0.1)] transition-all disabled:opacity-50"
          />
          <button
            onClick={handleBeat}
            disabled={isBeating || (health !== null && !health.has_gemini)}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-5 py-3 font-display text-gold text-sm tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
          >
            {isBeating ? <span className="animate-pulse">...</span> : 'Tell'}
          </button>
        </div>

        {/* Voice input */}
        {hasSpeech && (
          <div className="flex gap-2">
            <button
              onClick={handleMicClick}
              disabled={micDisabled}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border font-display text-sm tracking-wider transition-all ${
                micState === 'recording'
                  ? 'bg-red-900/30 border-red-500/50 text-red-400 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                  : micState === 'transcribing'
                    ? 'bg-amber-900/20 border-amber-500/30 text-amber-400'
                    : 'bg-[#12121f] border-gold/20 text-gold/70 hover:bg-gold/5 hover:border-gold/30'
              } disabled:opacity-30`}
            >
              <span className="text-lg">
                {micState === 'recording' ? '🔴' : micState === 'transcribing' ? '⏳' : '🎙️'}
              </span>
              {micState === 'recording'
                ? 'Stop Recording'
                : micState === 'transcribing'
                  ? 'Transcribing...'
                  : 'Speak Your Story'}
            </button>
          </div>
        )}
      </div>

      {/* Event log */}
      <EventLog events={events.map((e) => ({ ...e, diceRoll: null }))} />
    </div>
  );
}

// ── Sub-components ──

/** Child name, age, theme, and language configuration step. */
function ConfigureStep({
  childName,
  childAge,
  themeInput,
  language,
  error,
  onNameChange,
  onAgeChange,
  onThemeChange,
  onLanguageChange,
  onSubmit,
}: {
  childName: string;
  childAge: string;
  themeInput: string;
  language: string;
  error: string | null;
  onNameChange: (v: string) => void;
  onAgeChange: (v: string) => void;
  onThemeChange: (v: string) => void;
  onLanguageChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div className="text-center">
        <h2 className="font-display text-gold text-2xl tracking-[0.12em] uppercase">
          Story Setup
        </h2>
        <p className="text-parchment/50 font-body text-sm mt-2">
          Tell us about the hero of tonight&apos;s story.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-gold/60 text-xs font-mono uppercase tracking-wider mb-1">
            Child&apos;s name
          </label>
          <input
            type="text"
            value={childName}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="e.g. Luna"
            className="w-full bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50 transition-all"
          />
        </div>
        <div>
          <label className="block text-gold/60 text-xs font-mono uppercase tracking-wider mb-1">
            Age
          </label>
          <input
            type="number"
            value={childAge}
            onChange={(e) => onAgeChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="e.g. 5"
            min={1}
            max={18}
            className="w-full bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50 transition-all"
          />
        </div>
        <div>
          <label className="block text-gold/60 text-xs font-mono uppercase tracking-wider mb-1">
            Story theme (optional)
          </label>
          <input
            type="text"
            value={themeInput}
            onChange={(e) => onThemeChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="e.g. forest adventure, under the sea, space..."
            className="w-full bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-gold/50 text-xs font-mono shrink-0">Language:</label>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="bg-[#12121f] border border-gold/20 rounded-lg px-3 py-1.5 text-parchment text-sm font-body focus:outline-none focus:border-gold/50"
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

      <div className="flex justify-center">
        <button
          onClick={onSubmit}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/40 rounded-xl px-8 py-3 font-display text-gold text-sm tracking-wider transition-all hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
        >
          Begin Story
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
