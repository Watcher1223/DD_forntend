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
