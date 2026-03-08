'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  HealthResponse,
  StoryStatusResponse,
  StoryBeatResponse,
  AudioChunkMessage,
  CharacterInjectionMessage,
  CameraProfile,
  SpeechTranscribeResponse,
  StoryExportResponse,
  StageVisionTickMessage,
} from '@/lib/api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300';
const WS_URL = API_BASE.replace(/^http/, 'ws');
const OVERSHOOT_WS_URL = process.env.NEXT_PUBLIC_OVERSHOOT_WS_URL || '';

// ── Timing constants ──
const EMOTION_POLL_MS = 4000;
const VISION_POLL_MS = 6000;
const AUTO_BEAT_MS = 8000;
const FACE_DETECT_DELAY_MS = 2000;
const OVERSHOOT_EMOTION_MS = 2000;
const OVERSHOOT_OBJECT_MS = 5000;
const OVERSHOOT_SETUP_OBJECT_MS = 3000;
const FACE_CAPTURE_INTERVAL_MS = 1500;
const FACE_CAPTURE_TOTAL = 4;

type Phase = 'setup' | 'playing' | 'export';

interface StoryScene {
  narration: string;
  imageUrl: string | null;
  audioUrl: string | null;
  action: string;
  timestamp: number;
}

/**
 * Fully real-time bedtime story experience.
 * - Camera starts immediately, auto-detects face & doll
 * - Voice input auto-starts story when judge speaks theme
 * - Scenes auto-advance to feel like a video
 * - Emotion detection drives music in real-time
 * - Stage vision detects new people → character injection
 * - Language auto-detected from speech → narration switches
 */
export default function BedtimeStoryView() {
  // ── Health ──
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // ── Phase ──
  const [phase, setPhase] = useState<Phase>('setup');

  // ── Setup state ──
  const [cameraReady, setCameraReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [dollDetected, setDollDetected] = useState<string | null>(null);
  const [themeInput, setThemeInput] = useState('');
  const [language, setLanguage] = useState('en');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Playing state ──
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [currentScene, setCurrentScene] = useState(0);
  const [narration, setNarration] = useState('');
  const [sceneImage, setSceneImage] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<'nanobanana' | 'imagen' | 'imagen_custom' | null>(null);
  const [musicMood, setMusicMood] = useState('calm');
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [peopleCount, setPeopleCount] = useState(0);
  const [isBeating, setIsBeating] = useState(false);
  const [beatInput, setBeatInput] = useState('');
  const [active, setActive] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [injectionMessage, setInjectionMessage] = useState<string | null>(null);

  // ── Mic state ──
  const [isListening, setIsListening] = useState(false);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');

  // ── Multi-frame face capture state ──
  const [faceCaptureProgress, setFaceCaptureProgress] = useState<number>(0); // 0 = not capturing, 1-4 = in progress

  // ── Continuous speech state ──
  const [liveTranscript, setLiveTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [isNarrationPlaying, setIsNarrationPlaying] = useState(false);

  // ── Overshoot state ──
  const [overshootConnected, setOvershootConnected] = useState(false);

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const subscribedRef = useRef(false);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const emotionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoBeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceDetectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const beatingRef = useRef(false);
  const activeRef = useRef(false);
  const faceCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overshootWsRef = useRef<WebSocket | null>(null);
  const overshootEmotionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overshootObjectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overshootSetupObjectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const isNarrationPlayingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { beatingRef.current = isBeating; }, [isBeating]);
  useEffect(() => { isNarrationPlayingRef.current = isNarrationPlaying; }, [isNarrationPlaying]);

  // ── Health check ──
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setError('Cannot reach the backend.'));
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
          playAudioChunk(msg as AudioChunkMessage);
        } else if (msg.type === 'music_session_ended') {
          setActive(false);
        } else if (msg.type === 'character_injection') {
          handleCharacterInjection(msg as CharacterInjectionMessage);
        } else if (msg.type === 'stage_vision_tick') {
          const tick = msg as StageVisionTickMessage;
          setPeopleCount(tick.people_count);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => { subscribedRef.current = false; };
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, []);

  // ── Auto-start camera on mount ──
  useEffect(() => {
    if (phase === 'setup') {
      startCamera();
    }
    return () => stopCamera();
  }, [phase]);

  // ── Auto-detect face once camera is ready + multi-frame capture ──
  useEffect(() => {
    if (cameraReady && phase === 'setup' && !faceDetected) {
      const detect = () => {
        const frame = captureFrame();
        if (!frame) {
          faceDetectTimeoutRef.current = setTimeout(detect, FACE_DETECT_DELAY_MS);
          return;
        }
        fetch(`${API_BASE}/api/camera/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.people && data.people.length > 0) {
              setFaceDetected(true);
              setFaceCaptureProgress(1);
              // Also try to detect a doll/toy in the same frame
              detectDoll(frame);
              // Capture 3 more frames at 1.5s intervals for Imagen subject customization
              let capturedCount = 1;
              const captureNext = () => {
                capturedCount++;
                if (capturedCount > FACE_CAPTURE_TOTAL) {
                  setFaceCaptureProgress(0);
                  return;
                }
                setFaceCaptureProgress(capturedCount);
                const nextFrame = captureFrame();
                if (nextFrame) {
                  fetch(`${API_BASE}/api/camera/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ frame: nextFrame }),
                  }).catch(() => {});
                }
                if (capturedCount < FACE_CAPTURE_TOTAL) {
                  faceCaptureTimeoutRef.current = setTimeout(captureNext, FACE_CAPTURE_INTERVAL_MS);
                } else {
                  // Final capture done
                  faceCaptureTimeoutRef.current = setTimeout(() => setFaceCaptureProgress(0), 500);
                }
              };
              faceCaptureTimeoutRef.current = setTimeout(captureNext, FACE_CAPTURE_INTERVAL_MS);
            } else {
              faceDetectTimeoutRef.current = setTimeout(detect, FACE_DETECT_DELAY_MS);
            }
          })
          .catch(() => {
            faceDetectTimeoutRef.current = setTimeout(detect, FACE_DETECT_DELAY_MS);
          });
      };
      faceDetectTimeoutRef.current = setTimeout(detect, 1500);
    }
    return () => {
      if (faceDetectTimeoutRef.current) clearTimeout(faceDetectTimeoutRef.current);
      if (faceCaptureTimeoutRef.current) clearTimeout(faceCaptureTimeoutRef.current);
    };
  }, [cameraReady, phase, faceDetected]);

  // ── Overshoot WebSocket helpers ──
  function sendFrameToOvershoot(prompt: string, onResult: (text: string) => void) {
    const ws = overshootWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const frame = captureFrame();
    if (!frame) return;
    // Overshoot expects: { image: base64, prompt: string }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const handler = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
        if (msg.requestId === requestId && msg.result) {
          ws.removeEventListener('message', handler);
          onResult(msg.result);
        }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
    // Auto-cleanup after 10s
    setTimeout(() => ws.removeEventListener('message', handler), 10000);
    ws.send(JSON.stringify({ type: 'analyze', image: frame, prompt, requestId }));
  }

  // ── Overshoot WebSocket connection (playing phase) ──
  useEffect(() => {
    if (!OVERSHOOT_WS_URL || phase !== 'playing' || !active) return;
    const ws = new WebSocket(OVERSHOOT_WS_URL);
    ws.onopen = () => {
      overshootWsRef.current = ws;
      setOvershootConnected(true);
    };
    ws.onclose = () => {
      overshootWsRef.current = null;
      setOvershootConnected(false);
    };
    ws.onerror = () => {
      overshootWsRef.current = null;
      setOvershootConnected(false);
    };
    return () => {
      ws.close();
      overshootWsRef.current = null;
      setOvershootConnected(false);
    };
  }, [phase, active]);

  // ── Overshoot emotion detection (every ~2s during playing) ──
  useEffect(() => {
    if (phase !== 'playing' || !active || !overshootConnected) return;
    overshootEmotionIntervalRef.current = setInterval(() => {
      sendFrameToOvershoot(
        'In one word or short phrase, what is the person doing or feeling? Examples: laughing, yawning, scared, happy, sleepy, neutral, excited, sad.',
        (text) => {
          fetch(`${API_BASE}/api/story/vision-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.emotion) setCurrentEmotion(data.emotion);
              if (data.mood) setMusicMood(data.mood);
            })
            .catch(() => {});
        },
      );
    }, OVERSHOOT_EMOTION_MS);
    return () => {
      if (overshootEmotionIntervalRef.current) clearInterval(overshootEmotionIntervalRef.current);
    };
  }, [phase, active, overshootConnected]);

  // ── Overshoot object/doll detection (every ~5s during playing) ──
  useEffect(() => {
    if (phase !== 'playing' || !active || !overshootConnected) return;
    overshootObjectIntervalRef.current = setInterval(() => {
      sendFrameToOvershoot(
        "Describe any toy, doll, or stuffed animal in a few words, or say 'no toy'.",
        (text) => {
          fetch(`${API_BASE}/api/story/vision-object`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.set && data.protagonist_description) {
                setDollDetected(data.protagonist_description);
              }
            })
            .catch(() => {});
        },
      );
    }, OVERSHOOT_OBJECT_MS);
    return () => {
      if (overshootObjectIntervalRef.current) clearInterval(overshootObjectIntervalRef.current);
    };
  }, [phase, active, overshootConnected]);

  // ── Overshoot doll detection during setup phase (every ~3s until found) ──
  useEffect(() => {
    if (phase !== 'setup' || !OVERSHOOT_WS_URL || !cameraReady || dollDetected) return;
    // Connect to Overshoot for setup-phase doll scanning
    const ws = new WebSocket(OVERSHOOT_WS_URL);
    let setupWs: WebSocket | null = ws;
    ws.onopen = () => {
      overshootSetupObjectIntervalRef.current = setInterval(() => {
        if (!setupWs || setupWs.readyState !== WebSocket.OPEN) return;
        const frame = captureFrame();
        if (!frame) return;
        const requestId = `setup-${Date.now()}`;
        const handler = (evt: MessageEvent) => {
          try {
            const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
            if (msg.requestId === requestId && msg.result) {
              setupWs?.removeEventListener('message', handler);
              fetch(`${API_BASE}/api/story/vision-object`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: msg.result }),
              })
                .then((r) => r.json())
                .then((data) => {
                  if (data.set && data.protagonist_description) {
                    setDollDetected(data.protagonist_description);
                  }
                })
                .catch(() => {});
            }
          } catch { /* ignore */ }
        };
        ws.addEventListener('message', handler);
        setTimeout(() => ws.removeEventListener('message', handler), 8000);
        ws.send(JSON.stringify({
          type: 'analyze',
          image: frame,
          prompt: "Describe any toy, doll, or stuffed animal in a few words, or say 'no toy'.",
          requestId,
        }));
      }, OVERSHOOT_SETUP_OBJECT_MS);
    };
    ws.onerror = () => { setupWs = null; };
    ws.onclose = () => { setupWs = null; };
    return () => {
      if (overshootSetupObjectIntervalRef.current) clearInterval(overshootSetupObjectIntervalRef.current);
      setupWs = null;
      ws.close();
    };
  }, [phase, cameraReady, dollDetected]);

  // ── Emotion polling fallback (Gemini, when Overshoot not connected) ──
  useEffect(() => {
    if (phase === 'playing' && active && !overshootConnected) {
      emotionIntervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (!frame) return;
        fetch(`${API_BASE}/api/story/emotion-from-camera`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame, updateMusic: true }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.emotion) setCurrentEmotion(data.emotion);
            if (data.mood) setMusicMood(data.mood);
          })
          .catch(() => {});
      }, EMOTION_POLL_MS);
    }
    return () => {
      if (emotionIntervalRef.current) clearInterval(emotionIntervalRef.current);
    };
  }, [phase, active, overshootConnected]);

  // ── Stage vision polling while playing ──
  useEffect(() => {
    if (phase === 'playing' && active) {
      visionIntervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (!frame) return;
        fetch(`${API_BASE}/api/story/stage-vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame, generateImage: true }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.people_count != null) setPeopleCount(data.people_count);
          })
          .catch(() => {});
      }, VISION_POLL_MS);
    }
    return () => {
      if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    };
  }, [phase, active]);

  // ── Auto-advance beats (video-like) ──
  useEffect(() => {
    if (phase === 'playing' && active && autoAdvance) {
      autoBeatIntervalRef.current = setInterval(() => {
        if (!beatingRef.current && activeRef.current) {
          fireBeat('The story continues...');
        }
      }, AUTO_BEAT_MS);
    }
    return () => {
      if (autoBeatIntervalRef.current) clearInterval(autoBeatIntervalRef.current);
    };
  }, [phase, active, autoAdvance]);

  // ── Camera helpers ──
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      setCameraReady(true);
    } catch {
      // Camera denied — continue without
      setCameraReady(false);
    }
  }

  // Bind stream to video element
  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraReady]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function captureFrame(): string | null {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0) return null;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  async function detectDoll(frame: string) {
    try {
      const res = await fetch(`${API_BASE}/api/story/detect-object`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
      });
      const data = await res.json();
      if (data.protagonist_description) {
        setDollDetected(data.protagonist_description);
        // Set as protagonist
        fetch(`${API_BASE}/api/story/set-protagonist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ protagonist_description: data.protagonist_description }),
        }).catch(() => {});
      } else if (data.objects?.length > 0) {
        const obj = data.objects[0];
        setDollDetected(`${obj.name}: ${obj.description}`);
        fetch(`${API_BASE}/api/story/set-protagonist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ protagonist_description: `${obj.name}: ${obj.description}` }),
        }).catch(() => {});
      }
    } catch { /* silent */ }
  }

  // ── Audio playback ──
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

  function playNarrationAudio(url: string) {
    if (narrationAudioRef.current) {
      narrationAudioRef.current.pause();
    }
    const audio = new Audio(url);
    audio.volume = 1.0;
    narrationAudioRef.current = audio;
    setIsNarrationPlaying(true);
    audio.onended = () => setIsNarrationPlaying(false);
    audio.onpause = () => setIsNarrationPlaying(false);
    audio.play().catch(() => setIsNarrationPlaying(false));
  }

  // ── Character injection from WebSocket ──
  function handleCharacterInjection(msg: CharacterInjectionMessage) {
    const text = msg.narration || 'A new character joins the story...';
    setNarration(text);
    setInjectionMessage(text);
    setTimeout(() => setInjectionMessage(null), 5000);
    if (msg.imageUrl) {
      setSceneImage(msg.imageUrl);
      setImageSource('imagen_custom');
      setScenes((prev) => [
        ...prev,
        { narration: text, imageUrl: msg.imageUrl!, audioUrl: null, action: 'Character arrives', timestamp: Date.now() },
      ]);
    }
  }

  // ── Story session ──
  async function handleStart() {
    setError(null);
    setIsStarting(true);
    try {
      // Ensure WebSocket subscribed
      if (!subscribedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: 'story_audio' }));
        subscribedRef.current = true;
        await new Promise((r) => setTimeout(r, 500));
      }

      // Resume audio context (browser policy)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // Configure story
      await fetch(`${API_BASE}/api/story/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childName: 'Hero', childAge: 5 }),
      }).catch(() => {});

      // Start music session
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
      setPhase('playing');

      // Fire first beat immediately
      const firstAction = themeInput.trim()
        ? `Begin a bedtime story about: ${themeInput.trim()}`
        : 'Begin a magical bedtime story';
      fireBeat(firstAction);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStop() {
    try {
      await fetch(`${API_BASE}/api/story/stop`, { method: 'POST' });
    } catch { /* silent */ }
    setActive(false);
  }

  // ── Fire a story beat ──
  async function fireBeat(action: string) {
    if (beatingRef.current) return;
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

      setNarration(data.narration || '');
      if (data.image?.imageUrl) {
        setSceneImage(data.image.imageUrl);
        setImageSource(data.image.source ?? null);
      }
      if (data.mood) setMusicMood(data.mood);

      // Auto-detect language change from beat response
      if (data.language && data.language !== language) {
        setLanguage(data.language);
        setDetectedLanguage(data.language);
      }

      // Play narration audio
      if (data.narrationAudioUrl) {
        playNarrationAudio(data.narrationAudioUrl);
      }

      // Update music
      if (activeRef.current && (data.theme || data.mood || data.emotion)) {
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

      // Add to scenes
      const scene: StoryScene = {
        narration: data.narration || '',
        imageUrl: data.image?.imageUrl ?? null,
        audioUrl: data.narrationAudioUrl ?? null,
        action,
        timestamp: Date.now(),
      };
      setScenes((prev) => {
        const next = [...prev, scene];
        setCurrentScene(next.length - 1);
        return next;
      });
    } catch {
      setError('Story beat request failed');
    } finally {
      setIsBeating(false);
    }
  }

  // ── Voice input for theme / story beats ──
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
      setIsListening(true);
    } catch {
      setMicState('idle');
    }
  }, [phase, active]);

  function stopRecording() {
    recorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setIsListening(false);
  }

  async function transcribeRecording(mimeType: string) {
    setMicState('transcribing');
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const base64 = await blobToDataUrl(blob);
    try {
      const res = await fetch(`${API_BASE}/api/speech/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, detectLanguage: true }),
      });
      if (!res.ok) throw new Error('Transcription failed');
      const data = (await res.json()) as SpeechTranscribeResponse;

      if (data.detectedLanguage && data.detectedLanguage !== language) {
        setDetectedLanguage(data.detectedLanguage);
        setLanguage(data.detectedLanguage);
        // Tell the backend to switch language
        fetch(`${API_BASE}/api/story/set-language`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: data.detectedLanguage }),
        }).catch(() => {});
      }

      if (data.transcript) {
        if (phase === 'setup') {
          setThemeInput(data.transcript);
        } else if (phase === 'playing') {
          fireBeat(data.transcript);
        }
      }
    } catch { /* silent */ }
    finally {
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

  // ── Continuous speech recognition (Web Speech API) ──
  useEffect(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    setSpeechSupported(!!SpeechRecognition);
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition || phase !== 'playing' || !active) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language || 'en-US';
    speechRecognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (interimTranscript) {
        setLiveTranscript(interimTranscript);
      }

      if (finalTranscript.trim()) {
        setLiveTranscript('');
        // Auto-detect language from speech
        const detLang = detectLanguageFromText(finalTranscript);
        if (detLang && detLang !== language) {
          setDetectedLanguage(detLang);
          setLanguage(detLang);
          fetch(`${API_BASE}/api/story/set-language`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: detLang }),
          }).catch(() => {});
        }
        // Fire story beat with the transcript
        if (!beatingRef.current && activeRef.current) {
          fireBeat(finalTranscript.trim());
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[SPEECH] Recognition error:', event.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart unless we're no longer in playing phase
      if (activeRef.current && !isNarrationPlayingRef.current) {
        try { recognition.start(); } catch { /* already started */ }
      }
      setSpeechActive(false);
    };

    recognition.onstart = () => setSpeechActive(true);

    // Start recognition (pause if narration is currently playing)
    if (!isNarrationPlaying) {
      try { recognition.start(); } catch { /* ignore */ }
    }

    return () => {
      speechRecognitionRef.current = null;
      try { recognition.stop(); } catch { /* ignore */ }
      setSpeechActive(false);
      setLiveTranscript('');
    };
  }, [phase, active, language]);

  // ── Pause/resume speech recognition during narration audio ──
  useEffect(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    if (isNarrationPlaying) {
      try { recognition.stop(); } catch { /* ignore */ }
    } else if (activeRef.current && phase === 'playing') {
      try { recognition.start(); } catch { /* already started */ }
    }
  }, [isNarrationPlaying]);

  // ── Export ──
  async function handleExport() {
    setPhase('export');
  }

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      try { speechRecognitionRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  // ── Language display map ──
  const langNames: Record<string, string> = {
    en: 'English', es: 'Spanish', fr: 'French', sw: 'Swahili', ru: 'Russian',
    de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', ar: 'Arabic', hi: 'Hindi',
  };

  // ── Loading ──
  if (!health && !error) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  // ═══════════════════════════════════════
  // SETUP PHASE
  // ═══════════════════════════════════════
  if (phase === 'setup') {
    return (
      <div className="space-y-5 animate-fade-in">
        {error && (
          <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Live camera preview — always-on */}
        <div className="relative rounded-2xl overflow-hidden border-2 border-gold/30 shadow-[0_0_40px_rgba(201,169,110,0.12)] aspect-video bg-midnight-light">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* Status overlay */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              {cameraReady ? (
                <span className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-300/90 text-xs font-mono">LIVE</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-amber-300/90 text-xs font-mono">NO CAMERA</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {faceDetected && (
                <span className="bg-emerald-900/60 backdrop-blur-sm border border-emerald-500/30 rounded-full px-3 py-1 text-emerald-300 text-xs font-mono animate-fade-in">
                  {faceCaptureProgress > 0
                    ? `Capturing face ${faceCaptureProgress}/${FACE_CAPTURE_TOTAL}...`
                    : 'Face captured'}
                </span>
              )}
              {dollDetected && (
                <span className="bg-gold/20 backdrop-blur-sm border border-gold/30 rounded-full px-3 py-1 text-gold text-xs font-mono animate-fade-in truncate max-w-[180px]">
                  {dollDetected}
                </span>
              )}
            </div>
          </div>

          {/* Scanning indicator */}
          {cameraReady && !faceDetected && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center bg-black/40 backdrop-blur-sm rounded-2xl px-8 py-6">
                <div className="w-10 h-10 border-2 border-gold/40 border-t-gold rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gold/80 text-sm font-display tracking-wider">Scanning for you...</p>
                <p className="text-parchment/40 text-xs mt-1">Look at the camera</p>
              </div>
            </div>
          )}

          {/* Bottom gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-midnight/90 to-transparent" />
        </div>

        {/* Theme input + voice */}
        <div className="bg-midnight-light/50 border border-gold/10 rounded-2xl p-5 space-y-4">
          <div className="text-center">
            <h2 className="font-display text-gold text-lg tracking-wider">
              What&apos;s tonight&apos;s story about?
            </h2>
            <p className="text-parchment/40 text-xs mt-1">
              Speak a theme or type it — the story begins when you&apos;re ready
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={themeInput}
              onChange={(e) => setThemeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              placeholder="forest adventure, under the sea, space mission..."
              className="flex-1 bg-midnight border border-gold/20 rounded-xl px-4 py-3 text-parchment placeholder:text-parchment/20 font-body focus:outline-none focus:border-gold/50 transition-all"
            />
            <button
              onClick={handleMicClick}
              className={`px-4 py-3 rounded-xl border font-display text-sm transition-all ${
                micState === 'recording'
                  ? 'bg-red-900/30 border-red-500/50 text-red-400 animate-pulse'
                  : micState === 'transcribing'
                    ? 'bg-amber-900/20 border-amber-500/30 text-amber-400'
                    : 'bg-gold/10 border-gold/30 text-gold/70 hover:bg-gold/20'
              }`}
            >
              {micState === 'recording' ? '🔴' : micState === 'transcribing' ? '...' : '🎙️'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-gold/50 text-xs font-mono shrink-0">Language:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-midnight border border-gold/20 rounded-lg px-3 py-1.5 text-parchment text-sm font-body focus:outline-none focus:border-gold/50"
            >
              {Object.entries(langNames).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            {detectedLanguage && (
              <span className="text-emerald-400/60 text-xs font-mono animate-fade-in">
                Auto-detected: {langNames[detectedLanguage] || detectedLanguage}
              </span>
            )}
          </div>
        </div>

        {/* Start button */}
        <div className="text-center">
          <button
            onClick={handleStart}
            disabled={isStarting}
            className="bg-gold/15 hover:bg-gold/25 border border-gold/40 rounded-2xl px-10 py-4 font-display text-gold text-lg tracking-[0.15em] transition-all disabled:opacity-40 hover:shadow-[0_0_30px_rgba(212,168,83,0.15)]"
          >
            {isStarting ? 'Starting...' : 'Begin the Story'}
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // ═══════════════════════════════════════
  // EXPORT PHASE
  // ═══════════════════════════════════════
  if (phase === 'export') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center">
          <h2 className="font-display text-gold text-2xl tracking-[0.12em] uppercase">
            Your Storybook
          </h2>
          <p className="text-parchment/50 text-sm mt-2">{scenes.length} scenes</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {scenes.map((scene, i) => (
            <div
              key={i}
              className="bg-midnight-light/50 border border-gold/10 rounded-xl overflow-hidden"
            >
              {scene.imageUrl && (
                <img
                  src={scene.imageUrl}
                  alt={`Scene ${i + 1}`}
                  className="w-full aspect-video object-cover"
                />
              )}
              <div className="p-3">
                <p className="text-gold/60 text-xs font-mono mb-1">Scene {i + 1}</p>
                <p className="text-parchment/80 font-body text-sm italic leading-relaxed">
                  {scene.narration}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={() => setPhase('playing')}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-6 py-3 font-display text-gold text-sm tracking-wider transition-all"
          >
            Back to Story
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // PLAYING PHASE — Full-screen immersive
  // ═══════════════════════════════════════
  return (
    <div className="space-y-3 animate-fade-in">
      {error && (
        <div className="rounded-lg bg-red-900/20 border border-red-600/30 px-4 py-2 text-center text-red-200 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 underline text-xs">dismiss</button>
        </div>
      )}

      {/* Character injection flash */}
      {injectionMessage && (
        <div className="rounded-lg bg-gold/10 border border-gold/30 px-4 py-2 text-center text-gold text-sm animate-fade-in">
          ✨ {injectionMessage}
        </div>
      )}

      {/* Scene display — full width, video-like */}
      <div className="relative rounded-2xl overflow-hidden border-2 border-gold/30 shadow-[0_0_60px_rgba(212,168,83,0.15)] aspect-video bg-midnight-light min-h-[300px]">
        {/* Scene image */}
        {sceneImage ? (
          <img
            src={sceneImage}
            alt="Story scene"
            className="w-full h-full object-cover transition-opacity duration-700"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-midnight-light via-midnight to-midnight-light">
            <div className="text-center">
              <div className="text-5xl mb-3 animate-pulse">🌙</div>
              <p className="font-display text-gold text-xl tracking-widest">
                {isBeating ? 'Creating scene...' : 'STORY WORLD'}
              </p>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isBeating && (
          <div className="absolute inset-0 bg-midnight/30 flex items-center justify-center z-20">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-5 py-2 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-gold/40 border-t-gold rounded-full animate-spin" />
              <span className="text-gold text-sm font-display tracking-wider">Creating...</span>
            </div>
          </div>
        )}

        {/* Top bar: scene number + emotion + people count */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-midnight/80 to-transparent p-3 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {scenes.length > 0 && (
                <span className="bg-black/50 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-xs font-mono text-parchment/80">
                  Scene {currentScene + 1}/{scenes.length}
                </span>
              )}
              {imageSource && (
                <span className="bg-black/50 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono text-gold/90 uppercase">
                  {imageSource === 'imagen_custom' ? 'Personalized' : 'AI'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {detectedLanguage && detectedLanguage !== 'en' && (
                <span className="bg-blue-900/40 backdrop-blur-sm border border-blue-400/20 rounded-full px-2.5 py-0.5 text-blue-300 text-xs font-mono">
                  {langNames[detectedLanguage] || detectedLanguage}
                </span>
              )}
              <span className="bg-black/50 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-xs font-mono text-parchment/60">
                {currentEmotion}
              </span>
              {peopleCount > 0 && (
                <span className="bg-black/50 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-xs font-mono text-parchment/60">
                  {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
                </span>
              )}
              {speechActive && (
                <span className="flex items-center gap-1 bg-blue-900/40 backdrop-blur-sm rounded-full px-2.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-blue-300 text-xs font-mono">Listening</span>
                </span>
              )}
              {overshootConnected && (
                <span className="flex items-center gap-1 bg-purple-900/40 backdrop-blur-sm rounded-full px-2.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-purple-300 text-xs font-mono">Vision</span>
                </span>
              )}
              {active && (
                <span className="flex items-center gap-1 bg-emerald-900/40 backdrop-blur-sm rounded-full px-2.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-300 text-xs font-mono">Music</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: narration overlay + live transcript */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-midnight/90 via-midnight/60 to-transparent p-4 z-10">
          {narration && (
            <p className="font-story text-parchment text-base leading-relaxed italic max-w-3xl">
              &ldquo;{narration}&rdquo;
            </p>
          )}
          {liveTranscript && (
            <p className="font-body text-gold/60 text-sm mt-1 animate-pulse truncate max-w-2xl">
              {liveTranscript}...
            </p>
          )}
        </div>

        {/* Scene navigation arrows */}
        {scenes.length > 1 && (
          <>
            <button
              onClick={() => {
                const prev = Math.max(0, currentScene - 1);
                setCurrentScene(prev);
                setSceneImage(scenes[prev].imageUrl);
                setNarration(scenes[prev].narration);
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-parchment/60 hover:text-parchment transition-all"
            >
              ‹
            </button>
            <button
              onClick={() => {
                const next = Math.min(scenes.length - 1, currentScene + 1);
                setCurrentScene(next);
                setSceneImage(scenes[next].imageUrl);
                setNarration(scenes[next].narration);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-parchment/60 hover:text-parchment transition-all"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3">
        {/* Left: beat input + mic */}
        <div className="flex-1 flex gap-2">
          <input
            type="text"
            value={beatInput}
            onChange={(e) => setBeatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isBeating && beatInput.trim()) {
                fireBeat(beatInput.trim());
                setBeatInput('');
              }
            }}
            placeholder='What happens next?'
            disabled={isBeating}
            className="flex-1 bg-[#12121f] border border-gold/20 rounded-xl px-4 py-2.5 text-parchment placeholder:text-parchment/20 font-body text-sm focus:outline-none focus:border-gold/50 transition-all disabled:opacity-50"
          />
          <button
            onClick={() => {
              if (beatInput.trim()) {
                fireBeat(beatInput.trim());
                setBeatInput('');
              } else {
                fireBeat('The story continues...');
              }
            }}
            disabled={isBeating}
            className="bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-xl px-4 py-2.5 font-display text-gold text-sm tracking-wider transition-all disabled:opacity-30"
          >
            {isBeating ? '...' : 'Tell'}
          </button>
          <button
            onClick={handleMicClick}
            className={`px-3 py-2.5 rounded-xl border text-sm transition-all ${
              micState === 'recording'
                ? 'bg-red-900/30 border-red-500/50 text-red-400 animate-pulse'
                : micState === 'transcribing'
                  ? 'bg-amber-900/20 border-amber-500/30 text-amber-400'
                  : 'bg-[#12121f] border-gold/20 text-gold/60 hover:bg-gold/5'
            }`}
          >
            {micState === 'recording' ? '🔴' : micState === 'transcribing' ? '⏳' : '🎙️'}
          </button>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAutoAdvance(!autoAdvance)}
            className={`px-3 py-2.5 rounded-xl border text-xs font-mono transition-all ${
              autoAdvance
                ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400'
                : 'bg-[#12121f] border-gold/20 text-parchment/40'
            }`}
            title={autoAdvance ? 'Auto-advance ON' : 'Auto-advance OFF'}
          >
            {autoAdvance ? '▶ Auto' : '⏸ Manual'}
          </button>
          {scenes.length > 0 && (
            <button
              onClick={handleExport}
              className="px-3 py-2.5 rounded-xl border border-gold/20 text-gold/50 text-xs font-mono hover:text-gold/80 hover:bg-gold/5 transition-all"
            >
              Export
            </button>
          )}
          <button
            onClick={handleStop}
            className="px-3 py-2.5 rounded-xl border border-red-600/30 text-red-400/60 text-xs font-mono hover:text-red-400 hover:bg-red-900/20 transition-all"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Mini camera preview — fixed bottom-right */}
      {cameraReady && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="relative w-32 h-24 rounded-xl overflow-hidden border border-gold/30 shadow-lg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="absolute top-1 left-1 flex items-center gap-1 bg-black/50 rounded-full px-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[8px] text-parchment/60 font-mono">CAM</span>
            </div>
          </div>
        </div>
      )}

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
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

/** Basic language detection from keywords in transcribed text. */
function detectLanguageFromText(text: string): string | null {
  const t = text.toLowerCase();
  const langPatterns: [RegExp, string][] = [
    [/\b(hola|buenas|cuento|historia|por favor)\b/i, 'es'],
    [/\b(bonjour|bonsoir|histoire|s'il vous plaît)\b/i, 'fr'],
    [/\b(guten|abend|geschichte|bitte)\b/i, 'de'],
    [/\b(ciao|buona|storia|per favore)\b/i, 'it'],
    [/\b(olá|boa|história|por favor)\b/i, 'pt'],
    [/\b(здравствуйте|спасибо|сказка|пожалуйста)\b/i, 'ru'],
    [/\b(habari|hadithi|tafadhali)\b/i, 'sw'],
  ];
  for (const [re, code] of langPatterns) {
    if (re.test(t)) return code;
  }
  return null;
}
