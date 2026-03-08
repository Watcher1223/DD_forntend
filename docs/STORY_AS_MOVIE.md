# Story-as-movie flow (frontend)

The story is presented as a **continuous video**: Ethan (narrator) speaks while scene images update in real time, with the user’s image (and doll) immersed as characters.

## Real-time video streaming

The frontend **streams** the camera to the backend by sending **frames on a timer** (e.g. every 3–5 seconds): grab a frame from the live `<video>` (e.g. via canvas `toDataURL`), then `POST` it to **`POST /api/camera/analyze`** or **`POST /api/story/stage-vision`**. The backend does **not** pull from the camera; it only reacts to these frames. That’s what “real-time” means here: **frontend streams frames → backend detects faces and new characters and uses them in the story.**

Current intervals in this app:

- **Face reference (when “You” is ON):** frame to **`POST /api/camera/analyze`** every **5s** (and one when the user turns “You” ON).
- **Stage vision (new characters):** frame to **`POST /api/story/stage-vision`** every **6s** with `generateImage: true`.

---

## How the “video” works

The backend does **not** stream a single video file. It returns **one image per story beat** plus **narration** and **narrationAudioUrl**. The frontend turns that into a movie by:

1. **Requesting a beat** — `POST /api/story/beat` with `{ action }` (e.g. “Begin the story”, “The story continues...”).
2. **Showing the frame** — Display `image.imageUrl` and narration text for that beat.
3. **Playing Ethan’s voice** — Play `narrationAudioUrl` (TTS).
4. **Advancing when narration ends** — When the narration audio ends, automatically request the **next** beat (`action: "The story continues..."`) so the next image + narration appear. No user click required.
5. **Fallback** — If a beat has no `narrationAudioUrl`, the frontend advances after a short delay (e.g. 8s) so the story still moves forward.

So the “video” is: **image 1 + play narration 1 → (on end) → image 2 + play narration 2 → …** with optional **auto-continue** driven by narration end (or timer when there’s no TTS).

## What’s already wired

| Doc requirement | Frontend behavior |
|-----------------|-------------------|
| Judge speaks theme | Theme from setup input (or voice) is sent in `POST /api/story/start` as `themeDescription`. |
| User’s image + doll in story | Frames sent to `POST /api/camera/analyze` (with `campaignId`) in setup and when “You” is ON; periodic refresh every 5s when “You” is ON. Doll: `POST /api/story/detect-object` + `POST /api/story/set-protagonist`. |
| Ethan narrates + images as video | Each beat returns `narration`, `narrationAudioUrl`, `image.imageUrl`. We show the image, play the audio, and **advance to the next beat when narration ends** (movie-style). |
| Judge / new person on stage | Frames sent to `POST /api/story/stage-vision` (generateImage: true) periodically; WebSocket `character_injection` and `stage_vision_tick` handled. |
| User speaks Swahili → story in Swahili | `POST /api/speech/transcribe` with language detection; on `detectedLanguage` we call `POST /api/story/set-language` and use transcript for the next beat. |

## Real-time camera and new characters

- **Live camera:** When “You” is ON we send a frame to `POST /api/camera/analyze` every 5s (and one when they turn “You” ON). Stage vision runs via `POST /api/story/stage-vision` every few seconds.
- **New characters:** We subscribe to the WebSocket and handle **`character_injection`** (show “Someone joined!” and character card) and **`stage_vision_tick`** (people count). Subsequent beats then include the new character in the story.

See **docs/WHY_RANDOM_PEOPLE.md** for face-in-story requirements and **docs/FRONTEND_API.md** for API quick reference.

---

## Doll (protagonist) — how the frontend sends it

**Yes — the doll is recognized from the camera**, but via a **separate flow** from the one used for people/faces:

- **People/faces** → **`POST /api/camera/analyze`** (and stage-vision). Those frames are for faces and new entrants as stage characters.
- **Doll** → the frontend sends a frame (or a text description) **for the doll** and then sets the protagonist. The backend does not infer the doll from the same analyze frames.

### How we send the doll (same camera, backend vision)

1. Show the doll in the camera (same `<video>` as the user is fine).
2. Capture a frame (e.g. `captureFrame()` → canvas → `toDataURL`).
3. **`POST /api/story/detect-object`** with body `{ frame: "<data URL or base64>" }`.
4. Response includes **`protagonist_description`** (e.g. `"small brown bear with red shirt"`).
5. **`POST /api/story/set-protagonist`** with body `{ protagonist_description: "<that string>" }`.
6. From then on, every **`POST /api/story/beat`** uses the doll as the story’s **hero** in narration and scene prompts.

In this app we run **detect-object** once when a face is first detected in setup (same frame can contain the doll), and we have a **doll-detection interval** during the story (every few seconds) so if the user holds up a different toy we can update the protagonist.

### Doll vs “characters”

The **doll is the story protagonist** (the hero the story is about), **not** a stage character. People who join (in frame or via QR) get a **character-injection** beat and are added as **stage characters**. The doll is stored as **`protagonist_description`** on the session and is woven into **every** beat as the main character; it isn’t added as an extra character card.
