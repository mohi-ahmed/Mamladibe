# Mamladibe Frontend

Mamladibe is a Bengali-first community road-incident reporting interface for Bangladesh. This repository contains the deployable frontend experience, including the home feed, live map, searchable incident list, reporting flow, public incident pages, voting, comments, flagging, and anonymous report tracking.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- TanStack Start and TanStack Router
- Leaflet
- Radix UI primitives

## Local development

```bash
npm install
npm run dev
```

The development server prints the local URL in the terminal.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Deploy to Vercel

1. Push this directory to a Git repository.
2. Import the repository in Vercel.
3. Keep the framework preset as `Other`.
4. Vercel will use the included `vercel.json` configuration.
5. Deploy.

`npm run build` generates a Vercel Build Output API bundle in `.vercel/output`.

## API integration

The frontend uses the backend's `/api/v1` contract for incidents, map/search, reporting,
votes, comments, geocoding, tracking, and quick edits. Copy `.env.example` to `.env.local`
for local development. Production should proxy `/api/v1/*` through the frontend origin so
the anonymous and future admin HttpOnly cookies remain first-party.

The canonical transport contract is documented in `API_CONTRACT.md`; the machine-readable
OpenAPI description lives at `../backend/docs/openapi.yaml`.
