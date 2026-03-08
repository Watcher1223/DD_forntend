# Why the AI uses random people instead of my image

Story scene images show **your face** only when **both** of the following are true. Otherwise the backend generates images from text only, so you get generic or "random" people.

---

## 1. Your face was captured and stored **before** the first story beat

The backend needs at least one **reference photo** of you. The frontend sends a camera frame to **`POST /api/camera/analyze`** (with `campaignId`).

**What must happen:**

- **"You: ON"** (or face capture in setup) must run so the app captures your face.
- The app must call the camera, capture a frame, and send it to **`POST /api/camera/analyze`** **before** any **`POST /api/story/beat`**.
- If you start the story and request beats **without** sending a frame first, the backend has **no reference frames** and will generate text-only images (random people).

**Frontend checklist:**

- Prefer **live camera + auto-capture** (see below) so the user never has to click a capture button.
- In setup: when the user’s face is detected, send frames to **`POST /api/camera/analyze`** with `campaignId` (from early **`POST /api/story/configure`**).
- When the user turns **"You: ON"** during the story, send at least one frame to **`POST /api/camera/analyze`** (with `campaignId`) so the next beat can use their face.
- Do **not** allow the first “Next story beat” (or “Tell”) until after at least one successful camera/analyze for that session/campaign, **or** show a clear message: “Turn on You and show your face so the story uses your image.”
- See **`GET /api/health`** → **`has_subject_customization`** and **`POST /api/story/beat`** → **`imageUsedYourFace`** below to show the right messages.

---

## Live camera, auto-capture (no click)

The backend only needs a **frame** (from a photo or from the live stream). You don’t need a separate “capture” or “upload photo” step.

**Recommended flow:**

1. **Use the live camera** — When “You” is ON, call `getUserMedia({ video: true })` and show the stream in a `<video>` element.
2. **Grab a frame from the video** — When the stream is ready, draw the current frame to a `<canvas>` and call `canvas.toDataURL('image/jpeg', 0.85)` to get a data URL (or base64).
3. **Send that frame** — `POST` it to **`POST /api/camera/analyze`** with `{ frame, campaignId }`. No separate “capture” or “upload photo” step.
4. **Optional refresh** — Send a new frame every 5–10 seconds so the reference stays up to date; the user never has to click anything.

**Concise frontend example:**

```javascript
let stream = null;
let refreshInterval = null;

async function startLiveCapture(campaignId) {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  videoRef.current.srcObject = stream;

  const sendFrame = () => {
    if (!videoRef.current?.videoWidth || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const frame = c.toDataURL('image/jpeg', 0.85);
    fetch(`${API_BASE}/api/camera/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame, campaignId }),
    }).catch(() => {});
  };

  // First frame after stream is ready
  setTimeout(sendFrame, 500);
  // Optional: refresh reference every 5s
  refreshInterval = setInterval(sendFrame, 5000);
}

function stopLiveCapture() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
```

When “You” is turned off, call `stopLiveCapture()` and clear the interval so you’re not sending frames unnecessarily.

---

## 2. Vertex Imagen 3 subject customization is configured on the backend

Even with reference frames stored, the backend can only use your face when **Vertex AI Imagen 3 subject customization** is enabled:

- **`GOOGLE_CLOUD_PROJECT`** (or **`VERTEX_AI_PROJECT`**) set in the backend `.env` to a Google Cloud project with Vertex AI and Imagen 3 enabled.
- Billing enabled on that project.

If this is **not** set, the backend skips subject customization and uses **NanoBanana** or **Imagen Fast** with the **text prompt only** → generic people.

**How to check:**

- **`GET /api/health`** → **`has_subject_customization`**: `true` means the backend *can* use your face when reference frames exist; `false` means it will not (backend not configured).

---

## What the frontend uses to explain

| Source | Field | Use in UI |
|--------|--------|-----------|
| **GET /api/health** | **has_subject_customization** | When `false`, show: "Face-in-story is not configured on the server. Scene images will use generic characters until the backend enables Vertex Imagen 3." |
| **POST /api/story/beat** response | **imageUsedYourFace** | `true` → show "Your face" (this scene used your face). `false` → show "Generic character" and hint: turn on You, show your face before the first beat, and ensure server has face-in-story configured. |

---

## Summary

| Cause | What to do |
|-------|------------|
| No reference frames | Frontend: send a camera frame to **`POST /api/camera/analyze`** (with `campaignId`) **before** the first story beat when "You" is ON. Prefer **live camera + auto-capture** (no capture button); send first frame when stream is ready and optionally refresh every 5–10s. |
| Backend not configured | Set **`GOOGLE_CLOUD_PROJECT`** in backend `.env` and enable Vertex AI Imagen 3 (and billing). **`has_subject_customization`** in health should be **true**. |
| "You" was OFF | User turns "You: ON" and shows their face; send at least one frame (or run live auto-capture) so the next beat can use their face. |

Once both conditions are met, new story beats return **`imageUsedYourFace: true`** and scene images should show the user’s face instead of random people.
