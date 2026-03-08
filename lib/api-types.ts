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
  has_speech: boolean;
  has_semantic_memory?: boolean;
  has_subject_customization?: boolean;
  has_livekit?: boolean;
}

export interface ActionImage {
  imageUrl: string;
  source: 'nanobanana' | 'imagen' | 'imagen_custom';
}

export interface ActionMusic {
  audioUrl: string;
  mood: string;
  description?: string;
  source: 'lyria' | 'preset';
}

export interface ActionResponse {
  narration: string;
  narrationAudioUrl?: string;
  diceRoll: number | null;
  image?: ActionImage;
  music?: ActionMusic;
  location?: string;
  music_mood?: string;
  elapsed_ms?: number;
  event_number?: number;
  action?: string;
}

export interface CampaignEvent {
  action: string;
  diceRoll: number | null;
  narration: string;
  scene_prompt?: string;
  music_mood: string;
  location: string;
  timestamp?: number;
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

export type StoryUpdateMessage = { type: 'story_update'; action?: string } & ActionResponse;

// ── Camera / Character Profiling ──

export interface CharacterAppearance {
  label: string;
  fantasy_name?: string;
  character_description?: string;
  hair: string;
  clothing: string;
  features: string;
  skin_tone?: string;
  age_range: string;
}

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

export interface SpeechTranscribeResponse {
  transcript: string;
  detectedLanguage?: string;
  elapsed_ms: number;
}

export interface PairResponse {
  code: string;
  phoneUrl: string;
  expiresAt: number;
}

export interface ProfilesUpdatedMessage {
  type: 'profiles_updated';
  campaignId: number;
  source: 'phone' | 'local';
  people: CharacterAppearance[];
  setting: string;
  stored: number;
}

export interface CameraProfilesResponse {
  profiles: CameraProfile[];
}

// ── Bedtime story (Lyria RealTime) ──

export interface StoryStatusResponse {
  active: boolean;
  userTheme?: string;
  language?: string;
}

/** POST /api/story/beat response */
export interface StoryBeatResponse {
  narration: string;
  narrationAudioUrl?: string;
  scene_prompt?: string;
  image?: ActionImage;
  music?: {
    theme?: string;
    genre?: string;
    mood?: string;
    intensity?: number;
    emotion?: string;
  };
  theme?: string;
  mood?: string;
  intensity?: number;
  emotion?: string;
  learning_moment?: string;
  location?: string;
  story_energy?: number;
  event_number?: number;
  language?: string;
  /** Optional pre-generated video clip from beat (e.g. Veo) */
  videoClip?: { videoUrl: string; durationSeconds: number };
  /** Scene index this beat corresponds to (for video clip mapping) */
  beatIndex?: number;
}

/** POST /api/story/configure body */
export interface StoryConfigureBody {
  childName: string;
  childAge: number;
  learningGoals?: string[];
}

/** POST /api/story/configure response */
export interface StoryConfigureResponse {
  campaignId: number;
  childName: string;
  childAge: number;
  learningGoals: string[];
  storyEnergy: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface MusicUpdateBody {
  theme?: string;
  genre?: string;
  mood?: string;
  intensity?: number;
  emotion?: string;
  detected_events?: string[];
}

export interface AudioChunkMessage {
  type: 'audio_chunk';
  payload: string;
  sampleRate: number;
  channels: number;
}

export interface MusicSessionEndedMessage {
  type: 'music_session_ended';
}

/** WebSocket: new character injected into the story via stage vision. */
export interface CharacterInjectionMessage {
  type: 'character_injection';
  narration: string;
  scene_prompt?: string;
  imageUrl?: string;
  new_entrant_description?: string;
}

/** WebSocket: periodic stage vision tick with people count. */
export interface StageVisionTickMessage {
  type: 'stage_vision_tick';
  people_count: number;
  new_entrant: boolean;
  setting?: string;
}

/** Single page in an exported storybook. */
export interface StoryExportPage {
  narration: string;
  imageUrl?: string;
  scene_prompt?: string;
  learning_moment?: string;
}

/** GET /api/story/export response. */
export interface StoryExportResponse {
  childName?: string;
  learningGoals?: string[];
  pages: StoryExportPage[];
}
