# Story flow: backend beat-by-beat and frontend UX

## Why it’s image-by-image

The backend is built around **one image per story beat**. Each time you call **`POST /api/story/beat`**, the server:

1. Generates **narration** (Gemini)
2. Generates a **scene image** (Imagen / NanoBanana)

That round trip often takes **10–30 seconds**, so you get a “Creating scene…” pause between beats. There is **no single streaming video**; the “video” is the frontend playing beat 1 (image + narration), then beat 2, and so on.

---

## Frontend: making beat-by-beat feel like continuous video

The backend stays one-image-per-beat. The frontend can make it feel more like a continuous movie by:

### 1. Keep the previous image on screen

Don’t replace the whole view with a full-screen “Creating scene... This may take 10–30 seconds” spinner. **Leave the last scene image visible** and use a small overlay (e.g. “Drawing next scene…” or a small spinner) so the story doesn’t feel frozen.

### 2. Prefetch the next beat (optional)

When the current narration **starts playing** (or when “Auto” is on), immediately request the next beat in the background (`action: "The story continues..."` or `"What happens next?"`). By the time the current narration ends, the next image may already be ready, so the gap between scenes shrinks. The frontend must then **use the prefetched result** when narration ends instead of firing a second request (and the backend must support or tolerate this pattern if you use it).

### 3. Play narration as soon as you have it

When a beat response arrives, start **`narrationAudioUrl`** right away. Show the new **`image.imageUrl`** when it’s loaded (or keep the previous image until then) so the story keeps moving even if the image is a bit slower.

### 4. Auto-continue

When narration **ends**, if you already have the next beat (from prefetch or from firing on end), show its image and play its audio without an extra loading step. If you use auto-advance, advance to the next beat on narration end (or after a short delay when there’s no TTS).

### 5. Avoid blocking the whole UI

Prefer a **small, non-blocking loading state** (e.g. corner spinner or short “Drawing next scene…”) instead of a full-screen “Creating scene... 10–30 seconds” so the current scene stays visible.

---

## Summary

With **prefetch** + **keep previous image visible** + **auto-continue**, the flow becomes:

- Show scene 1 → play narration 1 → (prefetch beat 2 in background) → when narration 1 ends, play narration 2 and show scene 2 when it’s ready.

The backend is still one-image-per-beat; the frontend makes it feel more like a continuous video.

See **docs/STORY_AS_MOVIE.md** for how the “video” is wired (narration end → next beat) , **docs/FRONTEND_API.md** for API details, and **docs/VIDEO_RENDERING.md** for step-by-step implementation and prefetch flow.
