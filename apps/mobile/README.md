# NetworkPeers Worker — Native Mobile App

Native React Native (Expo SDK 54) worker app for the NetworkPeers gig marketplace.

## Flow

```
OTP login -> nearby jobs -> job details -> accept -> task checklist -> live evidence capture -> submit -> under review
```

## Screens

- `app/login.tsx` — phone OTP sign-in via the configured backend provider
- `app/(tabs)/index.tsx` — nearby jobs sorted by distance (PostGIS-backed)
- `app/job/[jobId].tsx` — job detail + accept (atomic server lock)
- `app/task/[jobId].tsx` — checklist with photo/video/audio capture, offline staging, sync, submit
- `app/(tabs)/wallet.tsx` — ledger-backed balance
- `app/(tabs)/profile.tsx` — worker profile + logout

## Anti-fraud rules enforced

- Gallery upload is disabled — every file is captured live in-app (camera/mic only).
- GPS, timestamp, device metadata are attached on capture.
- Submission is blocked until every required media slot is uploaded.
- Evidence is staged locally in SQLite and retried until uploaded.

## Run

```bash
npm install
# local development only; production builds must use an HTTPS API origin
# echo "EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8787" > .env
npx expo start
```

Scan the QR with Expo Go (physical device) or press `i`/`a` for simulator.

## Backend

See `server/` in the NetworkPeer-main repo — a standalone Fastify + PostgreSQL/PostGIS + Redis service exposing the same `/api/worker/*` contracts this app consumes.

## Layout

- `lib/` — types (mirrors shared contracts), API client with token refresh, SQLite offline staging, location helpers
- `components/CaptureModal.tsx` — live photo/video/audio capture with GPS
- `app/` — expo-router file-based screens
