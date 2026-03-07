/**
 * Living Worlds API types — aligned with backend real-data contract.
 */

export interface HealthResponse {
  status: string;
  service: string;
  campaign_events: number;
  has_gemini: boolean;
  has_nanobanana: boolean;
  has_lyria: boolean;
  has_vision: boolean;
}

export interface ActionImage {
  imageUrl: string;
  source: 'nanobanana' | 'imagen';
}

export interface ActionMusic {
  audioUrl: string;
  mood: string;
  description?: string;
  source: 'lyria';
}

export interface ActionResponse {
  narration: string;
  narrationAudioUrl: string;
  diceRoll: number | null;
  image: ActionImage;
  music: ActionMusic;
  location: string;
  music_mood: string;
  elapsed_ms: number;
  event_number: number;
}

export interface CampaignEvent {
  action: string;
  diceRoll: number | null;
  narration: string;
  scene_prompt?: string;
  music_mood: string;
  location: string;
  timestamp: number;
}

export interface CampaignResponse {
  characters: Array<{ name: string; role: string; description: string }>;
  locations: string[];
  eventCount: number;
  recentEvents: CampaignEvent[];
}

export interface DiceResponse {
  detected: boolean;
  value: number;
  simulated: boolean;
}

export type StoryUpdateMessage = { type: 'story_update' } & ActionResponse;

// ── Camera / Character Profiling ──

export interface CharacterAppearance {
  label: string;
  hair: string;
  clothing: string;
  features: string;
  age_range: string;
}

/** Response from POST /api/camera/analyze */
export interface CameraAnalyzeResponse {
  people: CharacterAppearance[];
  setting: string;
  stored: number;
  elapsed_ms: number;
}

export interface CameraProfile {
  label: string;
  appearance: CharacterAppearance;
  updated_at: number;
}

/** Response from GET /api/camera/profiles */
export interface CameraProfilesResponse {
  profiles: CameraProfile[];
}

// ── Bedtime story (Lyria RealTime) ──

/** GET /api/story/status */
export interface StoryStatusResponse {
  active: boolean;
}

/** POST /api/story/beat response */
export interface StoryBeatResponse {
  narration: string;
  scene_prompt?: string;
  theme?: string;
  mood?: string;
  intensity?: number;
  emotion?: string;
  location?: string;
  event_number?: number;
}

/** POST /api/music/update body (all optional) */
export interface MusicUpdateBody {
  theme?: string;
  genre?: string;
  mood?: string;
  intensity?: number;
  emotion?: string;
}

/** WebSocket message: audio_chunk */
export interface AudioChunkMessage {
  type: 'audio_chunk';
  payload: string; // base64 PCM
  sampleRate: number;
  channels: number;
}

/** WebSocket message: music_session_ended */
export interface MusicSessionEndedMessage {
  type: 'music_session_ended';
}
