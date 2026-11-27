# HearthFrame

**Turn your old Android, iOS device, tablet, or TV into a private digital photo frame.**

A lightweight, multi-user photo slideshow and gallery web app engineered for repurposed legacy hardware (Android 4.4+ / Chrome 25+), smart TVs, iPads, and modern browsers — built for slow home Wi-Fi networks, zero-typing TV pairing, and zero-maintenance daily display.

![Legacy Compatible](https://img.shields.io/badge/Legacy%20Web-ES5%20%2F%20Android%204.4%2B-c2591a)
![Multi-User](https://img.shields.io/badge/Workspaces-Multi--User%20Isolated-2b241d)
![Storage](https://img.shields.io/badge/Storage-Cloudflare%20R2%20%2F%20Local-e88b3a)
![Runtime](https://img.shields.io/badge/Runtime-Node.js%2020%2B%20%2F%20Express-1c1814)

---

## Table of Contents

- [Highlights](#highlights)
- [How Screen Pairing Works](#how-screen-pairing-works)
- [System Design](#system-design)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Cloudflare R2 Setup](#cloudflare-r2-setup-recommended-for-production)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Account Guidelines & Terms of Service](#account-guidelines--terms-of-service)
- [Security Practices](#security-practices)
- [Upcoming Features](#upcoming-features)

---

## Highlights

- **Zero-Typing TV & Tablet Pairing (QR Code + 6-Char PIN)** — The home page puts **Frame Display** right at the top and opens directly onto **Pair TV / QR**, showing a server-generated QR code and an easy-to-read 6-character code (e.g., `K7M-9P2`). Scan it with your phone or enter the code in **Admin → Pair & Access**, and your TV or old tablet signs in automatically within 3 seconds.
- **Built for Legacy Hardware & Slow Wi-Fi** — The frontend runs on strict ES5 JavaScript (`XMLHttpRequest`, zero `fetch`/`Promise`, zero modern CSS Grid/Flexbox gaps), supporting Android 4.4+ / Chrome 25+ tablets alongside modern devices.
- **Multi-User Private Workspaces on One URL (`/`)** — Friends and family can create their own isolated private workspace from **Admin Account → Create Account** (with built-in **Account Guidelines & Terms of Service** confirmation), upload up to **100 photos**, configure **Display Profiles**, and pair their own screens.
- **Owner Controls & Built-In Safeguards** — The primary Owner workspace stays unlimited and includes an Owner-only **Accounts** tab to view workspace counts and remove abusive or inactive accounts (without ever exposing private photos). Includes a default **20-account server cap** (`MAX_ACCOUNTS`), **3 signups/hour per-IP rate limit**, and an optional `SIGNUP_INVITE_CODE` switch.
- **Multi-Screen Display Profiles** — Upload photos once to **Photos** and assign them to any combination of screens (e.g., *Android Tablet*, *iPad*, *Living Room TV*), each with its own slide speed, transition, scaling mode, clock/caption overlay, and photo loading mode. When pairing a screen, single-profile users launch straight into their slideshow automatically, while multi-profile users can pick the exact profile right from their phone.
- **Persistent 30-Day Display Sessions** — Paired or signed-in Frame Display screens stay authenticated for **30 days** via a workspace-bound `HttpOnly` signed cookie and automatically resume the last Display Profile opened on that browser. Admin logins use a shorter browser-session cookie (up to 12 hours) for household security.
- **2-Layer Keep Screen Awake** — Keeps tablet screens from sleeping during slideshows using the native Screen Wake Lock API (Layer 1) with an automatic invisible looping video fallback (Layer 2) for older Android browsers.
- **Persistent Cloudflare R2 Storage (`$0` Egress)** — Stores photos, thumbnails, profiles, and accounts in isolated Cloudflare R2 prefixes using a custom zero-SDK SigV4 client, with seamless local filesystem fallback for local development.
- **Bulk Drag-and-Drop Photo Upload** — Drag and drop multiple photos at once onto **Admin → Photos** (with additive multi-drop queuing, instant thumbnail previews, per-file removal, automatic client-side optimization, a live upload progress bar, and full click-to-browse fallback for mobile and legacy tablets).
- **Client-Side Upload Optimization** — Automatically resizes photos in the browser before uploading (producing a display-sized JPEG + lightweight thumbnail) to keep uploads fast and tablet memory usage low.

---

## How Screen Pairing Works

Typing usernames and passwords with a TV remote or on a laggy old tablet is painful. HearthFrame solves this with standard smart-TV pairing:

```text
1. TV / Old Tablet opens `/`
   └─► Frame Display (top card) opens on "Pair TV / QR" automatically
   └─► Displays a private QR code + 6-character PIN (e.g., K7M-9P2)
   └─► Gently polls /api/auth/pair/status every 3s using a secret pollToken

2. Your Phone / Computer
   └─► Scan the QR code (opens /?pair=K7M9P2 directly) OR open Admin → Pair & Access
   └─► Pick a Display Profile (shown only if you have multiple profiles; auto-selected if 1)
   └─► Tap "Approve TV / Tablet"

3. TV / Old Tablet (within ~3 seconds)
   └─► Atomically claims a 30-day Frame Display session for YOUR private workspace
   └─► Launches straight into the slideshow — zero typing on the TV
```

- **Manual Sign-In Fallback:** Prefer typing a username and password? Every Admin can optionally create a shared **Frame Display Login** inside **Pair & Access** and use the **Sign In** tab on any device.
- **One-Tap Remote Sign-Out:** Tap **Sign Out All Paired Screens** in **Pair & Access** anytime to immediately disconnect every paired TV and tablet in your workspace.

---

## System Design

### High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENTS                                    │
│                                                                            │
│   TV / Legacy Android Tablet (Chrome 25+) │  Phone / Modern Desktop        │
│   • Pure ES5 + CSS2.1/CSS3 UI             │  • Admin Dashboard & Uploader  │
│   • Default QR / 6-Char PIN Pairing       │  • QR Scan / PIN Approval      │
│   • XHR polling (2-min gentle sync)       │  • Client-side Canvas resizer  │
│   • Layer 2 Keep-Awake (<video>)          │  • Layer 1 Wake Lock API       │
└───────────────────┬───────────────────────┴────────────────┬───────────────┘
                    │ HTTPS (HttpOnly Cookie / Bearer)       │
                    ▼                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   EXPRESS + TYPESCRIPT SERVER (server.ts)                  │
│                                                                            │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ Auth & Pairing Gate │  │ Workspace & API Gate│  │ Signed Media Gate  │  │
│  │ • scrypt + salt     │  │ • Multi-tenant IDs  │  │ • 12h HMAC URLs    │  │
│  │ • HMAC-SHA256 cookie│  │ • 100-photo quota   │  │ • Workspace-bound  │  │
│  │ • QR PNG + 6-char   │  │ • Profile filtering │  │ • Direct R2 302 OR │  │
│  │   single-use pairing│  │ • CRUD for slides,  │  │   legacy SSL proxy │  │
│  │ • Rate limits & CSRF│  │   profiles, settings│  │ • ETag asset cache │  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └─────────┬──────────┘  │
└─────────────┼────────────────────────┼───────────────────────┼─────────────┘
              │                        │                       │
              ▼                        ▼                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         STORAGE & PERSISTENCE                              │
│                                                                            │
│   Cloudflare R2 (Production / Cloud Run)     Local Disk (Dev Fallback)     │
│   • hearthframe/accounts.json                • data/accounts.json          │
│   • hearthframe/store.json (Owner)           • data/store.json (Owner)     │
│   • hearthframe/slides/* (Owner)             • data/uploads/* (Owner)      │
│   • hearthframe/workspaces/<wid>/store.json  • data/workspaces/<wid>/...   │
│   • hearthframe/workspaces/<wid>/slides/*    • Bundled starter gallery     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1. Authentication, Stateless Sessions & Instant Revocation

To survive serverless and container restarts (such as Cloud Run scale-to-zero) without running a separate session database, HearthFrame uses **stateless HMAC-SHA256 signed tokens** combined with **persisted per-workspace role session versions**:

```text
Login or Pairing Claim
  └─► Verify credentials (scrypt + timing-safe comparison) or approved single-use pairing
  └─► Sign payload { wid, r: role, u: username, v: sessionVersion, o: isOwner, exp }
  └─► Set HttpOnly cookie `hf_session`:
        • Frame Display (visitor): Max-Age = 30 days
        • Admin:                   Browser-session cookie (expires on close, 12h server cap)
  └─► Return token in JSON as an in-memory Bearer fallback (for iframe/strict cookie contexts)
```

- **Auto-Resume on Load**: `GET /api/auth/status` returns live limits, setup/signup state, and the active `session` with `Cache-Control: no-store`. Signed-in Frame Display screens check their non-sensitive per-workspace browser preference (`hf_last_profile_<wid>`) and resume straight into that profile's slideshow.
- **Instant Revocation**:
  - **Sign Out** clears `hf_session` (`Max-Age=0`) and revokes the token.
  - **Password Change** or **Sign Out All Paired Screens** rotates `sessionVersions[role]` in the workspace store and `accounts.json`, immediately invalidating all previously issued cookies and signed media URLs for that role.

### 2. Authenticated Media Delivery & Slow-Network Pipeline

Images are never exposed as permanent public bucket URLs while still benefiting from native browser image caching:

1. **Client-Side Optimization**: The Admin browser downscales each image on an HTML5 `<canvas>` according to the configured **Photo Upload Quality** (`low` 800px, `balanced` 1280px, `high` 1600px) and generates a 420px thumbnail before uploading.
2. **Workspace-Bound Signed URLs**: `GET /api/slides` returns short-lived (12-hour) HMAC-signed `/api/media/:id?kind=display|thumb&wid=...&exp=...&sig=...` URLs so standard `<img>` tags on legacy browsers load and cache photos natively without custom headers.
3. **Per-Profile Photo Loading Mode**:
   - **Fast Direct Loading (`direct`)** — `/api/media/:id` validates the HMAC signature and redirects (`302`) to a short-lived Cloudflare R2 presigned URL. Zero server bandwidth egress; ideal for modern tablets, phones, and TVs.
   - **Compatibility Mode (`proxy`)** — `/api/media/:id` streams the object through the Express server with `Cache-Control: private, max-age=3600, immutable`. Useful for very old Android 4.4 tablets whose SSL/TLS stacks cannot negotiate directly with R2 edge certificates.

### 3. Multi-Screen Display Profiles Data Model

Each workspace's metadata lives in its own isolated JSON document (`hearthframe/store.json` for the Owner, `hearthframe/workspaces/<wid>/store.json` for friend workspaces):

```json
{
  "version": 2,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "credentials": { "admin": { "...": "scrypt hash" }, "visitor": null },
  "sessionVersions": { "admin": "v1", "visitor": "v1" },
  "settings": {
    "frameTitle": "Family Photo Frame",
    "bandwidthMode": "balanced"
  },
  "profiles": [
    {
      "id": "profile-tablet-default",
      "name": "Android Tablet",
      "deviceType": "Android Tablet",
      "settings": {
        "intervalSeconds": 8,
        "autoRotate": true,
        "transition": "fade",
        "fitMode": "contain",
        "showCaption": true,
        "showClock": true,
        "r2DeliveryMode": "direct"
      }
    }
  ],
  "slides": [
    {
      "id": "slide_abc123",
      "title": "Summer Hike",
      "caption": "Morning trail view",
      "enabled": true,
      "order": 0,
      "profileIds": ["profile-tablet-default"]
    }
  ]
}
```

### 4. Two-Layer Keep Screen Awake

```text
Slideshow Active & Keep Awake = ON
  ├─► Layer 1 (Modern Browsers): navigator.wakeLock.request('screen')
  │     • Automatically re-acquired on `visibilitychange` when returning to the tab
  └─► Layer 2 (Legacy Android Fallback): Hidden 1×1 muted looping <video>
        • Serves tiny pre-encoded `/keepawake.mp4` (1.6 KB) / `/keepawake.webm` (817 B)
        • Supports HTTP `206 Partial Content` Range requests
        • Starts immediately on first user tap (Fullscreen / Play / Next) if autoplay is gated
```

### 5. Legacy Browser Engineering Constraints

- **`public/app.js`**: Strict ES5 inside an IIFE (`var`, `function`, `XMLHttpRequest`, safe DOM node builders). No `const`/`let`, arrow functions, template literals, `fetch`, `Promise`, or `async/await`.
- **`public/styles.css`**: Classic CSS2.1/CSS3 with `-webkit-` prefixes, float/table layouts, `44px+` touch targets, and zero CSS Grid, flexbox `gap`, or `oklch`.
- **Smart Asset Caching**: `index.html` automatically appends file-modification version query strings (`?v=<mtime>`) to `/styles.css` and `/app.js`, paired with `ETag` / `304 Not Modified` revalidation and gzip compression so updates appear instantly while staying fast on slow Wi-Fi.
- **Gentle Background Sync**: Active slideshow screens check for newly uploaded photos or settings updates once every **2 minutes** to avoid draining tablet batteries or burning serverless request quotas.

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**

### Local Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` if you want fixed Owner credentials, a persistent `SESSION_SECRET`, Cloudflare R2 storage, an invite code, or a custom account cap. For quick local testing, leaving `.env` mostly blank works out of the box — open the app and use the built-in **First-Time Household Setup** form on the home page.

3. **Start the development server**

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

### Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express + TypeScript server on port `3000` (`tsx server.ts`). |
| `npm run build` | Compiles production bundle via Vite (`vite build`). |
| `npm run lint` | Runs strict TypeScript type-checking (`tsc --noEmit`). |
| `npm start` | Runs the production server (`node server.ts`). |

---

## Environment Variables

Configure these in `.env` (local) or your hosting provider's secret manager (e.g., Google Cloud Run):

| Variable | Required | Description |
| :--- | :---: | :--- |
| `PORT` | No | HTTP port (defaults to `3000`). |
| `SESSION_SECRET` | Recommended | 32+ character random hex string used to sign `hf_session` cookies and media URLs. **Set this in production** so paired TVs and tablets stay signed in across server restarts. |
| `ADMIN_USERNAME` | No | Fixed Owner Admin username (overrides UI-stored username if password is also set). |
| `ADMIN_PASSWORD` | No | Fixed Owner Admin password. When set, locks Owner Admin credentials to env secrets. |
| `VISITOR_USERNAME` | No | Fixed Owner Frame Display username. |
| `VISITOR_PASSWORD` | No | Fixed Owner Frame Display password. |
| `R2_ACCOUNT_ID` | For R2 | Cloudflare Account ID. |
| `R2_ACCESS_KEY_ID` | For R2 | Cloudflare R2 API token Access Key ID (Object Read & Write). |
| `R2_SECRET_ACCESS_KEY` | For R2 | Cloudflare R2 API token Secret Access Key. |
| `R2_BUCKET_NAME` | For R2 | Target Cloudflare R2 bucket name. |
| `SIGNUP_INVITE_CODE` | No | Optional invite code required to register a new Admin account. Leave blank for open signup. |
| `MAX_ACCOUNTS` | No | Maximum total workspaces allowed on this server (defaults to `20`). |

Generate a strong `SESSION_SECRET` locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Note:** You never need to memorize or type `SESSION_SECRET` anywhere in the UI — it is read once by the server at startup to sign and verify session cookies.

---

## Cloudflare R2 Setup (Recommended for Production)

When deploying to ephemeral environments (such as Google Cloud Run), configure Cloudflare R2 so uploaded photos, thumbnails, Display Profiles, and workspaces persist across deployments and container restarts:

1. Create a private R2 bucket in the Cloudflare dashboard (no public bucket access required).
2. Create an R2 API Token with **Object Read & Write** permission scoped to that bucket.
3. Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `SESSION_SECRET` to your deployment environment.
4. Verify the connection anytime inside **Admin Dashboard → Settings → Test R2 Connection** (Owner only).
5. For older Android 4.4 tablets that fail to load direct R2 images due to outdated TLS root certificates, set that tablet's Display Profile **Photo Loading Mode** to **Compatibility Mode**.

---

## API Reference

### Authentication & Registration

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/status` | Public | Returns setup/signup status, live account/photo limits, frame title, and active `session`. |
| `POST` | `/api/auth/setup` | Public (first-run only) | Initializes primary Owner Admin and Frame Display credentials once. |
| `POST` | `/api/auth/register` | Public (rate-limited) | Creates a new isolated Admin workspace (100-photo limit, requires `acceptedTerms: true`). |
| `POST` | `/api/auth/login` | Public (rate-limited) | Authenticates `admin` or `visitor` (Frame Display) across workspaces and sets `hf_session`. |
| `POST` | `/api/auth/logout` | Any | Revokes active session token and clears `hf_session` cookie. |
| `GET` | `/api/auth/me` | Authenticated | Returns current authenticated role, username, workspace ID, and owner flag. |

### TV & Tablet Device Pairing (QR / 6-Char PIN)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/pair/start` | Public (rate-limited) | Generates a 5-minute single-use 6-character PIN and private 256-bit `pollToken`. |
| `GET` | `/api/auth/pair/qr?t=...` | Poll Token | Renders and streams a private PNG QR code pointing to `/?pair=<CODE>`. |
| `GET` | `/api/auth/pair/status?t=...` | Poll Token | Polls pairing status; once approved, atomically issues a 30-day Frame Display session. |
| `POST` | `/api/admin/pair/approve` | Admin | Approves a 6-character PIN for the Admin's workspace and optional target Display Profile. |
| `POST` | `/api/admin/pair/revoke-all` | Admin | Rotates the workspace's Frame Display session version, signing out all paired screens. |

### Slideshow & Media

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/slides` | Authenticated | Returns workspace profiles, active profile settings, and signed slide URLs (`?profileId=...`). |
| `GET` | `/api/media/:id` | Signed HMAC URL | Serves workspace-scoped display image or thumbnail via R2 redirect or legacy SSL proxy. |

### Admin & Owner Management

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/slides` | Admin | Uploads a new photo + thumbnail (enforcing the 100-photo limit for non-owner accounts). |
| `PUT` | `/api/admin/slides/:id` | Admin | Updates slide title, caption, enabled state, or Display Profile assignments. |
| `POST` | `/api/admin/slides/reorder` | Admin | Reorders slides in the photo library. |
| `DELETE` | `/api/admin/slides/:id` | Admin | Deletes a slide and removes its image files from R2/disk. |
| `POST` | `/api/admin/profiles` | Admin | Creates a new Display Profile. |
| `PUT` | `/api/admin/profiles/:id` | Admin | Updates a Display Profile's name, device type, or playback/loading settings. |
| `DELETE` | `/api/admin/profiles/:id` | Admin | Deletes a Display Profile (at least one profile is always retained). |
| `PUT` | `/api/admin/settings` | Admin | Updates workspace-wide Frame Name and Photo Upload Quality. |
| `GET` | `/api/admin/access-info` | Admin | Returns current non-sensitive credential configuration metadata. |
| `PUT` | `/api/admin/credentials` | Admin | Creates/updates Admin or Frame Display credentials and rotates `sessionVersions[role]`. |
| `POST` | `/api/admin/r2/test` | Owner Admin | Tests read/write connectivity to the configured Cloudflare R2 bucket. |
| `GET` | `/api/owner/accounts` | Owner Admin | Lists registered workspaces (metadata & photo counts only; never exposes private photos). |
| `DELETE` | `/api/owner/accounts/:id` | Owner Admin | Deletes a friend workspace, cleans up its R2/local photos, and revokes its sessions. |

---

## Project Structure

```text
├── server.ts               # Express server, auth/HMAC sessions, QR pairing, R2 & local store sync
├── r2Client.ts             # Zero-dependency Cloudflare R2 (S3 SigV4) client & presigned URL signer
├── index.html              # Lightweight entry shell loading Playfair Display & legacy-safe assets
├── public/
│   ├── app.js              # Pure ES5 client (Portal, QR Pairing, Slideshow, Admin, Keep-Awake)
│   ├── styles.css          # Legacy-compatible CSS2.1/CSS3 stylesheet (Chrome 25+ / Android 4.4+)
│   ├── keepawake.mp4       # Tiny silent looping video for Layer 2 Keep Screen Awake
│   ├── keepawake.webm      # WebM fallback for Layer 2 Keep Screen Awake
│   └── favicon.ico         # App icon
├── src/assets/images/      # Starter gallery images bundled for fresh installs
├── TERMS.md                # Account Guidelines & Terms of Service (20-account cap, 100-photo limit)
├── .env.example            # Environment variable template (no secrets)
├── .gitignore              # Excludes .env, data/, node_modules/, dist/, and key files
└── package.json            # Dependencies and scripts
```

---

## Account Guidelines & Terms of Service

Usage boundaries for shared multi-user deployments — including the **20-account total server cap**, **100-photo per-account limit**, **3 signups/hour per-IP fair-use rate limit**, workspace privacy guarantees, and backup guidance — are documented in **[TERMS.md](./TERMS.md)** and presented directly on the in-app **Create Account** registration form with server-enforced confirmation.

---

## Security Practices

- **Password Storage**: Per-user random salt + Node.js `crypto.scryptSync` with constant-time `crypto.timingSafeEqual` verification.
- **Workspace Isolation**: Every photo, Display Profile, signed media URL, and session token is strictly scoped to its owning `workspaceId`; accounts can never read or mutate each other's data.
- **Safe Device Pairing**: Pairing separates the 6-character display code from a private 256-bit `pollToken`, expires after 5 minutes, is strictly single-use, generates QR PNGs locally on the server (never via third-party APIs), and can only ever grant **Frame Display** (`visitor`) access after explicit Admin approval.
- **Abuse & CSRF Protection**: Per-IP rate limiting on logins, signups (3/hr), pairing starts, and pairing approvals; same-origin / `X-Requested-With` verification on cookie-authenticated mutations.
- **Cookie & Header Hardening**: Auth tokens live in `HttpOnly` signed cookies (never `localStorage`), with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on sensitive endpoints.

---

## Upcoming Features

Planned improvements for future releases:

- [ ] **Shuffle Order** — Optional per-Display-Profile shuffle toggle to randomize photo order automatically so wall-mounted frames feel fresh every day instead of repeating the same sequence.
- [ ] **Quiet / Night Dimming Schedule** — Configurable bedtime window per Display Profile (e.g., `11:00 PM – 7:00 AM`) that automatically dims or darkens the screen overnight for bedroom tablets and living room TVs.
- [ ] **Multi-Select Delete & Bulk Profile Assignment** — Multi-select checkboxes in **Admin → Photos** for quick batch cleanup and assigning multiple existing photos to Display Profiles at once.
