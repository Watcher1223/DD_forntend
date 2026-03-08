# Frontend API notes

Quick reference for how the frontend uses the Living Worlds backend.

## Health: `GET /api/health`

- **has_subject_customization** (`boolean`): When `true`, the backend can use your face in scene images (Vertex Imagen 3 subject customization). When `false`, show a message that face-in-story is not configured and images will be generic. See [WHY_RANDOM_PEOPLE.md](./WHY_RANDOM_PEOPLE.md).

## Story beat: `POST /api/story/beat` response

- **imageUsedYourFace** (`boolean`, optional):  
  - `true` → this scene image was generated with your face (Imagen 3 subject customization).  
  - `false` → this scene was text-only (generic character).  

Use it to show “Your face” vs “Generic character” in the UI and to point users to [WHY_RANDOM_PEOPLE.md](./WHY_RANDOM_PEOPLE.md) when they see generic characters.

## Camera / face reference

- Send at least one frame to **`POST /api/camera/analyze`** with **campaignId** before the first **`POST /api/story/beat`** when “You” is ON, so the backend has a reference for personalized images.
- When the user turns “You: ON” during the story, send one frame to **`POST /api/camera/analyze`** (with the current `campaignId`) so the next beat can use their face.

See [WHY_RANDOM_PEOPLE.md](./WHY_RANDOM_PEOPLE.md) for full conditions and troubleshooting.

## Invite others (QR code)

- **`POST /api/camera/pair`** returns **phoneUrl**; the frontend encodes it in a QR code. The URL must be **reachable from the phone** (not localhost). Use **backend** `PUBLIC_BASE_URL` or **frontend** `NEXT_PUBLIC_PAIR_PHONE_BASE_URL` so the QR opens on the phone. See [INVITE_OTHERS_QR.md](./INVITE_OTHERS_QR.md).
