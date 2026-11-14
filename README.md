# Mamladibe

An anonymous, location-based platform for reporting road incidents, exploring nearby incidents,
sharing public awareness, and expressing community opinions across Bangladesh.

## Repository layout

- `backend/` — Express, TypeScript, MongoDB, Redis, Turnstile and the protected admin API.
- `frontend/` — TanStack Start public site and admin console. The admin UI is available at `/admin`.

## Run locally

Use two terminals. Create each local `.env` from its `.env.example` first; never commit real
credentials.

```powershell
# Terminal 1
cd backend
npm.cmd ci
npm.cmd run dev
```

```powershell
# Terminal 2
cd frontend
npm.cmd ci
npm.cmd run dev -- --host 0.0.0.0 --port 8080
```

Then open `http://localhost:8080` or `http://localhost:8080/admin`.

## Verification

```powershell
cd backend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

cd ..\frontend
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## Vercel deployment

Create two Vercel projects from this repository:

1. Backend project: Root Directory `backend`.
2. Frontend project: Root Directory `frontend`.

The browser calls same-origin `/api/v1`. The frontend server proxies those requests to the backend,
so production must set `MAMLADIBE_API_ORIGIN` on the frontend project and must not set
`VITE_API_BASE_URL` there. Configure the frontend production URL in the backend project's
`ALLOWED_ORIGINS`.

Required production variables and the live smoke-test procedure are documented in
[`backend/docs/Deployment.md`](backend/docs/Deployment.md). The API contract is available as
[`backend/docs/openapi.yaml`](backend/docs/openapi.yaml).
