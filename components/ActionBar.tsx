'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { SpeechTranscribeResponse } from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';

type MicState = 'idle' | 'recording' | 'transcribing';

interface ActionBarProps {
  onAction: (action: string, diceRoll: number | null, webcamFrame: string | null) => void;
  isProcessing: boolean;
  /** When true (e.g. Gemini not configured), actions return 503 — disable sending. */
  actionDisabled?: boolean;
  /** When false, hide the microphone button entirely. */
  hasSpeech?: boolean;
}

/**
 * Action input bar with text entry, voice recording (via backend Gemini STT),
 * d20 roll, and webcam dice capture.
 */
export default function ActionBar({
  onAction,
  isProcessing,
  actionDisabled = false,
  hasSpeech = false,
}: ActionBarProps) {
  const [textInput, setTextInput] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [showWebcam, setShowWebcam] = useState(false);
  const [webcamReady, setWebcamReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  // ── Voice recording via MediaRecorder + backend transcription ──

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
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

  /** Encode recorded chunks to base64 and send to the backend for transcription. */
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
      if (data.transcript) {
        setTextInput(data.transcript);
      }
    } catch {
      // Silently fail — user can still type manually
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

  // ── Webcam (dice capture) ──

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setWebcamReady(true);
      }
      setShowWebcam(true);
    } catch (err) {
      console.error('Webcam error:', err);
      handleDiceRoll(null);
    }
  };

  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleDiceRoll = (frame: string | null) => {
    setShowWebcam(false);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setWebcamReady(false);
    }

    const action = textInput.trim() || 'I roll for fate';
    onAction(action, null, frame);
    setTextInput('');
  };

  // ── Submit helpers ──

  const handleSubmit = (overrideAction?: string) => {
    const action = overrideAction || textInput.trim();
    if (!action || isProcessing || actionDisabled) return;
    onAction(action, null, null);
    setTextInput('');
  };

  const handleQuickRoll = () => {
    const action = textInput.trim() || 'I act on instinct';
    onAction(action, null, null);
    setTextInput('');
  };

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
    };
  }, []);

  // ── Render ──

  const micDisabled = isProcessing || actionDisabled || micState === 'transcribing';

  return (
    <div className="space-y-3">
      {/* Text input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder='Describe your action... "I sneak past the guard"'
          disabled={isProcessing || actionDisabled}
          className="flex-1 bg-[#12121f] border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body text-base focus:outline-none focus:border-gold/50 focus:shadow-[0_0_20px_rgba(201,169,110,0.1)] transition-all disabled:opacity-50"
        />
        <button
          onClick={() => handleSubmit()}
          disabled={isProcessing || actionDisabled || !textInput.trim()}
          className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-5 py-3 font-display text-gold text-sm tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-[0_0_20px_rgba(201,169,110,0.15)]"
        >
          {isProcessing ? (
            <span className="animate-pulse">...</span>
          ) : (
            'Act'
          )}
        </button>
      </div>

      {/* Action buttons row */}
      <div className="flex gap-2">
        {/* Mic button — only shown when backend supports speech */}
        {hasSpeech && (
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
                : 'Speak Action'}
          </button>
        )}

        {/* Roll d20 */}
        <button
          onClick={handleQuickRoll}
          disabled={isProcessing || actionDisabled}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border bg-[#12121f] border-gold/20 text-gold/70 hover:bg-gold/5 hover:border-gold/30 font-display text-sm tracking-wider transition-all disabled:opacity-30"
        >
          <span className="text-lg">🎲</span>
          Roll d20
        </button>

        {/* Webcam dice button */}
        <button
          onClick={showWebcam ? () => handleDiceRoll(captureFrame()) : startWebcam}
          disabled={isProcessing || actionDisabled}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border font-display text-sm tracking-wider transition-all disabled:opacity-30 ${
            showWebcam
              ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400'
              : 'bg-[#12121f] border-gold/20 text-gold/70 hover:bg-gold/5 hover:border-gold/30'
          }`}
        >
          <span className="text-lg">📷</span>
          {showWebcam ? 'Capture Roll' : 'Webcam Roll'}
        </button>
      </div>

      {/* Webcam preview */}
      {showWebcam && (
        <div className="relative rounded-xl overflow-hidden border border-emerald-500/30 animate-fade-in">
          <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video object-cover" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="border-2 border-emerald-400/50 rounded-xl w-32 h-32 flex items-center justify-center">
              <span className="text-emerald-400/60 text-xs font-mono">Place dice here</span>
            </div>
          </div>
          <button
            onClick={() => {
              setShowWebcam(false);
              if (videoRef.current?.srcObject) {
                (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
              }
            }}
            className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs hover:bg-black/80"
          >
            ✕
          </button>
        </div>
      )}

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// ── Helpers ──

/** Convert a Blob to a data URL (e.g. "data:audio/webm;base64,..."). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
