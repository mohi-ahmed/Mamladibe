# Production deployment wiring

The browser-facing frontend origin owns `/api/v1/*`. The frontend server proxies that namespace
to the backend origin, preserving `Origin`, cookies, status codes, JSON bodies and `Set-Cookie`.

## Frontend environment

Set on the frontend Vercel project for Production (and Preview when desired):

```text
MAMLADIBE_API_ORIGIN=https://<backend-project>.vercel.app
VITE_TURNSTILE_SITE_KEY=<public-site-key>
```

Do not set `VITE_API_BASE_URL` in production. It is only for direct local-development calls.
`MAMLADIBE_API_ORIGIN` is server-only and must be an HTTPS origin without `/api/v1`.

## Backend environment

Set on the backend Vercel project:

```text
NODE_ENV=production
DB_NAME=mamladibe
MONGODB_URI=<atlas-uri>
ALLOWED_ORIGINS=https://<frontend-project>.vercel.app
ACTOR_HMAC_SECRET=<32+ byte secret>
IP_HMAC_SECRET=<different 32+ byte secret>
SESSION_SECRET=<32+ byte secret>
TOTP_ENC_KEY=<32-byte key material>
UPSTASH_REDIS_REST_URL=<https-url>
UPSTASH_REDIS_REST_TOKEN=<token>
TURNSTILE_SITE_KEY=<public-site-key>
TURNSTILE_SECRET=<secret-key>
```

Add every browser-facing custom domain to `ALLOWED_ORIGINS`, comma-separated and without paths.
Do not add the backend origin: the browser sends the frontend origin through the proxy.

After changing environment variables, redeploy both projects. Initialize MongoDB indexes once via
`npm run build` followed by `node dist/scripts/init-db.js`, or run the TypeScript script from a
trusted environment with the same production database variables.

## Live smoke test

Run from `backend/` with the frontend production origin and real service credentials:

```text
SMOKE_BASE_URL=https://<frontend-project>.vercel.app
UPSTASH_REDIS_REST_URL=<https-url>
UPSTASH_REDIS_REST_TOKEN=<token>
TURNSTILE_SECRET=<secret-key>
npm run smoke:production
```

The script verifies:

1. frontend same-origin proxy and backend health;
2. live MongoDB connectivity;
3. public Turnstile site-key exposure;
4. Upstash Redis `PING`;
5. Cloudflare siteverify connectivity and secret validity using an intentionally invalid token.

The smoke script never prints secret values and performs no application data writes.
