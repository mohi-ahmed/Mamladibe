# Mamladibe Backend

REST API backend for **Mamladibe** — an anonymous, Bengali-first road incident reporting, map feed, community verification, and moderation platform for Bangladesh.

## Stack

- **Runtime & Framework:** Node.js 22+, Express 5, TypeScript (ESM, `"type": "module"`)
- **Database:** MongoDB Atlas via Mongoose (`autoIndex: false` in runtime; secondary indexes managed explicitly)
- **Rate Limiting & Anti-Abuse:** Upstash Redis (`@upstash/redis`, `@upstash/ratelimit`) + Cloudflare Turnstile verification
- **Validation & Security:** Zod, Helmet, CORS + strict `Origin` middleware, HMAC-SHA256 actor/IP hashing, Argon2id, `otplib` (TOTP 2FA)
- **Testing:** Vitest (unit + API integration suites)

## Requirements

- Node.js 22+ and npm
- MongoDB Atlas database (`mamladibe` in production, `mamladibe_dev` in local development)
- Upstash Redis REST endpoint and token
- Cloudflare Turnstile site key and secret

## Local Setup

1. Install dependencies from `backend/`:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and populate your credentials (never commit `.env` or `.env.local`):
   ```bash
   cp .env.example .env
   ```
3. Optionally create `.env.local` for local development overrides (automatically loaded only when `NODE_ENV=development` and never used in `test` or `production`).
4. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables (Names Only)

Never commit real credentials. See [.env.example](.env.example) for local defaults.

- **Core & Database:** `NODE_ENV`, `PORT`, `DB_NAME`, `MONGODB_URI`, `LOG_LEVEL`
- **CORS & Origin:** `ALLOWED_ORIGINS` (comma-separated non-local `https://` origins required in production; no wildcards)
- **Cryptographic Secrets (`>= 32` bytes in production):** `ACTOR_HMAC_SECRET`, `IP_HMAC_SECRET` (must differ from `ACTOR_HMAC_SECRET`), `SESSION_SECRET`, `TOTP_ENC_KEY`
- **Rate Limiting & CAPTCHA:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TURNSTILE_SITE_KEY` (or `VITE_TURNSTILE_SITE_KEY`), `TURNSTILE_SECRET` (non-dummy keys enforced in production)
- **Admin & Optional Integrations:** `ADMIN_BOOTSTRAP_EMAIL`, `BARIKOI_API_KEY`, `SENTRY_DSN`

## Commands

Run from `backend/`:

- `npm run dev` — start local server with watch mode (`tsx watch src/server.ts`)
- `npm run typecheck` — run strict TypeScript typechecking (`tsc --noEmit`)
- `npm run build` — compile TypeScript ESM output into `dist/`
- `npm start` — run compiled server (`node dist/server.js`)
- `npm test` — run unit tests (`vitest run tests/unit`)
- `npx vitest run` — run full unit and integration test suite
- `npx tsx src/scripts/init-db.ts` — verify/create declared MongoDB secondary indexes (supports `--dry-run`)
- `npx tsx src/scripts/create-super-admin.ts` — interactive CLI bootstrap for initial Super Admin

## API Routes & Documentation

All routes are mounted under `/api/v1`:

- **Health & Meta:** `GET /api/v1/health`, `GET /api/v1/meta`, `GET /api/v1/me/quota`
- **Geocoding:** `GET /api/v1/geo/reverse`, `GET /api/v1/geo/search`
- **Incidents:** `GET /api/v1/incidents`, `POST /api/v1/incidents`, `GET /api/v1/incidents/:trackingId`, `PATCH /api/v1/incidents/:trackingId`
- **Engagement & Comments:** `POST/DELETE /api/v1/incidents/:trackingId/vote`, `POST /api/v1/incidents/:trackingId/reports`, `GET/POST /api/v1/incidents/:trackingId/comments`, `DELETE /api/v1/comments/:id`, `POST /api/v1/comments/:id/reports`
- **Anonymous Tracking:** `POST /api/v1/track`
- **Admin Moderation & Governance:** `/api/v1/admin/*` (`auth/login`, `auth/verify-2fa`, `auth/me`, `auth/logout`, incidents, comments, reports, actors, audit logs, settings, admin users)

Reference specifications live in `docs/`:

- [docs/PRD.md](docs/PRD.md) — product, API, privacy, and security specification
- [docs/Architecture.md](docs/Architecture.md) — system architecture and Vercel topology
- [docs/Database.md](docs/Database.md) — MongoDB collections, indexes, and TTL policies
- [docs/Design.md](docs/Design.md) — technical design notes

## Vercel Deployment Structure

- **`vercel.json`:** Runs `npm run build`, writes an empty-directory-satisfying `public/robots.txt` (`Disallow: /`), and rewrites all requests (`/(.*)`) to `/api`.
- **`api/index.ts` & `src/vercel.ts`:** Serverless entry point exporting the configured Express app without calling `app.listen()`.
- **`.vercelignore`:** Excludes `.env*`, `node_modules/`, `dist/`, `tests/`, `docs/`, and scratch artifacts from deployment uploads.
- **`package.json` (`"type": "module"`):** Required so Node/Vercel load ESM dependencies (`otplib` / `@scure/base`) cleanly.

## MongoDB Atlas & Redis Requirements

- **MongoDB Atlas:** Serverless deployments require Vercel egress IPs to be permitted in **Atlas -> Security -> Network Access** (`0.0.0.0/0` for dynamic Vercel Hobby IPs) and pre-initialized indexes via `src/scripts/init-db.ts` (`autoIndex: false` at runtime).
- **Upstash Redis:** Required in production for rate limiting, 24h actor quotas, incident duplicate locking, and failed-tracking/login lockouts.

## Security Precautions

- Never commit `.env`, `.env.local`, database dumps, or raw credentials.
- Production startup fails closed on weak/missing secrets, Cloudflare dummy Turnstile test keys, non-HTTPS Upstash URLs, or missing/wildcard/localhost `ALLOWED_ORIGINS`.
- Browser state relies on `httpOnly`, `secure` cookies (`mdb_actor` with `sameSite: 'lax'`, `mdb_admin` with `sameSite: 'strict'`) plus `x-csrf-token` on active admin mutations and exact `Origin` validation on all state-changing requests.
