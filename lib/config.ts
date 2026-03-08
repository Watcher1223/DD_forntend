/**
 * API base URL for the Living Worlds backend.
 * Use NEXT_PUBLIC_API_URL in .env to override (e.g. for local dev).
 */
export const API_BASE =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
    : 'https://ddbackend-production.up.railway.app';

export const WS_URL = API_BASE.replace(/^http/, 'ws');

/**
 * Base URL used for the "Invite with phone" QR code. Phones can't open localhost.
 * Set NEXT_PUBLIC_PAIR_PHONE_BASE_URL so the QR points somewhere the phone can reach:
 * - Use your deployed backend (e.g. https://ddbackend-production.up.railway.app), or
 * - Use your machine's LAN IP (e.g. http://192.168.1.5:4300) when backend runs locally and phone is on same WiFi.
 * If unset, we use API_BASE (works when API is already a public URL).
 */
export const PAIR_PHONE_BASE =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PAIR_PHONE_BASE_URL
    ? process.env.NEXT_PUBLIC_PAIR_PHONE_BASE_URL.replace(/\/$/, '')
    : API_BASE;
