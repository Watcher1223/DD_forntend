# Invite others via QR code

The “Invite with phone” / “QR Invite” flow lets another person join the camera from their phone. The backend returns a **phone URL** from `POST /api/camera/pair`; the frontend turns that into a QR code (e.g. with the `qrcode` library). The QR doesn’t have to be served by the backend — but **the URL inside the QR must be reachable from the phone**.

---

## Hosted backend (e.g. Railway) — use the hosted URL so users can join

For **https://ddbackend-production.up.railway.app** (or your own hosted backend):

1. **Backend:** In Railway (or your host), set **`PUBLIC_BASE_URL = https://ddbackend-production.up.railway.app`**. Then:
   - **`POST /api/camera/pair`** uses this as the base for **phoneUrl** (e.g. `https://ddbackend-production.up.railway.app/phone-camera.html?code=XXXXXX`), so the QR works when scanned on a phone.
   - **`GET /`** (root) returns **`websocket: "wss://ddbackend-production.up.railway.app"`** so the frontend knows the correct WebSocket URL.

2. **Frontend (this repo):**
   - **API base:** Use the hosted URL for all requests. In this app the default is already **`https://ddbackend-production.up.railway.app`** when `NEXT_PUBLIC_API_URL` is not set (see **lib/config.ts**).
   - **WebSocket:** We derive **WS_URL** from the API base (`wss://ddbackend-production.up.railway.app`). So with the default config, the frontend talks to the hosted API and connects to the hosted WebSocket — no localhost.
   - **QR:** If the backend has **PUBLIC_BASE_URL** set, **phoneUrl** is already the hosted URL and the QR points there. If you want to force the QR to the hosted URL regardless of what the backend returns, set **`NEXT_PUBLIC_PAIR_PHONE_BASE_URL=https://ddbackend-production.up.railway.app`** in the frontend `.env`.

**Result:** Inviting via QR uses the **hosted URL** (no localhost), and the frontend’s HTTP + WebSocket connections are correct for the hosted backend. Guests can open the link on their phone and join.

---

## Why the QR code didn’t open on your phone (localhost)

When you use the app at **http://localhost:4300** (or any port), the backend often builds `phoneUrl` from the request host, so it returns something like **http://localhost:4300/camera/join/ABC123**. When you scan that QR on your **phone**, “localhost” means the **phone itself**, not your computer, so the link never reaches your dev server and the page doesn’t open.

**You need a URL the phone can reach.** Use one of the options below.

---

## Option 1: Backend `PUBLIC_BASE_URL` (easiest for local dev)

If you control the backend, set in the **backend** `.env`:

```bash
PUBLIC_BASE_URL=http://YOUR_LAN_IP:4300
```

Replace `YOUR_LAN_IP` with your machine’s LAN IP (e.g. `192.168.1.5`) and the port your backend runs on. Restart the backend, then generate a new pairing/QR. The returned `phoneUrl` will use that base, so scanning the QR on the phone (on the same WiFi) should open the phone-camera page.

**Find your LAN IP:** Mac → System Settings → Network, or run `ifconfig` / `ipconfig`.

---

## Option 2: Open the app by LAN IP

On your computer, open the app at **http://&lt;LAN_IP&gt;:4300** instead of localhost. If the backend derives `phoneUrl` from the request host, it will already see the right host and return a phone-reachable URL without needing `PUBLIC_BASE_URL`.

---

## Option 3: Frontend override (this repo)

The **frontend** can replace the host in `phoneUrl` before generating the QR. Set in the **frontend** `.env`:

```bash
NEXT_PUBLIC_PAIR_PHONE_BASE_URL=http://YOUR_LAN_IP:4300
```

(or your deployed backend URL). The frontend will build the QR using this base instead of the backend’s `phoneUrl` host. See **.env.example** for details.

---

## Summary

| Where       | What to set                    | Purpose |
|------------|---------------------------------|--------|
| Backend    | `PUBLIC_BASE_URL=http://LAN_IP:port` | Backend uses this when building `phoneUrl` for the QR. |
| Frontend   | `NEXT_PUBLIC_PAIR_PHONE_BASE_URL=http://LAN_IP:port` | Frontend replaces the host in `phoneUrl` before generating the QR. |
| Either     | Open app at `http://LAN_IP:port` instead of localhost | Backend may then return a phone-reachable URL without extra config. |

The QR code itself is generated on the frontend; the important part is that the **URL encoded in the QR** is reachable from the phone (e.g. LAN IP or public backend URL), not localhost.

---

## Why localhost is still in the backend

If you look at the backend server code, **localhost** is still there on purpose: it’s the **fallback** when the server doesn’t have a public URL configured.

- When **PUBLIC_BASE_URL** is **not** set (e.g. local `npm run dev`), the server returns **`ws://localhost:${PORT}`** so the frontend can connect to the local backend.
- When **PUBLIC_BASE_URL** is set but parsing it fails, the catch block falls back to **localhost** so the server still returns a valid WebSocket URL instead of throwing.

In **production**, set **PUBLIC_BASE_URL** to your hosted URL (e.g. `https://ddbackend-production.up.railway.app`); then the server uses the public **wss://** URL for the root response and for **phoneUrl**. The localhost branches are only for local dev and error cases.
