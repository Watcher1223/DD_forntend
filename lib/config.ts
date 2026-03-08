/**
 * API base URL for the Living Worlds backend.
 * Use NEXT_PUBLIC_API_URL in .env to override (e.g. for local dev).
 */
export const API_BASE =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
    : 'https://ddbackend-production.up.railway.app';

export const WS_URL = API_BASE.replace(/^http/, 'ws');
