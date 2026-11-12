# Mamladibe — PRD.md

**Version:** 1.0 (Final baseline) · **Date:** 9 November 2026 · **Owner:** Team Epsilon
**Audience:** human developers and AI coding agents (Claude Code, Cursor, Copilot, etc.)
**Companion document:** `Mamladibe_PRD_v1.0_Final.pdf` (same scope, formatted for humans). If the two ever differ, **this file is the source of truth for implementation**.

---

## 0. How to read this file (AI agents: read this first)

1. Read sections **1 to 5 completely** (ROLE, CONTEXT, TASK, RULES, OUTPUT) before writing any code. They tell you who you are, what the product is, what to build, what you must never do, and how to report.
2. Sections **6 onward** are the detailed specification (requirements, constants, data model, algorithms, API, admin, frontend, maps, security, infrastructure, tests). Open the section a task card points to; do not guess.
3. **Order of authority when sections conflict:** `4. RULES` > `7. Constants` > `8. Data model` / `10. API` > `6. Requirements` > narrative text.
4. **Never invent** endpoints, fields, features, limits or libraries that are not in this file. If something is missing or unclear, follow the **Ambiguity protocol** in section 4.4.
5. Requirement IDs look like `FR-13.4`. Constants live in section 7 and must be implemented once in `shared/constants.ts` and imported everywhere.

---

## 1. ROLE

You are a **senior full-stack engineer** (TypeScript, React, Node.js/Express, MongoDB, web security) working inside the Mamladibe team of five. You build exactly what this PRD describes: correct, secure, privacy-preserving, accessible, and deployable on free tiers.

### 1.1 Your working principles
- **Correctness and safety over speed.** This product handles sensitive anonymous reports about police misconduct and accidents. Security and privacy defects are release blockers.
- **Smallest correct change.** Implement the task card, nothing extra. No V2 features. No "nice-to-have" additions.
- **Explain what you did.** Every task ends with the report format in section 5.
- **Ask when blocked, do not guess** (section 4.4).

### 1.2 Human team roles (who owns what)
| # | Human role | Owns |
|---|---|---|
| 1 | Tech Lead / DevOps | Repo, CI/CD, deployments, env/secrets, DB setup, backups, reviews |
| 2 | Backend A | Incidents, tracking ID/secret, quick edit + versions, comments + quota, geocoding proxy |
| 3 | Backend B | Votes, flags, search API, rate limiting, CAPTCHA, admin API, auth, audit log |
| 4 | Frontend A | Map home, report form, credentials screen, incident details, comment UI |
| 5 | Frontend B + QA | Admin panel, track/edit pages, search UI, i18n, accessibility, E2E tests |

If a task card says `Owner: Backend A`, you act as that role for that task.

---

## 2. CONTEXT

### 2.1 What Mamladibe is
Mamladibe is an **anonymous, location-based web app for reporting road-related incidents in Bangladesh**. Anyone can post a text report with a map pin without creating an account. Reports are published **immediately**. Other people can view them on a map, **Support** or **Dispute** them, **comment** (add information, corrections, or experiences), and **flag** content that breaks rules. Moderators (separate admin accounts) review flagged content.

**Core flow:** Report → Locate → Discover → Respond → Stay aware.

**Launch area:** all of Bangladesh (nationwide). Default map view: whole country, centred on Dhaka.

### 2.2 Goals
1. Safe anonymous reporting with location.
2. Public awareness through map + search.
3. Community accountability (flags, support/dispute, comments, moderation) **without** the system ever judging truth.

### 2.3 Who uses it
| Role | Account | Can do |
|---|---|---|
| Visitor / Viewer | none (random browser cookie) | View, search, support/dispute, flag, comment (5/day) |
| Reporter | none (holds Tracking ID + secret for own post) | All visitor actions + track and quick-edit own post |
| Moderator | admin account (email + password + TOTP) | Review flags; hide/unhide; redact; soft delete/restore; restrict actors; view activity |
| Super Admin | admin account (email + password + TOTP) | All moderator rights + permanent delete, admin users, settings, full audit log |

**There is no public sign-up or sign-in. Ever.**

### 2.4 Tech stack (fixed — do not substitute)
| Area | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict), React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS, react-i18next (EN + BN) |
| Map | MapLibre GL JS + OpenFreeMap vector tiles (no API key). **Google Maps is NOT used.** |
| Backend | Node.js 20 + Express + TypeScript (strict), Zod, Mongoose, helmet, cors, cookie-parser, pino |
| Database | MongoDB Atlas free M0 (replica set), Mongoose |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`) — **not** in-memory limiters (serverless instances do not share memory) |
| CAPTCHA | Cloudflare Turnstile |
| Admin auth | `@node-rs/argon2` (Argon2id), `otplib` (TOTP) |
| Geocoding | Barikoi (primary, server-side key), Nominatim (low-volume fallback) |
| Errors/logs | pino JSON logs, Sentry free plan |
| Tests | Vitest, Supertest, Testing Library, Playwright, axe |
| Hosting | Vercel Hobby: two projects (`client`, `server`), Express as a serverless function |
| CI | GitHub Actions |

Vercel Hobby is **non-commercial only**. The product is non-commercial in V1.

### 2.5 Repository layout (create exactly this)
```
mamladibe/
  PRD.md
  package.json                (npm workspaces: client, server, shared)
  shared/
    constants.ts              (ALL limits from section 7)
    schemas.ts                (Zod schemas shared by client and server)
    types.ts
  client/                     (Vite React app)
    src/app/ features/ components/ lib/ locales/(en.json, bn.json)
    vercel.json               (rewrites: /api/* -> server project, SPA fallback)
  server/
    src/
      app.ts                  (exports Express app; Vercel entry)
      config/ env.ts
      routes/ controllers/ services/ models/ middleware/
      lib/ crypto.ts geo.ts quota.ts captcha.ts ratelimit.ts text-rules.ts tracking.ts levenshtein.ts
      admin/ (routes, controllers, services for admin area)
    scripts/ create-super-admin.ts
    tests/
  .github/workflows/ci.yml
  README.md
```

### 2.6 Glossary
| Term | Meaning |
|---|---|
| **Actor / actorId** | Pseudonymous ID of one **browser**: `HMAC-SHA256(ACTOR_HMAC_SECRET, rawBrowserToken)` truncated to 128 bits, hex. Identifies a browser, never a person. |
| **Browser token** | 256 random bits stored in cookie `mdb_actor`. Raw token is never stored in DB. |
| **Tracking ID** | Public incident ID, e.g. `MD-7K3Q9XTB`. Used in URLs. Grants **no** private access alone. |
| **Secret** | 128-bit random code shown once to the reporter. Only its SHA-256 hash is stored. |
| **Flag / report** | Complaint about content (reasons: spam, fake, misleading, inappropriate, irrelevant). |
| **Support / Dispute** | A visitor's opinion on an incident. **Not verification.** |
| **Redact** | Remove/replace part of text that breaks a content rule; original kept for audit. |
| **Soft delete** | Hidden from everyone; kept 30 days, then purged. |

---

## 3. TASK

### 3.1 Objective
Build **Mamladibe V1** exactly as specified in this file: a public anonymous reporting web app + a separate admin panel, deployed free on Vercel + MongoDB Atlas, passing all acceptance criteria in section 16.

### 3.2 In scope (V1)
F01 Anonymous Incident Posting · F02 Location-Based Reporting · F03 Interactive Map · F04 Incident Details · F05 Community Reporting (flags) · F06 Support/Dispute · F07 Anonymous Tracking · F08 Search & Filter · F09 Quick Edit (15 min) · F10 Safety Tips · F11 Categorisation · F12 Platform Protections · **F13 Comments (Add Information), max 5/day/actor** · **F14 Admin Panel & Moderation (full CRUD, actor tracking, audit log)** · F15 Legal/Help pages · F16 English + Bangla UI.

### 3.3 Out of scope (do NOT build)
- Public user accounts, profiles, public login.
- Image/video/file upload.
- Reply threads under comments (comments are a **flat** list).
- Reach-based "Community Flagged" label; machine-learning abuse detection.
- "Verified", "Corroborated", "Disputed" statuses or any truth verdict.
- **Automatic** hiding/deleting based on report counts.
- Push notifications, native apps, routing/navigation, dark theme, analytics/ad trackers.
- Google Maps / Google Places / Mapbox.

### 3.4 Build order and task cards
Work in this order. Each card lists spec references (`§` = section in this file) and acceptance checks. A task is **not done** until its acceptance checks pass and the report in section 5 is produced.

**T00 — Foundation** (Owner: Tech Lead) · M0
- Create monorepo (§2.5), npm workspaces, TypeScript strict, ESLint, Prettier, Vitest.
- `shared/constants.ts` with every value from §7 (single source of truth).
- GitHub Actions CI: lint, typecheck, test, build, `npm audit --audit-level=high`.
- Vercel projects `client` and `server`; env vars (§15.2); `client/vercel.json` rewrite `/api/:path*` → server project, then SPA fallback.
- MongoDB Atlas M0 cluster; connection helper with global cache and `maxPoolSize: 5` (§9.7). `GET /api/v1/health` deployed.
- ✅ Accept: "Hello World" client + `/api/v1/health` reachable on one origin in production; CI green.

**T01 — Backend core** (Owner: Backend A) · M0/M1
- `env.ts` (Zod-validated env), error classes and global error handler (§10.2), request-id, helmet + CSP (§14.3), CORS allow-list, body limit 20 KB, `pino`.
- Actor middleware (§9.1), IP-hash helper (§9.2), text normalisation + text rules (§9.5), Zod schemas in `shared/`.
- Mongoose models and **all indexes** (§8).
- ✅ Accept: unit tests for actor/hash/text-rules; indexes created; error envelope matches §10.2.

**T02 — Incidents create/read** (Owner: Backend A) · M1
- `POST /incidents`, `GET /incidents` (bbox, category, pagination), `GET /incidents/:trackingId`, `GET /meta`, `GET /geo/reverse` (§10.3, §13).
- Tracking ID + secret generation (§9.3). Bounds check, incident-time check (§7).
- ✅ Accept: AC-01, AC-02, AC-03.

**T03 — Frontend shell, map, report, details** (Owner: Frontend A) · M1
- App shell, routing, i18n scaffolding, design tokens (§12.5), API client with TanStack Query.
- Map home (F03), 4-step report form (F01/F02/F10/F11) + credentials screen, incident details (F04).
- ✅ Accept: report → appears on map → opens details on a 360 px viewport; credentials screen blocks leaving until checkbox ticked.

**T04 — Votes and flags** (Owner: Backend B + Frontend A) · M2
- `POST/DELETE /incidents/:id/vote`, `POST /incidents/:id/reports` (§10.3). Unique indexes enforce one action per actor.
- UI: Support/Dispute buttons (switch/remove), Flag dialog.
- ✅ Accept: AC-04, AC-05, AC-10.

**T05 — Comments with daily quota** (Owner: Backend A + Frontend A) · M2
- Comment endpoints, atomic quota (§9.4), cooldown, IP soft cap, text rules, self-delete window, comment flags.
- UI: comment form with type selector, "N of 5 left today", disabled state with reset time, list, load more.
- ✅ Accept: AC-06, AC-07, AC-13.

**T06 — Tracking and quick edit** (Owner: Backend A + Frontend B) · M3
- `POST /track`, `PATCH /incidents/:trackingId` with window, edit count, 30% rule, versions, lockout (§9.6).
- UI: Track page, countdown, edit form, version list, "Edited" label.
- ✅ Accept: AC-08, AC-09.

**T07 — Search and filter** (Owner: Backend B + Frontend B) · M4
- Text search, category/date/district filters, sort, `near`, place search `GET /geo/search` (§10.3, §9.8).
- ✅ Accept: Bangla and English queries return results; filters combine; pagination stable.

**T08 — Platform protections** (Owner: Backend B) · M4
- Upstash rate limits per §7, Turnstile verification, risk-based CAPTCHA, duplicate detection, abuse signals with TTL.
- ✅ Accept: rate-limit tests; CAPTCHA required on post; no raw IP in DB.

**T09 — Admin backend** (Owner: Backend B) · M5
- Admin auth (Argon2id, TOTP, sessions, CSRF), RBAC, all admin endpoints (§10.4), audit log (§11.6), actor tracking (§11.3), settings freeze switches. `scripts/create-super-admin.ts`.
- ✅ Accept: AC-11, AC-12; every admin route tested with no session / wrong role / right role.

**T10 — Admin frontend** (Owner: Frontend B) · M5
- Screens in §11.5: login + 2FA, dashboard, incidents, comments, reports queue, actors, admin users, audit log, settings.
- ✅ Accept: complete moderation workflow (flag → review → hide → audit entry) works end to end.

**T11 — Legal pages, i18n completion** (Owner: Frontend B) · M5/M6
- About, How it works, Guidelines, Terms, Privacy, Contact/Takedown (content placeholders clearly marked until lawyer-reviewed); complete `en.json` and `bn.json`; first-visit cookie notice.

**T12 — Hardening and launch** (Owner: Tech Lead + QA) · M6
- Security checklist §14, OWASP ASVS L1 pass, ZAP baseline, axe + keyboard pass, load test, backup export + restore test, README + runbook, launch gate §17.
- ✅ Accept: section 17 fully checked.

---

## 4. RULES

### 4.1 Product rules (never violate)
- **R-P1** No public accounts, names, emails, phone numbers collected from public users.
- **R-P2** A valid report is **public immediately**. No approval queue.
- **R-P3** The system and UI **never** say a report is true, false, verified, confirmed, or debunked. Counts are shown as opinions: "N people support", "N people dispute".
- **R-P4** **No automatic hide/delete/label from counts** (flags, disputes, comments). Only a human moderator action changes visibility, with a written reason.
- **R-P5** Moderators remove content for **rule violations** (threats, personal data, abuse, spam), not because they judge the incident claim false.
- **R-P6** Comments never change Support/Dispute counts and never create any status.
- **R-P7** Only text + location. No file upload anywhere.
- **R-P8** Category, location, and incident time are **locked** in quick edit.

### 4.2 Security and privacy rules (release blockers)
- **R-S1** Never store raw IP addresses, raw browser tokens, raw reporter secrets, raw passwords, or TOTP secrets in plaintext. Never log them. Never put secrets in URLs or query strings.
- **R-S2** Validate **every** request body/query/param with Zod `.strict()` schemas on the server. Unknown fields → `VALIDATION_ERROR`. Never pass raw user objects to Mongo queries (NoSQL-injection rule); only validated primitives.
- **R-S3** Render all user text as **text**. Never use `dangerouslySetInnerHTML`, `innerHTML`, or any HTML rendering of user content (also in admin).
- **R-S4** One-action rules (vote, flag, comment quota) must be enforced by **database unique indexes / atomic operations**, not only by application checks.
- **R-S5** Compare secrets and hashes in **constant time** (`crypto.timingSafeEqual`). Use generic error messages for tracking/login failures.
- **R-S6** Admin area: Argon2id passwords, **mandatory** TOTP, HttpOnly + Secure + SameSite=Strict session cookie (store only the session hash), CSRF token + Origin check on state-changing calls, `Cache-Control: no-store`, `noindex`.
- **R-S7** Every admin state change writes an **audit log** entry (who, what, target, reason, before/after summary, time). Audit log is append-only in code (no update/delete paths).
- **R-S8** Admins can **never** see reporter secrets (only hashes exist). Opening an actor profile writes an audit entry (`actor.view`).
- **R-S9** Provider API keys (Barikoi, Upstash, Turnstile secret) exist **only on the server**. Never ship them to the client.
- **R-S10** Never commit `.env` or secrets. Never print secrets in logs, test output, or reports.
- **R-S11** The only client-held secret is the reporter secret during the track/edit flow: keep it **in memory only** (React state), never in localStorage/sessionStorage/URL, and clear it on page leave.
- **R-S12** Do not add analytics, ads, fingerprinting, or third-party trackers.

### 4.3 Engineering rules
- **R-E1** TypeScript `strict: true`. No `any` (use `unknown` + narrowing). No `@ts-ignore` without a comment and a task note.
- **R-E2** All limits/values come from `shared/constants.ts` (section 7). No magic numbers in code.
- **R-E3** Business logic lives in `services/`; controllers only parse/validate/respond; routes only wire.
- **R-E4** Counts (support, dispute, flags, comments) are **computed** from collections (`countDocuments`/aggregation), **not stored** as counters. For lists, use one batched aggregation for the returned page, not N queries.
- **R-E5** Timestamps stored in UTC. The comment quota day is computed in `Asia/Dhaka`.
- **R-E6** Use only the libraries listed in §2.4 plus tiny utilities if essential (justify in the report). **No new heavy dependencies** without asking.
- **R-E7** Frontend text goes through i18n keys (`en.json`, `bn.json`). No hard-coded user-facing strings.
- **R-E8** Accessibility: semantic HTML, labels, focus states, keyboard operation, colour not the only signal, touch targets ≥ 44 px, `prefers-reduced-motion` respected.
- **R-E9** Mobile first: design at 360 px width first.
- **R-E10** Error handling: never leak stack traces or internal messages to clients; log with request id.
- **R-E11** Serverless awareness: no in-memory state across requests (rate limits, sessions, caches that matter); cache the Mongo connection globally; keep cold start light.
- **R-E12** Write tests with the code (section 16). A feature without tests is not done.
- **R-E13** Git: branch per task (`feat/T05-comments`), small PRs, **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), no direct pushes to `main`, one approving review.
- **R-E14** Bangla text: normalise Unicode **NFC**; **never strip U+200C / U+200D** (needed for Bangla conjuncts). Use `default_language: "none"` for the Mongo text index.

### 4.4 Ambiguity protocol (when something is unclear or missing)
1. Search this file for the answer (use the order of authority in section 0).
2. If still unclear and the choice is **low-risk and reversible**, pick the simplest option consistent with section 4, **state the assumption** in your report under "Assumptions".
3. If the choice affects **security, privacy, scope, data model, API shape, or a rule in section 4**, **stop and ask** the human; do not guess.
4. If a task seems to require breaking a rule, **do not break it**; report the conflict.
5. Never expand scope. Ideas for later go under "Suggestions (not implemented)".

### 4.5 Allowed implementation freedom
You may add internal helper fields/indexes needed to implement behaviour described here (e.g. `stage` on `admin_sessions`, `purgeAt` TTL on soft-deleted docs), as long as **public behaviour and API contracts do not change**. List such additions in your report.

---

## 5. OUTPUT

### 5.1 What every task must deliver
1. **Code** in the correct paths (§2.5), type-safe, linted, formatted.
2. **Tests** for the task (unit/API/E2E as relevant) and passing.
3. **Migrations/indexes** needed (Mongoose index definitions in model files; documented in report).
4. **Docs**: update `README.md` only when setup, env, or run steps change.
5. **A task report** in the exact format below.

### 5.2 Required task report format (end of every task)
```markdown
## Task report: <T-ID> <title>
**Status:** Done | Partially done | Blocked

### Summary
<3-6 sentences: what was built and how it follows the PRD>

### Files changed
- path — purpose

### How to run / verify
1. commands
2. what to click/call and expected result

### Acceptance checklist
- [x] AC-xx <criterion> — how verified (test name / manual step)
- [ ] ...

### Rules check
- Confirmed: R-S1 ..., R-P3 ... (list rules relevant to this task and how they are respected)

### Assumptions
- <low-risk assumptions made, each with the reason>

### Deviations / Questions for human
- <anything that needs a decision; "None" if none>

### Suggestions (not implemented)
- <optional>
```

### 5.3 Response style
- Be concise and factual. No marketing language.
- Show only relevant code in chat; write full code to files.
- When you must stop and ask, ask **one clear question** with the options and your recommendation.

### 5.4 Final deliverable of V1
A deployed system meeting section 17 (Launch Gate): public web app, admin panel, free-tier infrastructure, passing CI, documentation (`README.md`, runbook), and a completed acceptance matrix.

---

# REFERENCE SPECIFICATION

## 6. Functional requirements

### F01 Anonymous Incident Posting
- FR-01.1 Visitor submits without registration. Fields: `title`, `description`, `category` (one of six), `incidentAt`, `location`, optional `safetyTip`.
- FR-01.2 Server validation per §7. Phone numbers, emails, URLs in any text field are rejected (message: "Remove personal contact details").
- FR-01.3 Turnstile challenge required on submit.
- FR-01.4 On success: status `published` immediately; response returns Tracking ID + secret **once**.
- FR-01.5 Confirmation screen: show both, **Copy** and **Download (.txt)** buttons, required checkbox "I have saved these" before continuing, plain warning that the secret **cannot be recovered**.
- FR-01.6 Text only.
- FR-01.7 Exact duplicate (same `contentHash` from same actor within 24 h) → `DUPLICATE_ACTION`. A **similar** report (≤ 200 m, same category, last 2 h) shows a non-blocking notice "A similar report exists" (client queries `GET /incidents?near=lat,lng&radiusKm=0.2&category=...&from=<now-2h>`).

### F02 Location
- FR-02.1 Location mandatory: drop a pin, or "Use my location" (browser permission). GPS only centres the map; stored coordinates = the pin.
- FR-02.2 After pin placement call `GET /geo/reverse` **once** to get road, area, upazila, district. Reporter may edit road/area text (≤ 120 chars).
- FR-02.3 Pin must be inside Bangladesh bounds (§7), else reject.
- FR-02.4 Store GeoJSON Point `[lng, lat]` rounded to 5 decimals.

### F03 Interactive map
- FR-03.1 Full-screen MapLibre map; markers coloured by category (§12.5); clustering.
- FR-03.2 Marker → preview card (title, category, time, area, comment count) → link to details.
- FR-03.3 Load only the visible bbox, debounced after move end; max 500 per request; if more: "Zoom in to see more".
- FR-03.4 Category chips filter; "Near me" button; map position/zoom/filters kept in URL query.
- FR-03.5 Default view: Bangladesh, centred on Dhaka.

### F04 Incident details (`/incident/:trackingId`)
- FR-04.1 Show title, description, category, incident time, posted time, location + mini map, counts (support, dispute, flags, comments), comments section.
- FR-04.2 Safety tip in its own block "Reporter-provided safety tip", only if present.
- FR-04.3 "Edited" label with time if reporter-edited; "Edited by moderators" if redacted.
- FR-04.4 Neutral notice: "Community-provided, not verified." Actions: Share (copy link), Support, Dispute, Flag.

### F05 Flags
- FR-05.1 Reasons: `spam | fake | misleading | inappropriate | irrelevant`; optional note ≤ 200 chars.
- FR-05.2 One flag per actor per target (unique index). Repeat → `DUPLICATE_ACTION`.
- FR-05.3 Total flag count displayed on incident. **No** label/hide/delete from counts.
- FR-05.4 Every flag enters the admin queue.

### F06 Support / Dispute
- FR-06.1 One active vote per actor per incident.
- FR-06.2 Switching changes `type`; counts follow automatically (one −1, other +1, total unchanged).
- FR-06.3 Actor can remove vote (`DELETE`).
- FR-06.4 UI never derives a status from counts.

### F07 Tracking
- FR-07.1 Tracking ID format `MD-` + 8 Crockford Base32 chars.
- FR-07.2 Secret: 128 random bits → 26 Crockford Base32 chars shown in groups of five (`XXXXX-XXXXX-XXXXX-XXXXX-X`). Stored as SHA-256 hash only.
- FR-07.3 `/track` page takes Tracking ID + secret. On match show: status (published / hidden / removed + outcome category), counts, version history, edit availability with countdown.
- FR-07.4 Wrong credentials → one generic error. After 5 failures per Tracking ID → lock 15 minutes (`LOCKED`).
- FR-07.5 Lost secret = unrecoverable. State this at creation and on the Track page.

### F08 Search and filter
- FR-08.1 Free text over title, description, road, area, district (Bangla + English).
- FR-08.2 Filters: category (multi), date (Today, 7 days, 30 days, custom), district/area.
- FR-08.3 Sort: `newest` (default), `oldest`, `nearest` (only if location known). 20 per page, cursor-based.
- FR-08.4 Place search (type a place → move map) via `GET /geo/search`.
- FR-08.5 No verification filter exists.

### F09 Quick edit
- FR-09.1 Needs Tracking ID + secret; only within 15 minutes of `createdAt` (server time).
- FR-09.2 Editable: `title`, `description`, `safetyTip`. Locked: category, location, incident time.
- FR-09.3 Per field: `levenshtein(old,new) / max(old.length,1) ≤ 0.30`; max 3 edits in the window.
- FR-09.4 Each edit stores previous version in `incident_versions`; set `isEdited`, `editedAt`, `editCount`.
- FR-09.5 After 15 min the post is permanent (Track page still readable).

### F10 Safety tips / F11 Categories
- FR-10.1 Optional `safetyTip` (≤ 500 chars) inside the report; no separate page.
- FR-11.1 Exactly one of: `road_accident`, `traffic_violation`, `police_misconduct`, `infrastructure`, `public_safety`, `other`. Display names: Road Accident · Traffic Violation · Police Misconduct / Harassment · Road & Infrastructure Issues · Public Safety Concern · Other.
- FR-11.2 Only a moderator may correct a category (with reason).

### F12 Platform protections
- FR-12.1 Strict Zod validation on every endpoint.
- FR-12.2 Rate limits per actor and per hashed IP (§7) in Upstash Redis.
- FR-12.3 Turnstile always on posting; on commenting when risk rises or IP soft cap reached.
- FR-12.4 Duplicate detection; unique indexes; TTL expiry of abuse signals.
- FR-12.5 Security/privacy controls per §14.

### F13 Comments (Add Information)
- FR-13.1 Any visitor can comment on a **published** incident, no account.
- FR-13.2 Type (required): `info` ("Additional information"), `correction` ("Correction / different information"), `experience` ("Personal experience / opinion"). Show as badge + notice "Community comment, not verified".
- FR-13.3 Body 5–500 chars, plain text, ≤ 5 line breaks; links/emails/phone numbers rejected.
- FR-13.4 **Daily limit: 5 comments per actor per calendar day in Asia/Dhaka (reset 00:00).** Enforced atomically (§9.4). 6th attempt → `QUOTA_EXCEEDED` with `resetsAt`. UI shows "N of 5 left today". **Deleted comments still count.**
- FR-13.5 Cooldown 30 s between comments per actor. IP soft cap 30/day per hashed IP → require CAPTCHA (**not** block; many mobile users share IPs).
- FR-13.6 Flat list, newest first, 20 per page. Comment count appears on cards and details.
- FR-13.7 Comments can be flagged (same 5 reasons). Flag counts on comments are **visible to moderators only**.
- FR-13.8 Author (same actor) may delete within 15 minutes. **No editing.**
- FR-13.9 Comments never affect votes/status; no automatic action.
- FR-13.10 Moderator-hidden comment shows placeholder "Removed by moderators". Hidden incident hides its comments.

### F14 Admin panel — see §11. F15 Legal pages — About, How it works, Community Guidelines, Terms, Privacy Notice, Contact/Content Removal Request; footer links on every page; first-visit notice about the single necessary cookie.

### F16 Localisation
- English + Bangla UI with switch (remembered in browser). User content never auto-translated. Dates in Asia/Dhaka; Bangla numerals when Bangla selected.

---

## 7. Constants (put in `shared/constants.ts`, use everywhere)

```ts
export const LIMITS = {
  TITLE: { min: 5, max: 100 },
  DESCRIPTION: { min: 20, max: 2000 },
  SAFETY_TIP_MAX: 500,
  PLACE_TEXT_MAX: 120,
  COMMENT: { min: 5, max: 500, maxLineBreaks: 5 },
  FLAG_NOTE_MAX: 200,
  INCIDENT_MAX_AGE_DAYS: 90,           // incidentAt not future, not older than 90 days
  BOUNDS: { latMin: 20.55, latMax: 26.70, lngMin: 88.00, lngMax: 92.70 },
  COORD_DECIMALS: 5,
} as const;

export const RATE = {
  INCIDENTS_PER_ACTOR_24H: 5,
  COMMENTS_PER_ACTOR_PER_DAY: 5,        // calendar day, Asia/Dhaka
  COMMENT_COOLDOWN_SEC: 30,
  COMMENTS_PER_IP_PER_DAY_SOFT: 30,     // exceed => CAPTCHA, not block
  VOTE_ACTIONS_PER_ACTOR_PER_HOUR: 30,
  FLAG_ACTIONS_PER_ACTOR_PER_DAY: 20,
  TRACK_FAILS_BEFORE_LOCK: 5,
  TRACK_LOCK_MINUTES: 15,
} as const;

export const EDIT = {
  WINDOW_MINUTES: 15,
  MAX_EDITS: 3,
  MAX_CHANGE_RATIO: 0.30,
  COMMENT_SELF_DELETE_MINUTES: 15,
} as const;

export const PAGING = { DEFAULT: 20, MAP_MAX: 500, NEAREST_MAX: 100 } as const;

export const SEARCH = { DEFAULT_RADIUS_KM: 5, MAX_RADIUS_KM: 50 } as const;

export const ACTOR_COOKIE = { name: 'mdb_actor', maxAgeDays: 180 } as const;

export const ADMIN = {
  SESSION_ABSOLUTE_HOURS: 8,
  SESSION_IDLE_MINUTES: 30,
  LOGIN_FAILS_BEFORE_LOCK: 5,
  LOCK_MINUTES: 15,
  PASSWORD_MIN: 12,
  CSRF_HEADER: 'x-csrf-token',
} as const;

export const RETENTION = {
  SOFT_DELETE_DAYS: 30,
  HIDDEN_REVIEW_DAYS: 180,
  ABUSE_SIGNAL_DAYS: 7,
  AUDIT_LOG_YEARS: 2,
  GEO_CACHE_DAYS: 30,
  QUOTA_DOC_DAYS: 3,
} as const;

export const TIMEZONE = 'Asia/Dhaka';
export const CATEGORIES = ['road_accident','traffic_violation','police_misconduct','infrastructure','public_safety','other'] as const;
export const FLAG_REASONS = ['spam','fake','misleading','inappropriate','irrelevant'] as const;
export const COMMENT_TYPES = ['info','correction','experience'] as const;
export const VOTE_TYPES = ['support','dispute'] as const;
```

---

## 8. Data model (MongoDB / Mongoose)

All timestamps UTC `Date`. All collections use default `_id` ObjectId. `actorId` is the 32-char hex HMAC (§9.1).

### 8.1 `incidents`
```ts
{
  trackingId: string;            // unique, "MD-XXXXXXXX"
  secretHash: string;            // sha256 hex of normalised secret; NEVER returned to any API
  title: string; description: string;
  category: Category;
  incidentAt: Date;
  location: { type: 'Point'; coordinates: [number, number] }; // [lng, lat], 5 decimals
  roadName?: string; areaName?: string; upazila?: string; district?: string;
  safetyTip?: string;
  status: 'published' | 'hidden' | 'deleted';
  isEdited: boolean; editedAt?: Date; editCount: number;
  moderatedEdit: boolean;        // true if a moderator redacted/edited
  source: 'public' | 'team';
  actorId: string;               // poster (pseudonymous)
  contentHash: string;           // sha256(normalised title + '\n' + description)
  createdAt: Date; hiddenAt?: Date; deletedAt?: Date; purgeAt?: Date;
}
```
Indexes: `{trackingId:1}` unique · `{location:'2dsphere'}` · `{status:1, createdAt:-1}` · `{category:1, createdAt:-1}` · `{district:1, createdAt:-1}` · text index on `title, description, roadName, areaName` with `default_language:'none'` · `{actorId:1, createdAt:-1}` · `{purgeAt:1}` with `expireAfterSeconds:0` (partial: only where `purgeAt` exists).

### 8.2 `incident_versions`
`{ incidentId, version:number, title, description, safetyTip?, editedAt, editedBy:'reporter'|'moderator', reason? }` · unique `{incidentId:1, version:1}`.

### 8.3 `comments`
`{ incidentId, actorId, type, body, status:'published'|'hidden'|'deleted', redacted:boolean, createdAt, hiddenAt?, deletedAt?, purgeAt? }` · indexes `{incidentId:1,status:1,createdAt:-1}`, `{actorId:1,createdAt:-1}`, TTL on `purgeAt`.

### 8.4 `votes`
`{ incidentId, actorId, type:'support'|'dispute', createdAt, updatedAt }` · **unique `{incidentId:1, actorId:1}`** · `{incidentId:1, type:1}`.

### 8.5 `reports` (flags)
`{ targetType:'incident'|'comment', targetId, actorId, reason, note?, status:'open'|'actioned'|'dismissed', resolvedBy?, resolvedAt?, resolutionNote?, createdAt }` · **unique `{targetType:1,targetId:1,actorId:1}`** · `{status:1, createdAt:1}`.

### 8.6 `daily_quotas`
`{ actorId, day:'YYYY-MM-DD' (Asia/Dhaka), kind:'comment', count:number, expiresAt }` · **unique `{actorId:1,day:1,kind:1}`** · TTL on `expiresAt` (`expireAfterSeconds:0`).

### 8.7 `actors`
`{ actorId (unique), firstSeenAt, lastSeenAt, restriction?: { scope: ('post'|'comment'|'vote')[], until: Date, reason: string, setBy: ObjectId, setAt: Date }, restrictionHistory: [...], notes?: string }`. Created lazily on first **write** action (not on GET).

### 8.8 `abuse_signals`
`{ ipHash, actorId, type, createdAt }` · TTL 7 days on `createdAt` · `{ipHash:1, createdAt:-1}`.

### 8.9 `geo_cache`
`{ key (unique), result, createdAt }` · TTL 30 days.

### 8.10 `admin_users`
`{ email (unique, lowercase), passwordHash, role:'moderator'|'super', totpSecretEnc, totpEnabled, failedLogins, lockedUntil?, active, createdAt, lastLoginAt? }`.

### 8.11 `admin_sessions`
`{ adminId, sessionHash (unique), stage:'pending_2fa'|'active', csrfToken, createdAt, lastSeenAt, expiresAt }` · TTL on `expiresAt`.

### 8.12 `audit_logs` (append-only)
`{ adminId, action, targetType?, targetId?, reason?, before?, after?, createdAt }` · `{targetType:1,targetId:1}`, `{adminId:1,createdAt:-1}`, `{createdAt:-1}`. `before/after` are **small summaries**, never secrets/hashes.

### 8.13 `settings`
`{ key (unique), value, updatedBy, updatedAt }` — keys: `freeze_posting` (bool), `freeze_comments` (bool).

---

## 9. Algorithms and implementation details

### 9.1 Actor identity (middleware)
```
cookie = req.cookies.mdb_actor
if missing/invalid(length != 43 base64url): token = randomBytes(32).toString('base64url'); set cookie
cookie options: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=180d (refresh on each request)
actorId = HMAC_SHA256(ACTOR_HMAC_SECRET, token).hex().slice(0, 32)
req.actorId = actorId
```
Reads do not write to DB. On first write action, upsert `actors` and check `restriction` (if `until > now` and scope matches → `FORBIDDEN` with message "Your activity is temporarily restricted").

### 9.2 IP hash (abuse prevention only)
```
ip = first value of x-forwarded-for (trusted proxy) or req.ip
dayKey = YYYY-MM-DD (UTC)
ipHash = HMAC_SHA256(IP_HMAC_SECRET + ':' + dayKey, ip).hex().slice(0, 32)   // rotates daily; cannot be linked across days
```
Never store `ip`. Use `ipHash` only for Redis keys and `abuse_signals`.

### 9.3 Tracking ID and secret
```
ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford, no I L O U
trackingId = 'MD-' + 8 chars via crypto.randomInt per char ; on E11000 retry up to 5 times
secret = base32Crockford(randomBytes(16))        // 26 chars; display "XXXXX-XXXXX-XXXXX-XXXXX-X"
normalise(input): strip spaces/hyphens, uppercase, map I,L→1 and O→0
secretHash = sha256(normalise(secret)).hex
verify: timingSafeEqual(sha256(normalise(input)), storedHash)
```
Secret is returned only in the `POST /incidents` response and never stored/logged.

### 9.4 Atomic comment quota
```ts
const day = dhakaDay(new Date());               // 'YYYY-MM-DD' in Asia/Dhaka
try {
  await DailyQuota.findOneAndUpdate(
    { actorId, day, kind: 'comment', count: { $lt: RATE.COMMENTS_PER_ACTOR_PER_DAY } },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true }
  );
} catch (e) {
  if (e.code === 11000) throw QUOTA_EXCEEDED({ resetsAt: nextDhakaMidnightUTC() });
  throw e;
}
// only after success: insert the comment. Do NOT refund quota if insert fails.
```
(When `count` is already 5 the filter fails, upsert tries to insert, and the unique index on `(actorId,day,kind)` raises E11000 → quota exceeded.)
Comment creation order: validate → restriction check → freeze check → cooldown (Redis `SET key NX EX 30`) → IP soft cap (Redis counter; if over → require Turnstile) → quota → insert.

### 9.5 Text normalisation and rules
```
normalise(text):
  NFC; replace \r\n→\n; trim; collapse runs of >2 newlines; remove control chars except \n
  remove bidi override chars U+202A–U+202E, U+2066–U+2069
  KEEP U+200C and U+200D (Bangla)
prepareForDetection(text): convert Bangla digits ০-৯ → 0-9; remove spaces, hyphens, dots between digits
reject if any matches:
  URL:    /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|bd|io|co|info|me|xyz|app|link)\b)/i
  EMAIL:  /[^\s@]+@[^\s@]+\.[^\s@]+/
  PHONE:  /(\+?88)?01[3-9]\d{8}/  OR any run of 10+ digits after prepareForDetection
error: VALIDATION_ERROR, code detail "CONTACT_INFO_NOT_ALLOWED"
```
Apply to `title`, `description`, `safetyTip`, `roadName`, `areaName`, comment `body`, flag `note`.

### 9.6 Quick edit
```
load incident by trackingId (status must be 'published' or reporter still allowed)
check lockout (Redis key per trackingId); verify secret (constant time) → else record failure; at 5 failures set lock 15 min
if now - createdAt > 15 min → EDIT_WINDOW_CLOSED
if editCount >= 3 → EDIT_LIMIT_REACHED
for each provided field: ratio = levenshtein(old,new)/max(old.length,1); if ratio > 0.30 → VALIDATION_ERROR("CHANGE_TOO_LARGE")
validate new values with same rules (§7, §9.5)
transaction-free sequence: insert incident_versions (version = editCount+1, previous values) → update incident (fields, isEdited=true, editedAt=now, editCount+1)
```
Locked fields in payload → `VALIDATION_ERROR` (strict schema).

### 9.7 Serverless Mongo connection
```ts
let cached = (global as any)._mongo ?? ((global as any)._mongo = { conn: null, promise: null });
export async function connectDB() {
  if (cached.conn) return cached.conn;
  cached.promise ??= mongoose.connect(env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000 });
  return (cached.conn = await cached.promise);
}
```
Call `connectDB()` at the start of each request (middleware). Define indexes via a one-time script/`syncIndexes` run, not on every cold start.

### 9.8 Listing, search, pagination
- **Published only** (`status:'published'`).
- `bbox=west,south,east,north` → `location: { $geoWithin: { $box: [[w,s],[e,n]] } }`, limit 500, newest first.
- `near=lat,lng&radiusKm=` → `$geoWithin: { $centerSphere: [[lng,lat], radiusKm/6378.1] }` (works together with `$text`). `sort=nearest`: compute distance in app, return ≤ 100 items, **no cursor**.
- `q` → `$text: { $search: q }` (default_language none).
- `category` (comma list), `from`/`to` (ISO), `district` (exact, case-insensitive via normalised stored value).
- Cursor = base64url of `{ createdAt, _id }`; condition `createdAt < c OR (createdAt == c AND _id < id)`.
- Card fields returned in lists: `trackingId, title, excerpt(160), category, incidentAt, createdAt, location{lat,lng}, areaName, district, commentCount`. Compute `commentCount` for the page with **one** aggregation (`$match incidentId $in ids, status published` → `$group`).

### 9.9 Votes
```
PUT-like upsert: findOneAndUpdate({incidentId, actorId}, {$set:{type, updatedAt}, $setOnInsert:{createdAt}}, {upsert:true})
DELETE: deleteOne({incidentId, actorId})
counts: aggregate votes by incidentId grouped by type
```
Rate limit 30 vote actions/hour/actor (Redis).

### 9.10 Visibility semantics
| Status | Public list/details | Public comments | Track page |
|---|---|---|---|
| published | visible | visible | "published" |
| hidden | 404 | not reachable | "hidden by moderators" + outcome category |
| deleted | 404 | not reachable | "removed" + outcome category |
Hidden **comment**: still in list as `{ id, placeholder: true }` (text "Removed by moderators"). Deleted comment (self-delete or soft delete): omitted from list but still counted in the author's quota.
Soft delete sets `deletedAt` and `purgeAt = now+30d` (TTL purge). Orphan child docs after TTL purge are ignored by queries; **permanent delete** (Super Admin) cascades votes/reports/comments/versions.

---

## 10. API specification (base path `/api/v1`)

### 10.1 Conventions
- JSON only, UTF-8, HTTPS only. Secrets only in **request bodies**.
- Dates ISO-8601 UTC. Coordinates `{ lat, lng }` in API; GeoJSON internally.
- State-changing requests require a matching `Origin` header (allow-list from `ALLOWED_ORIGINS`). Admin state changes also need header `x-csrf-token`.
- Lists: `?limit=20&cursor=...` → `{ items, nextCursor }`.

### 10.2 Error envelope and status codes
```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "Daily comment limit reached.", "details": { "resetsAt": "2026-11-10T18:00:00.000Z" } } }
```
| Code | HTTP | Use |
|---|---|---|
| VALIDATION_ERROR | 400 | Schema or rule failure (`details.fields`, `details.reason`) |
| UNAUTHORIZED | 401 | Missing/invalid session; wrong tracking credentials (generic) |
| FORBIDDEN | 403 | Role, origin/CSRF, restriction, edit window closed/limit reached use dedicated codes below |
| NOT_FOUND | 404 | Missing or non-public item |
| DUPLICATE_ACTION | 409 | Already voted/flagged/duplicate content |
| LOCKED | 423 | Tracking lock (`details.retryAfterSeconds`) |
| EDIT_WINDOW_CLOSED | 403 | After 15 min |
| EDIT_LIMIT_REACHED | 403 | 3 edits used |
| CAPTCHA_REQUIRED | 428 | Missing/invalid Turnstile token |
| QUOTA_EXCEEDED | 429 | Daily comment limit |
| RATE_LIMITED | 429 | Rate limit (`Retry-After` header) |
| INTERNAL | 500 | Unexpected; no internals leaked |

### 10.3 Public endpoints
| Method & path | Purpose | Key rules |
|---|---|---|
| `GET /health` | Health | No DB write |
| `GET /meta` | Categories, limits, server time, Turnstile site key | Cache 1 h |
| `POST /incidents` | Create | Turnstile; 5/24h/actor; freeze check; returns credentials once |
| `GET /incidents` | List/search/map | §9.8 |
| `GET /incidents/:trackingId` | Details | Counts + `my` state |
| `POST /incidents/:trackingId/vote` | Support/Dispute (switch) | Body `{type}` |
| `DELETE /incidents/:trackingId/vote` | Remove vote | |
| `POST /incidents/:trackingId/reports` | Flag incident | Body `{reason, note?}` |
| `GET /incidents/:trackingId/comments` | List | Newest first, cursor |
| `POST /incidents/:trackingId/comments` | Add comment | §9.4; body `{type, body, captchaToken?}` |
| `DELETE /comments/:id` | Delete own (≤15 min) | Same actor |
| `POST /comments/:id/reports` | Flag comment | Body `{reason, note?}` |
| `POST /track` | Private view | Body `{trackingId, secret}` |
| `PATCH /incidents/:trackingId` | Quick edit | Body `{secret, title?, description?, safetyTip?}` strict |
| `GET /me/quota` | Remaining comments today | `{ commentsLeft, resetsAt }` |
| `GET /geo/reverse?lat&lng` | Reverse geocode | Proxy + cache + rate limit |
| `GET /geo/search?q` | Place → coords | Proxy + cache + rate limit |

**Key payloads**
```jsonc
// POST /incidents  (request)
{ "title": "...", "description": "...", "category": "road_accident",
  "incidentAt": "2026-11-09T08:30:00.000Z",
  "location": { "lat": 23.81033, "lng": 90.41252 },
  "roadName": "Mirpur Road", "areaName": "Dhanmondi", "upazila": "Dhanmondi", "district": "Dhaka",
  "safetyTip": "Avoid the right lane near the signal.", "captchaToken": "..." }

// 201 response
{ "incident": { /* PublicIncident */ },
  "credentials": { "trackingId": "MD-7K3Q9XTB", "secret": "4F8QZ-N2M7C-KX9TA-W5H1R-D" } }

// PublicIncident
{ "trackingId": "MD-7K3Q9XTB", "title": "...", "description": "...", "category": "road_accident",
  "incidentAt": "...", "createdAt": "...", "location": {"lat":23.81033,"lng":90.41252},
  "roadName": "...", "areaName": "...", "upazila": "...", "district": "...", "safetyTip": "...",
  "isEdited": false, "editedAt": null, "moderatedEdit": false, "source": "public",
  "counts": { "support": 12, "dispute": 2, "flags": 1, "comments": 5 },
  "my": { "vote": "support", "flagged": false } }

// POST /incidents/:id/comments (request)  { "type": "correction", "body": "The crash was near the other bridge.", "captchaToken": "optional" }
// 201 { "comment": { "id": "...", "type": "correction", "body": "...", "createdAt": "...", "mine": true }, "quota": { "commentsLeft": 3, "resetsAt": "..." } }

// POST /track  { "trackingId": "MD-7K3Q9XTB", "secret": "4F8QZ-N2M7C-KX9TA-W5H1R-D" }
// 200 { "incident": { /* PublicIncident */ }, "status": "published|hidden|deleted", "outcome": null,
//       "versions": [ { "version": 1, "title": "...", "description": "...", "safetyTip": "...", "editedAt": "..." } ],
//       "edit": { "allowed": true, "remainingSeconds": 540, "editsLeft": 3 } }
```

### 10.4 Admin endpoints (base `/api/v1/admin`; role `M` = moderator or super, `S` = super only)
| Method & path | Role | Purpose |
|---|---|---|
| `POST /auth/login` `{email,password}` | public | Creates `pending_2fa` session |
| `POST /auth/verify-2fa` `{code}` | pending | Activates session; returns csrf token |
| `POST /auth/logout`, `GET /auth/me` | M | |
| `GET /dashboard` | M | Counts: new today, open flags, hidden, active restrictions, comments today; recent audit |
| `GET /incidents`, `GET /incidents/:id` | M | Filters: status, category, district, date, trackingId, actorId |
| `POST /incidents` | M | Team incident (`source:'team'`, label "Posted by Mamladibe team") |
| `PATCH /incidents/:id` | M | Moderation edit/redact; **reason required**; sets `moderatedEdit`; stores version `editedBy:'moderator'` |
| `POST /incidents/:id/hide` / `unhide` / `restore` | M | Reason required |
| `DELETE /incidents/:id` | M | Soft delete |
| `DELETE /incidents/:id/permanent` | S | Cascade delete; reason required |
| `GET /comments`, `GET /comments/:id` | M | |
| `PATCH /comments/:id` | M | Redact text; reason required |
| `POST /comments/:id/hide` / `unhide`; `DELETE /comments/:id` | M | |
| `DELETE /comments/:id/permanent` | S | |
| `GET /reports`, `GET /reports/:id` | M | Queue (oldest open first; sort by count option) with target preview |
| `POST /reports/:id/resolve` `{outcome:'actioned'|'dismissed', note}` | M | |
| `GET /actors`, `GET /actors/:id` | M | Search by actorId prefix or trackingId; writes audit `actor.view` |
| `POST /actors/:id/restrict` `{scope[], days, reason}` / `unrestrict` | M | |
| `GET/POST/PATCH/DELETE /users`, `POST /users/:id/reset-2fa` | S | Manage admins |
| `GET /audit` | S (M: own) | Filter by admin, target, action, date |
| `GET/PATCH /settings` | S | `freeze_posting`, `freeze_comments` |

---

## 11. Admin panel specification

### 11.1 Permissions matrix
| Capability | Moderator | Super Admin |
|---|---|---|
| View dashboard, incidents, comments, reports | ✅ | ✅ |
| View Tracking ID and actor ID | ✅ | ✅ |
| View reporter secrets | ❌ never | ❌ never |
| Create team incident | ✅ | ✅ |
| Moderation edit/redact (reason) | ✅ | ✅ |
| Hide/unhide, soft delete/restore | ✅ | ✅ |
| Permanent delete | ❌ | ✅ |
| Resolve flags | ✅ | ✅ |
| Restrict/unrestrict actor | ✅ | ✅ |
| Manage admin users, reset 2FA | ❌ | ✅ |
| Audit log | own actions | all |
| Platform settings (freeze switches) | ❌ | ✅ |

### 11.2 CRUD by module
| Module | Create | Read | Update | Delete |
|---|---|---|---|---|
| Incidents | team post | list/filter/detail/versions/trackingId/actorId | moderation edit/redact, hide/unhide | soft; permanent (S) |
| Comments | — | list/filter/detail | redact, hide/unhide | soft; permanent (S) |
| Reports | by public | queue + target preview | resolve | — (kept for audit) |
| Votes | — | aggregate counts only | — | — |
| Actors | automatic | activity timeline | restrict/unrestrict, notes | auto-expiry |
| Admin users | S | S | role/status/reset 2FA | S |
| Audit log | automatic | filter | — | — |
| Settings | — | view | freeze switches | — |

### 11.3 Anonymous actor tracking
Each incident stores its **Tracking ID** and the poster's **actorId**; comments, votes and flags store `actorId` too. The actor profile page shows: short actorId (first 8 chars), first/last seen, **posts with Tracking IDs and status**, comments (type, status) and today's quota used, vote and flag counts, flags filed, rate-limit/quota hits, restriction state/history, moderator notes.
**Never shown/stored:** raw IP, name/email/phone, device fingerprint, secrets, raw browser token, cross-device linking.
Guardrails: opening a profile writes `actor.view` audit entry; data follows retention (§7 `RETENTION`); Privacy Notice must disclose pseudonymous browser-ID activity linking for abuse prevention; restrictions are time-limited, with reason.

### 11.4 Authentication
- No public registration. First Super Admin via `scripts/create-super-admin.ts` using `ADMIN_BOOTSTRAP_EMAIL` + a password prompted/provided once.
- Argon2id (`@node-rs/argon2`); password ≥ 12 chars.
- Login = password → TOTP (`otplib`, 30 s step, ±1 window). TOTP secret encrypted at rest with `TOTP_ENC_KEY` (AES-256-GCM).
- Session cookie `mdb_admin`: random 256-bit value, only SHA-256 stored; HttpOnly, Secure, SameSite=Strict; 8 h absolute / 30 min idle.
- 5 failed logins → account lock 15 min; generic errors; strict Redis rate limit on login.
- Admin HTML: `X-Robots-Tag: noindex`, `Cache-Control: no-store`.

### 11.5 Admin screens
Dashboard · Incidents (table + detail with versions/flags/comments/moderation history/actions) · Comments · Reports (queue, side-by-side preview, resolve with note) · Actors (profile, timeline, restrict) · Admin users (S) · Audit log · Settings (S, freeze switches with confirmation).

### 11.6 Audit log
Action names: `incident.create|edit|hide|unhide|delete|restore|purge`, `comment.edit|hide|unhide|delete|purge`, `report.resolve`, `actor.view|restrict|unrestrict`, `user.create|update|delete|reset2fa`, `settings.update`, `auth.login|logout|login_failed`. Each entry: admin, target, reason, small before/after summary, time.

### 11.7 Moderation workflow and content rules
Intake → Triage (urgent ≤ 24 h, others ≤ 72 h) → Decision (dismiss / hide / redact / soft-delete / restrict) with **mandatory reason** → automatic audit → reporter sees outcome **category** on Track page → appeal via Contact page, Super Admin reviews ≤ 7 days.
Rules enforced: threats/incitement; personal data/doxxing; statements about named **private** individuals presented as fact; hate/sexual/harassment; spam/links/ads; off-topic/test content; wrong category (moderator corrects). **Moderators do not mark incidents true/false.**

---

## 12. Frontend specification

### 12.1 Routes
| Route | Page |
|---|---|
| `/` | Map home |
| `/incident/:trackingId` | Incident details |
| `/report` | 4-step report form → credentials screen |
| `/track` | Track my report (+ quick edit) |
| `/search` | Search results |
| `/about` `/how-it-works` `/guidelines` `/terms` `/privacy` `/contact` | Static pages |
| `/admin/login`, `/admin/*` | Admin area (separate layout, not linked publicly) |

### 12.2 Screen behaviour
- **Map home:** full-screen map, header (logo, search place/keyword, EN/BN switch, **+ Report**), category chips, date filter, preview card/list, Near me, zoom controls. State in URL (`?lat=&lng=&z=&cat=`). Debounced bbox fetch.
- **Report form:** Step 1 Category → Step 2 Details (title, description, incident time, safety tip; live counters) → Step 3 Location (draggable pin, Use my location, suggested road/area editable, "similar report exists" notice) → Step 4 Review + Turnstile + Submit. Draft kept **in memory only**.
- **Credentials screen:** big Tracking ID + secret, Copy, Download `.txt`, warning "We cannot recover your secret", checkbox gates the "View my report" button.
- **Incident details:** per F04; comment form with type selector, remaining quota, disabled state with reset time; list with load more; hidden comments as placeholders.
- **Track page:** credentials form → status card, countdown, edit form (only editable fields), version list. Secret kept in memory only; cleared on leaving.
- **Errors:** friendly messages for validation, rate limit ("Try again in N minutes"), quota (with reset time), CAPTCHA, offline, server error. Never raw error text.
- **States:** skeleton loaders, empty states, offline banner.

### 12.3 Architecture
React Router · TanStack Query (retry 1, sensible stale times) · React Hook Form + shared Zod schemas · MapLibre with clustering · Tailwind · `react-i18next` · route-level code splitting (map chunk lazy) · initial JS < 250 KB gzip before map chunk.

### 12.4 Map settings
Style URL from env `VITE_MAP_STYLE_URL` (default an OpenFreeMap style, e.g. `https://tiles.openfreemap.org/styles/liberty`). Attribution control visible (OpenStreetMap / OpenFreeMap). Because the style URL is configuration, the tile provider can be switched without code changes.

### 12.5 Visual system
| Category key | Colour | Icon |
|---|---|---|
| road_accident | `#D64545` | car-crash |
| traffic_violation | `#E08A1E` | traffic-light |
| police_misconduct | `#7B4BB7` | shield |
| infrastructure | `#2F6FDE` | road/wrench |
| public_safety | `#C9A100` | alert-triangle |
| other | `#6B7280` | dot |
Fonts: system stack (EN) + Noto Sans Bengali (BN, loaded on demand). Base 16 px, scale 1.25. Spacing 4/8/12/16/24/32. Light theme only. Colour is never the only signal (icon + text label too).

---

## 13. Maps and geocoding (nationwide)
- **Tiles:** MapLibre + OpenFreeMap (public instance: no key, no view limit, no SLA). Fallback: MapTiler free plan (non-commercial, key needed) or self-hosted tiles later. OSM public raster tiles are for development only.
- **Why not Google Maps:** billing account required, free allowance only about 10,000 map loads/month then per-1,000 charges, budget alerts do not stop spending → unacceptable risk for a zero-budget public nationwide app. **Do not add Google Maps.**
- **Geocoding (server-side only):** `GET /geo/reverse` and `GET /geo/search` call Barikoi first (key `BARIKOI_API_KEY`; confirm free allowance in its dashboard), fallback Nominatim (≤ 1 req/s, send an identifying `User-Agent`). Cache results in `geo_cache` (key = lat/lng rounded to 4 decimals, or normalised query; 30 days). Reverse geocoding runs **once** when the pin is placed, never on every keystroke. If all providers fail, return `{ fallback: true }` and let the user type the area manually; **reporting is never blocked by geocoding.**
- **Bounds:** reject pins outside §7 `BOUNDS` (approximate national box).

---

## 14. Security and privacy specification

### 14.1 Threats and controls
| Threat | Controls |
|---|---|
| Spam/bots | Turnstile, Redis rate limits, daily quota, duplicate detection, text rules |
| Vote/flag/comment manipulation | Unique DB constraints, actor cookie, hourly limits, no automatic action from counts, moderator review (residual: multiple browsers = multiple actors — accepted) |
| Secret/Tracking ID guessing | 128-bit secret, hash only, constant-time compare, 5-fail lockout, generic errors |
| NoSQL injection | Zod `.strict()`, primitives only, no operators from users |
| XSS | Text-only rendering, strict CSP |
| CSRF/clickjacking | SameSite, Origin check, admin CSRF token, `frame-ancestors 'none'` |
| Doxxing/defamation/threats | Contact-info rejection, content rules, fast moderation, redaction, takedown contact, Terms |
| Admin takeover | Argon2id, mandatory TOTP, lockout, short sessions, rate limits |
| Insider misuse | RBAC, audit log (incl. actor views), secrets invisible |
| DB exposure | Only hashes; no raw IP; keyed-hash actor IDs |
| DoS | Edge protection, Redis limits, body limit 20 KB, query caps, indexes |
| Dependencies | Dependabot, `npm audit` in CI, lockfiles, minimal deps |
| Secret leakage | Env vars only, secret scanning, server-only provider keys |

### 14.2 Cryptography summary
Browser token 256-bit random · actorId HMAC-SHA256 (128-bit hex) · reporter secret 128-bit random, SHA-256 hash stored · IP hash HMAC with daily-rotating key, 7-day retention · admin password Argon2id · TOTP secret AES-256-GCM at rest · HTTPS + HSTS.

### 14.3 Security headers (adjust only if a feature breaks; keep as strict as possible)
```
Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline'; connect-src 'self' https://tiles.openfreemap.org;
  img-src 'self' data: https://tiles.openfreemap.org; worker-src 'self' blob:;
  frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Permissions-Policy: geolocation=(self)
Cache-Control: no-store   (admin routes and /track)
```
(MapLibre needs `worker-src blob:` and may need `child-src blob:`; verify in browser and tighten again.)

### 14.4 Privacy requirements
| Data | Purpose | Retention |
|---|---|---|
| User-written content | Core service (public by design) | Until removed |
| Pin coordinates + place text | Show on map | With incident |
| Browser token cookie / actorId | One vote/flag per incident, quotas, abuse prevention, edit/delete rights | Cookie 180 d; actorId with content |
| Hashed IP | Rate limits, abuse checks | 7 days |
| Admin account data | Operate panel | While active; audit 2 years |
GPS is requested only on "Use my location" and is not stored. No analytics or ad trackers. Privacy Notice must list exactly these items (EN + BN). Terms, Privacy, Guidelines need **lawyer review before public launch** (this PRD is not legal advice).

### 14.5 Backup and incident response
Atlas M0 has no automated backups: schedule `mongodump` at least weekly to private encrypted storage and **test a restore**. Security incident procedure: freeze posting (admin settings), rotate secrets, assess, fix, document, notify if user data affected. Rotate secrets at least every 6 months.

---

## 15. Infrastructure and deployment

### 15.1 Services
| Component | Service |
|---|---|
| Hosting | Vercel Hobby (`client`, `server` projects) — non-commercial only |
| Database | MongoDB Atlas M0 (512 MB, ~100 ops/s, no auto backups, may pause after long inactivity) |
| Rate limit store | Upstash Redis free tier |
| CAPTCHA | Cloudflare Turnstile |
| Tiles | OpenFreeMap |
| Geocoding | Barikoi + Nominatim fallback |
| Errors | Sentry free plan |
| Source/CI | GitHub + Actions |

### 15.2 Environment variables (names only; never commit values)
Server: `MONGODB_URI`, `ACTOR_HMAC_SECRET`, `IP_HMAC_SECRET`, `SESSION_SECRET`, `TOTP_ENC_KEY`, `TURNSTILE_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `BARIKOI_API_KEY`, `SENTRY_DSN`, `ALLOWED_ORIGINS`, `ADMIN_BOOTSTRAP_EMAIL`, `NODE_ENV`.
Client: `VITE_TURNSTILE_SITE_KEY`, `VITE_MAP_STYLE_URL`, `VITE_SENTRY_DSN`.
Validate all with Zod at startup; fail fast with a clear message.

### 15.3 Same-origin cookies (important)
`client/vercel.json`:
```json
{ "rewrites": [
  { "source": "/api/:path*", "destination": "https://<SERVER_PROJECT>.vercel.app/api/:path*" },
  { "source": "/(.*)", "destination": "/index.html" }
] }
```
The browser only talks to the client origin, so cookies are first-party. Local dev: Vite proxy `/api` → `http://localhost:4000`. Express mounts all routes under `/api/v1`. Follow Vercel's current Express-on-Vercel docs for the entry file (export the Express app); verify the rewrite passes `Set-Cookie`. If `shared/` is imported outside a project's root, enable "Include source files outside of the Root Directory" in Vercel project settings.

### 15.4 Release
Environments: local → preview (every PR) → production (from `main`). CI on every PR: lint, typecheck, tests, build, dependency audit. Rollback = redeploy previous deployment.

### 15.5 Upgrade triggers
Storage > 70% of 512 MB → archive/purge, then paid Atlas · DB ops near limit/slow queries → optimise or upgrade · any commercial/sponsored use → leave Vercel Hobby · tile outages → switch style URL · geocoding allowance exhausted → more caching or paid tier.

---

## 16. Testing and acceptance

### 16.1 Test levels
Unit (validation, text rules, hashing, tracking ID, Levenshtein rule, Dhaka-day calc, permissions) · API/integration (all endpoints, unique constraints, atomic quota, vote switching, lockout, edit window, RBAC) · E2E Playwright (report → map → details; vote; comment until quota; track + edit; flag; admin moderation) · Security (ASVS L1 checklist, ZAP baseline, authorisation matrix, injection/XSS payloads) · Performance (list/map/write load test, cold start) · Accessibility (axe, keyboard-only, screen reader spot check, low-end Android + iOS Safari).

### 16.2 Acceptance criteria
| ID | Given / When / Then |
|---|---|
| AC-01 | Valid report + CAPTCHA → public immediately; Tracking ID and secret shown once. |
| AC-02 | Pin outside Bangladesh bounds → server rejects. |
| AC-03 | Text with phone number, email or link → rejected with clear message (incl. Bangla digits). |
| AC-04 | Actor with Support vote switches to Dispute → support −1, dispute +1. |
| AC-05 | Actor flags same incident twice → second refused, count unchanged. |
| AC-06 | Actor posts 5 comments in a Dhaka day → 6th refused with `QUOTA_EXCEEDED` + reset time; quota resets at 00:00 Dhaka. |
| AC-07 | 5th and 6th comment sent simultaneously → exactly one succeeds. |
| AC-08 | Edit after 15 min with correct credentials → `EDIT_WINDOW_CLOSED`. |
| AC-09 | 5 wrong secrets for one Tracking ID → locked 15 min. |
| AC-10 | Incident with 50 flags stays public until a moderator acts. |
| AC-11 | Moderator tries permanent delete or user management → `FORBIDDEN`. |
| AC-12 | Every admin change creates an audit entry (admin, target, reason, time). |
| AC-13 | Comment containing `<script>` renders as plain text; nothing executes. |
| AC-14 | A DB dump contains no raw secret, raw IP, or raw browser token. |
| AC-15 | Locked fields (category, location, incidentAt) in an edit payload → `VALIDATION_ERROR`. |
| AC-16 | Hidden incident → 404 publicly, "hidden by moderators" on Track page; its comments unreachable. |
| AC-17 | Admin login without TOTP step cannot access any admin route. |
| AC-18 | Bangla text with ZWJ/ZWNJ is stored and displayed intact after normalisation. |

### 16.3 Definition of Done
Reviewed, merged, deployed to preview · tests pass · no critical/high security findings · acceptance criteria met · a11y checks pass · EN + BN strings present · docs updated · **task report (§5.2) delivered**.

---

## 17. Launch gate (all must be checked before public launch)
- [ ] All Must features F01–F15 pass acceptance criteria (F16 as "Should").
- [ ] Admin panel live with TOTP, roles, audit log; ≥ 2 trained moderators.
- [ ] Terms, Privacy Notice, Community Guidelines published (EN + BN) and lawyer-reviewed.
- [ ] Security checklist (§14) and authorisation tests pass; no critical/high findings.
- [ ] Backup export **and restore** tested.
- [ ] Barikoi, Upstash, Sentry free limits confirmed; upgrade alerts set.
- [ ] Tile provider + fallback tested; attribution displayed.
- [ ] Hosting plan matches use (non-commercial on Vercel Hobby).
- [ ] Emergency freeze switches tested.
- [ ] Content removal request process staffed and tested.

## 18. Success metrics (first 3 months)
Median time to submit a report < 2 min · 100% reports with valid location · urgent flags reviewed ≤ 24 h (≥ 95%) · all flags ≤ 72 h (≥ 90%) · spam share removed < 5% · map load p95 < 3 s on mobile · API availability ≥ 99% · zero open critical security findings at launch.

## 19. Decision log
| ID | Decision | Reason |
|---|---|---|
| D-01 | Comments moved from V2 into V1; flat; 5/actor/day | Team requirement; limit reduces spam/misinformation |
| D-02 | React + Node + MongoDB + Vercel | Team skills; free tiers; geospatial + unique indexes |
| D-03 | Serverless backend | No sleeping server, no keep-alive ping |
| D-04 | MapLibre + OpenFreeMap; no Google Maps | No billing/key; Google free tier too small |
| D-05 | actorId = HMAC of random browser token | Abuse control without identity or raw IP |
| D-06 | Counts computed, not stored | No drift, no transactions |
| D-07 | No automatic hiding from counts | Principle R-P4; prevents brigading |
| D-08 | Tracking ID as public URL id | Easy sharing; no private access alone |
| D-09 | Separate admin accounts with mandatory TOTP | Moderation is launch-critical and highest-risk |
| D-10 | Nationwide launch | Team requirement; free map stack + district indexing |

## 20. Future scope (do not build in V1)
Reach-based "Community Flagged" label · advanced abuse detection · image/video upload · comment replies/threads · notifications and area subscriptions · native apps · public statistics/open data export.

---
*End of PRD.md. Change policy: any change to this baseline requires a written change request and a new version number.*
