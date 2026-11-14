# Mamladibe API Contract

Version: 1.1
Base path: `/api/v1`
Implementation authority: `backend/src/routes`, validators and services
Machine-readable contract: [`../backend/docs/openapi.yaml`](../backend/docs/openapi.yaml)

This document describes the contract consumed by the public frontend and the future admin
frontend. It supersedes the earlier page-based `/api` draft.

## Transport and authentication

- Requests and responses use JSON, except empty responses.
- Browser requests use `credentials: include`.
- Public writes receive/use the HttpOnly `mdb_actor` cookie.
- Admin login creates the HttpOnly `mdb_admin` cookie.
- All state-changing requests require an allowed `Origin`.
- Active admin mutations also require `x-csrf-token`, obtained from 2FA verification or
  `GET /admin/auth/me`.
- Production should expose `/api/v1/*` through the frontend origin so cookies remain first-party.

Errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {},
    "requestId": "request-id"
  }
}
```

## Canonical enums

```ts
type Category =
  | "road_accident"
  | "traffic_violation"
  | "police_misconduct"
  | "infrastructure"
  | "public_safety"
  | "other";

type CommentType = "info" | "correction" | "experience";
type VoteType = "support" | "dispute";
type ContentStatus = "published" | "hidden" | "deleted";
type AdminRole = "moderator" | "super";
```

Report reasons are `spam`, `fake`, `misleading`, `inappropriate`, and `irrelevant` for both
incident and comment report endpoints.

## Public incident DTO

```ts
interface PublicIncident {
  trackingId: string;
  title: string;
  description: string;
  excerpt?: string; // list responses
  category: Category;
  incidentAt: string;
  createdAt: string;
  location: { lat: number; lng: number };
  roadName: string | null;
  areaName: string | null;
  upazila: string | null;
  district: string | null;
  safetyTip: string | null;
  isEdited: boolean;
  editedAt: string | null;
  moderatedEdit: boolean;
  source: "public" | "team";
  counts: { support: number; dispute: number; flags: number; comments: number };
  my: { vote: VoteType | null; flagged: boolean };
  distanceKm?: number;
}
```

List responses contain the complete fields needed by current cards and maps. `my` is neutral in
list responses; authoritative viewer state is returned by the detail endpoint.

## Pagination and search

`GET /incidents` accepts:

- `q`, `category` (comma-separated values accepted), `from`, `to`, `district`
- `sort=newest|oldest|nearest`
- `limit`, `cursor`
- `bbox=west,south,east,north` for map viewports
- `near=lat,lng&radiusKm=N` for nearby search

Response:

```json
{ "items": [], "nextCursor": null, "truncated": false }
```

Normal feeds have a maximum page size of 20. Map queries may return up to 500. Nearest queries
may return up to 100. Comments also use `limit` and `cursor`.

## Public endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Service/database readiness |
| GET | `/meta` | Enums, limits, server time and Turnstile site key |
| GET | `/me/quota` | Current actor comment quota |
| GET | `/geo/reverse?lat=&lng=` | Flat location result; may return `{fallback:true}` |
| GET | `/geo/search?q=` | Bangladesh place search |
| GET | `/incidents` | Cursor feed/search/map query |
| POST | `/incidents` | Create; coordinates are under `location` |
| GET | `/incidents/:trackingId` | Returns `PublicIncident` directly |
| PATCH | `/incidents/:trackingId` | Reporter quick edit; secret is in JSON body |
| POST/DELETE | `/incidents/:trackingId/vote` | Set/switch or remove vote |
| POST | `/incidents/:trackingId/reports` | Report incident |
| GET/POST | `/incidents/:trackingId/comments` | Cursor list/create comment |
| DELETE | `/comments/:id` | Delete own eligible comment |
| POST | `/comments/:id/reports` | Report comment |
| POST | `/track` | Private tracking and edit eligibility |

Create incident request:

```json
{
  "title": "Large pothole beside the bus stop",
  "description": "The pothole occupies most of the left lane.",
  "category": "infrastructure",
  "incidentAt": "2026-11-11T14:30:00.000Z",
  "location": { "lat": 23.7808, "lng": 90.4093 },
  "roadName": "Airport Road",
  "areaName": "Banani",
  "captchaToken": "turnstile-token"
}
```

Comment create uses `{ "type": "info", "body": "...", "captchaToken": "..." }`.
Comment list/create DTOs use `body`, not `text`.

Tracking versions use `editedAt`. Edit eligibility is:

```ts
{ allowed: boolean; remainingSeconds: number; editsLeft: number }
```

## Admin endpoints

Authentication is two-stage:

1. `POST /admin/auth/login` with email/password.
2. `POST /admin/auth/verify-2fa` with a six-digit code.
3. Use the returned CSRF token on admin mutations.

Protected endpoint groups:

- `/admin/auth/me`, `/admin/auth/logout`, `/admin/dashboard`
- `/admin/incidents` and incident moderation actions
- `/admin/comments` and comment moderation actions
- `/admin/reports` and `/admin/reports/:id/resolve`
- `/admin/actors` including notes/restrict/unrestrict
- `/admin/audit`
- Super only: `/admin/users`, 2FA reset, and `/admin/settings`

Admin list endpoints use `{items,nextCursor}` and `limit/cursor`; they do not use page numbers.

## Frontend adapter rules

The UI model flattens `location`, `counts`, and `my` only after receiving an API response. Network
requests and tests must continue to use the canonical backend DTO. Reporter secrets and admin
session material must never be persisted in local or session storage.

Any change to paths, enums, request fields, response fields, pagination, cookie/CSRF behavior, or
error envelopes requires synchronized updates to:

1. backend validator/service tests;
2. frontend API contract tests;
3. this document and `backend/docs/openapi.yaml`.
