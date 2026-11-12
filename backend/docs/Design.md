# Mamladibe — V1 UI/UX Design Specification

| | |
|---|---|
| **Document** | `docs/Design.md` |
| **Version** | 0.1 (Draft for review) |
| **Date** | 10 November 2026 |
| **Based on** | Mamladibe PRD v1.0 Final (9 November 2026) |
| **Status** | NEEDS REVIEW — contains Proposed and `TO BE CONFIRMED` decisions |
| **Stack** | React 18, Vite, TypeScript, Tailwind CSS (PRD §7.6) |

---

## 0. How to read this document

### 0.1 Decision labels

Every design decision carries one of three labels.

| Label | Meaning |
|---|---|
| **[C] Confirmed** | Stated in the PRD. Do not change without a PRD change request. |
| **[P] Proposed** | Designer's recommendation. Not approved. Needs team sign-off before build. |
| **[TBC] `TO BE CONFIRMED`** | The PRD is silent, ambiguous, or conflicts with the design brief. A decision is needed. |

Unlabelled prose describes behaviour already implied by a labelled rule nearby.

### 0.2 Source documents and inspection note

- **Read:** `Mamladibe_PRD_v1_0_Final.pdf` (all 27 pages) and the design task brief.
- **Not available when this document was written:** the project folder structure, other files in `docs/`, and `Database.md`. Only the PRD was supplied.
- **Consequence:** The PRD's database section (§9) was used as the only data reference. Anything in `Database.md` that differs from PRD §9 has not been checked. See Appendix A.
- **No invention rule:** This document introduces no API endpoints, database fields, or product requirements. Where a design needs data the PRD does not describe, it is marked `TBC`.

### 0.3 Non-negotiable product principles (from PRD §3)

These constrain every screen.

1. No public accounts, login, usernames, or profiles.
2. Submission is anonymous. Valid reports publish immediately.
3. The interface never says a report is true, false, or verified.
4. Support, Dispute, report, and comment counts never hide or delete content.
5. Text only. No image, video, or file upload.
6. Comments are in V1: flat list, no replies, no editing.

---

## 1. Design foundation

### 1.1 Product design goals

| # | Goal | How design serves it |
|---|---|---|
| G1 | Let anyone report a road incident safely in under 2 minutes (PRD §18) | Short 4-step form, large touch targets, no account wall |
| G2 | Make incidents discoverable on a map and by search | Map-first home, shareable URLs, list alternative |
| G3 | Keep the platform neutral | No verdict colours, no "verified" language, counts labelled as opinion |
| G4 | Protect reporters | Persistent anonymity cues, clear "save your secret" flow |
| G5 | Work on low-end phones and weak networks | Mobile-first at 360 px, skeletons, lazy map |
| G6 | Give moderators fast, accountable tools | Dense admin tables, mandatory reasons, audit visibility |

### 1.2 Design principles

Principles 1–5 are **[C]** (PRD §7.1). Principles 6–8 are **[P]**.

1. **Mobile first [C].** Design at 360 px width, then scale up.
2. **Calm and neutral [C].** No alarming imagery. Factual wording. Colour marks category only, never judgement.
3. **Safety visible [C].** Anonymity, "not verified" notices, and the save-your-secret warning are always clear.
4. **Fast [C].** Skeleton loaders, lazy-loaded map, code splitting per route.
5. **Accessible [C].** WCAG 2.1 AA target.
6. **No false authority [P].** Support and Dispute use the same neutral styling. Never use green/red, ticks/crosses, or progress bars that suggest a winner.
7. **Honest limits [P].** Quotas, cooldowns, and windows are always shown before the user hits them.
8. **One obvious next step [P].** Each screen has a single primary action.

### 1.3 Visual direction

**[P] Proposed. No brand identity exists in the PRD.** Everything in this section marked [P] is unapproved.

- **Tone:** quiet, civic, trustworthy. Closer to a public-information service than a social network.
- **Layout:** generous whitespace, flat surfaces, thin borders, minimal shadow.
- **Imagery:** none. Text and map only (V1 has no media upload).
- **Theme:** light only **[C]** (PRD §7.5). Dark theme is out of V1.
- **Logo:** `TBC`. Use a plain text wordmark "Mamladibe" as a placeholder until a logo is approved.
- **Motion:** minimal. Fades and slides under 200 ms. Respect `prefers-reduced-motion` **[C]**.

### 1.4 Color system

#### 1.4.1 Category colors — **[C]** (PRD §7.5)

| Category | Hex | Icon | Short chip label **[C]** (PRD §7.3 wireframe) |
|---|---|---|---|
| Road Accident | `#D64545` | Car crash | Accident |
| Traffic Violation | `#E08A1E` | Traffic light | Traffic |
| Police Misconduct / Harassment | `#7B4BB7` | Shield | Police |
| Road & Infrastructure Issues | `#2F6FDE` | Road / wrench | Infrastructure |
| Public Safety Concern | `#C9A100` | Alert triangle | Safety |
| Other | `#6B7280` | Dot | Other |

Colour is never the only carrier of meaning. Every marker and badge also has an icon and a text label **[C]**.

#### 1.4.2 Contrast warning — **[TBC]**

Approximate contrast of each category colour against white (calculated for this document, verify with a tool):

| Color | Approx. ratio vs white | 3:1 (graphics) | 4.5:1 (text) |
|---|---|---|---|
| Red `#D64545` | 4.4 | Pass | Fail |
| Orange `#E08A1E` | 2.7 | **Fail** | Fail |
| Purple `#7B4BB7` | 6.0 | Pass | Pass |
| Blue `#2F6FDE` | 4.7 | Pass | Pass |
| Amber `#C9A100` | 2.5 | **Fail** | Fail |
| Grey `#6B7280` | 4.8 | Pass | Pass |

**[P] Mitigations** (keep the confirmed hex values, change how they are used):

- Never use a category colour as text on white. Badge text uses a dark neutral (`neutral-900`); the colour appears as a left bar, icon tile, or dot.
- Map markers get a 2 px white outline and a dark inner icon or white icon on a darkened ring, so the marker meets 3:1 against any tile colour.
- Orange and amber are close in hue. The icon and label must always be present to tell them apart.
- `TBC`: whether the team accepts these hex values as-is or wants adjusted shades for Orange and Amber.

#### 1.4.3 Neutral and interface colors — **[P]**

| Token | Hex | Use |
|---|---|---|
| `neutral-0` | `#FFFFFF` | Page and card background |
| `neutral-50` | `#F8FAFC` | App background, table stripes |
| `neutral-100` | `#F1F5F9` | Subtle fills, skeletons |
| `neutral-200` | `#E2E8F0` | Borders, dividers |
| `neutral-400` | `#94A3B8` | Disabled borders, placeholder (not for essential text) |
| `neutral-600` | `#475569` | Secondary text (≥ 4.5:1) |
| `neutral-900` | `#0F172A` | Primary text |
| `primary-600` | `#1D4ED8` | Primary buttons, links, focus ring base |
| `primary-700` | `#1E40AF` | Primary hover/pressed |
| `primary-50` | `#EFF6FF` | Selected chip background |

Primary is deliberately a blue-neutral that does not collide with a category colour in meaning. `TBC`: final brand accent.

#### 1.4.4 Feedback colors — **[P]**

| Role | Background | Text/border | Use |
|---|---|---|---|
| Info | `#EFF6FF` | `#1E3A8A` | "Not verified" notices, tips |
| Warning | `#FFFBEB` | `#92400E` | Save-your-secret box, quota nearly used |
| Error | `#FEF2F2` | `#991B1B` | Validation and server errors |
| Success | `#F0FDF4` | `#166534` | Saved, copied, submitted |

Success green is used **only** for system confirmations (copied, posted). It is never used on incidents, Support, or any content judgement.

### 1.5 Typography

| Item | Decision |
|---|---|
| English font | System font stack **[C]** |
| Bangla font | Noto Sans Bengali, loaded on demand **[C]** (PRD §13) |
| Base size | 16 px **[C]** |
| Type scale ratio | 1.25 **[C]** |
| Monospace (IDs/secrets) | System monospace stack **[P]** |

**[P] Scale (ratio 1.25 from 16 px):**

| Token | Size | Weight | Use |
|---|---|---|---|
| `text-caption` | 12.8 px | 400 | Helper text, timestamps. Never for essential info. |
| `text-body` | 16 px | 400 | Body, inputs |
| `text-lead` | 20 px | 500 | Card titles, section headings |
| `text-h2` | 25 px | 600 | Page sections |
| `text-h1` | 31 px | 700 | Page titles |
| `text-display` | 39 px | 700 | Credentials screen Tracking ID (desktop only) |

- **Line height [P]:** 1.5 for English, 1.7 for Bangla (Bangla glyphs need more room).
- **Text expansion [C]:** layouts tolerate longer Bangla strings (PRD §13). No fixed-width buttons.
- **Numerals [C]:** Bangla numerals when Bangla is selected (FR-16.3).
- **Line length [P]:** max 70 characters for descriptions and comments.
- **User text:** always plain text, preserved line breaks (comments: max 5), never HTML **[C]**.

### 1.6 Spacing system

**[C]** scale: **4 / 8 / 12 / 16 / 24 / 32 px** (PRD §7.5).
**[P]** additions for page-level layout only: 48 and 64 px.

| Token | px | Tailwind |
|---|---|---|
| `space-1` | 4 | `1` |
| `space-2` | 8 | `2` |
| `space-3` | 12 | `3` |
| `space-4` | 16 | `4` |
| `space-6` | 24 | `6` |
| `space-8` | 32 | `8` |
| `space-12` **[P]** | 48 | `12` |
| `space-16` **[P]** | 64 | `16` |

- **Touch targets [C]:** at least 44 × 44 px for every tappable element, with at least 8 px between neighbours **[P]**.
- Page horizontal padding **[P]:** 16 px mobile, 24 px tablet, 32 px desktop.

### 1.7 Border radius — **[P]**

| Token | px | Use |
|---|---|---|
| `radius-sm` | 4 | Tags, small inputs |
| `radius-md` | 8 | Buttons, inputs, chips |
| `radius-lg` | 12 | Cards, dialogs, bottom sheet top corners |
| `radius-full` | 9999 | Map markers, avatars-like dots, pill chips |

### 1.8 Shadows — **[P]**

| Token | Use | Description |
|---|---|---|
| `shadow-none` | Default cards | Use border `neutral-200` instead |
| `shadow-sm` | Sticky header, chips over map | Subtle 1–2 px blur |
| `shadow-md` | Preview card, dropdowns | Medium soft |
| `shadow-lg` | Dialogs, bottom sheet | Large soft |

Shadows never carry meaning. Do not rely on shadow to signal state.

### 1.9 Icon guidelines — **[P]**

- **Library:** `TBC`. Requirement: open license, tree-shakeable for React, includes car crash, traffic light, shield, road/wrench, alert triangle, copy, download, lock, clock, map pin, locate, search, filter, globe.
- **Style:** outline, 1.5–2 px stroke, 24 px grid. Sizes 16 / 20 / 24 / 32.
- **Category icons [C]:** car crash, traffic light, shield, road/wrench, alert triangle, dot.
- **Usage rules:**
  - Icons beside text are decorative (`aria-hidden`).
  - Icon-only buttons need an accessible name.
  - Do not use thumbs-up/down, tick/cross, or flag-red icons for Support/Dispute (they imply verdicts). Use plain "Support" and "Dispute" text; an optional neutral icon is `TBC`.
  - "Report" uses a neutral flag/outline icon in grey.

### 1.10 Accessibility requirements

Target: **WCAG 2.1 AA [C]**. Tested with axe, keyboard-only pass, screen reader spot check **[C]** (PRD §15.1).

| Area | Requirement |
|---|---|
| Keyboard | Every function works with keyboard. Logical tab order. No traps (dialogs trap focus and return it on close). |
| Focus | Visible 2 px focus ring, offset 2 px, ≥ 3:1 contrast. Never `outline: none` without replacement. |
| Contrast | Text ≥ 4.5:1; large text and UI graphics ≥ 3:1 (see §1.4.2). |
| Labels | Every input has a visible label. Placeholders are hints only. |
| Errors | Linked to the field (`aria-describedby`), announced via live region, text plus icon, never colour alone. |
| Live updates | Toasts and counts use `aria-live="polite"`. Blocking errors use `assertive`. |
| Map | The map canvas is not screen-reader friendly. A **List view** alternative is always available **[P]** and markers expose text labels for count and category **[C]** (PRD §7.1 "screen reader text for map markers and counts"). |
| Motion | Respect `prefers-reduced-motion`: disable map fly-to animation, skeleton shimmer, and slide transitions **[C]**. |
| Language | `lang` attribute switches `en` / `bn` with the language switch. User content is not auto-translated **[C]**. |
| Touch | 44 px targets **[C]**. |
| Zoom/reflow | Usable at 200% zoom and 320 px reflow without horizontal scroll **[P]**. |
| Timers | Countdowns (edit window, comment delete) are announced at start and at 1 minute and 0, not every second **[P]**. |
| CAPTCHA | Turnstile widget is keyboard reachable. Failure shows a retry path. |
| Admin | Tables use proper `th` scope. Row actions have accessible names that include the row target. |

---

## 2. Navigation and page structure

### 2.1 Site map — **[C]** (PRD §7.2)

| Route | Page |
|---|---|
| `/` | Map home |
| `/incident/:trackingId` | Incident details (Tracking ID in URL, e.g. `/incident/MD-7K3Q9XTB`) |
| `/report` | New report (4-step form, then credentials screen) |
| `/track` | Track my report (also holds quick edit) |
| `/search` | Search results |
| `/about`, `/how-it-works`, `/guidelines`, `/terms`, `/privacy`, `/contact` | Help and legal |
| `/admin/login` | Admin sign-in |
| `/admin/*` | Admin area: dashboard, incidents, comments, reports, actors, admin users, audit log, settings |

Quick edit has no separate route in the PRD; it lives on `/track` **[C]**.
A modal alternative for submission is **not** used: submission is the `/report` page **[C]** (PRD §7.2, §7.4).

### 2.2 Public global navigation

**Header [C wireframe, P details]:** logo | search box | EN / BN switch | `+ Report` button.

| Element | Desktop | Mobile |
|---|---|---|
| Logo | Left, links to `/` | Left, icon + short wordmark |
| Search | Inline input, centre | Icon opens full-width search overlay **[P]** |
| Language switch | EN / BN toggle | Same, compact |
| Report | Primary button, right | Primary button stays visible; on map home also a floating action button (FAB) **[P]** |
| Track my report | Text link in header **[P]** | In overflow menu **[P]** |
| Menu | n/a | "More" menu: Track, About, How it works, Guidelines, Terms, Privacy, Contact **[P]** |

- No Log in / Sign up anywhere in public UI **[C]**.
- No user avatar, profile, or "My account" **[C]**.

**Footer [C]:** About, How it works, Guidelines, Terms, Privacy, Contact / Content Removal Request linked from every page (FR-15.1). On the map home page the footer links live in the "More" menu on mobile and a thin footer strip on desktop **[P]**.

### 2.3 Global elements

| Element | Behaviour | Status |
|---|---|---|
| First-visit cookie notice | Explains the single strictly necessary cookie and that no personal account exists. One acknowledgement button. Dismissal remembered in the browser. | **[C]** content, **[P]** layout |
| Language switch | EN / BN, preference remembered in browser | **[C]** |
| Toast area | Bottom on mobile, top-right on desktop | **[P]** |
| Offline banner | Shown when the network is lost | **[P]**, message **[C]** (PRD §7.4 lists "offline") |
| Posting/comment freeze banner | Shown when an admin freezes posting or comments | `TBC` — see §11.3 |
| Neutral "not verified" notice | On incident details and near comments | **[C]** |
| Attribution | OpenStreetMap / OpenFreeMap attribution always visible on map | **[C]** (PRD §11.2, §19) |

### 2.4 Admin navigation — **[P]** layout, **[C]** modules

Left sidebar (desktop) or top drawer (tablet/mobile):

| Item | Moderator | Super Admin |
|---|---|---|
| Dashboard | Yes | Yes |
| Incidents | Yes | Yes |
| Comments | Yes | Yes |
| Reports | Yes | Yes |
| Actors | Yes | Yes |
| Audit log | Yes (own actions) | Yes (all) |
| Admin users | Hidden | Yes |
| Settings | Hidden | Yes |

Top bar shows admin email, role badge, session time remaining, and Sign out. Admin pages are `noindex`, not linked from public pages **[C]**.

---

## 3. User journeys

Each journey lists the steps, key screens, and the failure branches. Step numbers are for reference.

### 3.1 Discovering an incident — **[C]** flow (PRD §6), **[P]** detail

1. Visitor opens `/`. Map shows all of Bangladesh centred on Dhaka (FR-03.5).
2. Skeleton and map tiles load. Markers appear for the visible area after the map stops moving (FR-03.3).
3. Visitor pans, zooms, or types a place in the search box (FR-08.4). Map moves.
4. Visitor applies category chips or date filter. URL updates (FR-03.4).
5. Visitor taps a marker or cluster. Cluster → zoom in. Marker → preview card (title, category, time, area, comment count).
6. Visitor taps **View details**. Details page opens.
7. Visitor reads description, safety tip, notice, and comments.

Branches: more than 500 incidents → "Zoom in to see more" notice. Network error → retry banner over map, map stays usable. No incidents → empty state (§4.1).

### 3.2 Submitting an incident — **[C]** (PRD §6, §7.4)

1. Visitor taps **Report** (header or FAB).
2. **Step 1 Category:** chooses exactly one of six.
3. **Step 2 Details:** title, description, optional safety tip, incident date and time.
4. **Step 3 Location:** drops a pin or taps **Use my location**; reviews suggested road/area (editable, max 120).
5. **Step 4 Review & CAPTCHA:** reads summary, passes Turnstile, taps **Submit**.
6. **Credentials screen:** sees Tracking ID and secret once; copies or downloads; ticks "I have saved these".
7. Taps **View my report** (unlocked by the checkbox). Incident is live.

Branches:
- Validation error → stay on the step, error summary at top, focus moved to first invalid field.
- Phone, email, or link detected → "Remove personal contact details" (FR-01.2).
- Similar report nearby → non-blocking "A similar report exists" notice (FR-01.7) with a link to it.
- Duplicate content within 24 h → refused with friendly message (FR-01.7).
- Rate limit (5 per 24 h) → "Try again in N minutes".
- Pin outside Bangladesh → server rejects (FR-02.3); UI also warns on pin drop **[P]**.
- Geocoding fails → manual area text entry; reporting is never blocked **[C]** (PRD §11.3).
- Draft is kept in memory only until submit **[C]**. Closing the tab loses it; the form warns before leaving **[P]**.

### 3.3 Selecting a map location — **[C]** (FR-02.x)

1. Step 3 shows a map centred on the user's last map view (or Dhaka) **[P]**.
2. Visitor taps/clicks the map to place a draggable pin, or drags an existing pin.
3. On pin placement (not while dragging), the app fetches road, area, upazila/thana, district once through the backend proxy.
4. Suggested road/area appears in an editable text field with a counter (max 120).
5. Visitor can re-drop the pin; the suggestion refreshes once on each placement.
6. Stored coordinates are the pin position (rounded 5 decimals server side).

Mobile alternative to dragging **[P]**: a centre-crosshair mode where the visitor pans the map under a fixed pin and taps **Confirm location**. This is easier than precise dragging on a small screen.

### 3.4 Using optional GPS — **[C]** (FR-02.1, PRD §12.4)

1. Visitor taps **Use my location** (step 3) or **Near me** (map home).
2. Browser permission prompt appears (permissions policy allows geolocation for the site only).
3. Granted → map centres on the visitor. In the report form the GPS position only centres the map; the visitor still places or confirms the pin. GPS is not stored.
4. Denied or unavailable → inline message "Location permission is off. You can still tap the map to place a pin." Button remains available.
5. Before the browser prompt, a one-line explanation is shown: "Used only to centre the map. Not stored." **[P]**

### 3.5 Supporting or disputing an incident — **[C]** (FR-06.x)

1. On details, visitor sees two buttons: **Support** and **Dispute** with plain counts.
2. Tap **Support** → one active vote, button shows pressed state, count +1.
3. Tap **Dispute** while Support is active → switch: Support −1, Dispute +1, total unchanged (FR-06.2).
4. Tap the active button again → remove vote **[P]** gesture; PRD requires the ability (FR-06.3).
5. Counts read "N people support" and "N people dispute"; no status is derived (FR-06.4).

Branches: vote action limit (30/hour) → "Try again in N minutes". Network failure → optimistic update rolls back with toast.
Support/Dispute does not require CAPTCHA by default.

### 3.6 Reporting content — **[C]** (FR-05.x, FR-13.7)

1. Visitor taps **Report** (flag) on an incident or on a comment.
2. Dialog opens: choose one reason (Spam, Fake, Misleading, Inappropriate, Irrelevant) and optional note (max 200; for comments, the PRD specifies reason only — see §6.8).
3. Submit → toast "Thanks. Moderators will review this." Button becomes "Reported" and disabled.
4. Repeat attempt → friendly message "You have already reported this" (FR-05.2).
5. Flag count may be shown on the incident (FR-05.3); nothing is hidden or labelled by it.

### 3.7 Commenting — **[C]** (FR-13.x)

1. On details, visitor scrolls to **Add information**.
2. Chooses a type (required): Additional information, Correction / different information, Personal experience / opinion.
3. Types body (5–500 chars, max 5 line breaks). Counter shown.
4. Sees "N of 5 left today". Submits.
5. If risk is raised or the IP cap is reached, Turnstile appears inline (FR-12.3, FR-13.5).
6. Comment appears at the top of the list (newest first).
7. Author sees **Delete** on their own comment for 15 minutes (FR-13.8).

Branches: links/emails/phones → rejected with message. Sixth comment → quota message with reset time. Within 30 s of last comment → cooldown countdown on button.

### 3.8 Tracking an incident — **[C]** (FR-07.x)

1. Visitor opens `/track` (from credentials screen, header link, or the saved `.txt` file).
2. Enters Tracking ID and secret.
3. Success → private view: status card, counts, version history, edit availability with countdown, moderation outcome category if any.
4. Failure → one generic error. After 5 failures for that ID → locked 15 minutes; message shows the lock.
5. Secret is held in memory only and cleared on leaving the page **[C]**.

### 3.9 Editing within the allowed time — **[C]** (FR-09.x)

1. From the private view, within 15 minutes of publication, the edit form is shown with a countdown.
2. Editable: title, description, safety tip. Locked and shown read-only: category, location, incident time.
3. Visitor edits and saves. Rules: max 3 edits, max 30 % change per field. Server decides.
4. On success the post shows "Edited" with time; previous version is kept and listed in version history.
5. After 15 minutes the form is replaced with "Edit window closed. This post is now permanent." The visitor can still view it (FR-09.5).

### 3.10 Viewing moderation status where appropriate — **[C]** (FR-07.3, PRD §10.5 step 5)

Moderation status is shown only:
- On the **Track** page to the reporter: status (published, hidden by moderators, removed) and outcome category (for example "Hidden by moderators: content rule").
- On the public incident page as "Edited by moderators" if redacted (FR-04.3), and "Posted by Mamladibe team" for team posts.
- In the comment list as the placeholder "Removed by moderators" (FR-13.10).

The public never sees who moderated, which moderator, or the reason text. Appeal path: link to Contact page for content removal or appeal request (PRD §10.5 step 6).

### 3.11 Moderator handling a flag — **[C]** (PRD §6)

1. Sign in with email, password, then two-factor code.
2. Open the Reports queue.
3. Read content, reasons, and actor history.
4. Choose: dismiss, hide, redact, soft-delete, restrict actor.
5. Write the mandatory reason. The action is logged.

---

## 4. Page-level UI specifications

Each page uses the same template: Purpose, Layout, Main components, User actions, Loading, Empty, Error, Success, Mobile, Accessibility.

### 4.1 Homepage / Interactive incident map (`/`) — F03

| | |
|---|---|
| **Purpose** | Discover incidents spatially. Entry point for reporting. |
| **Layout [C wireframe]** | Header → filter chips row → full-screen map → preview card / list. Controls on map: Near me, zoom +/−. |
| **Main components** | Header, `CategoryFilterChips`, date filter control, `MapCanvas` (MapLibre, clustering), `MapMarker`, `ClusterMarker`, `MapPreviewCard`, `NearMeButton`, `ZoomControls`, `ListViewToggle` **[P]**, `ReportButton`/FAB, `ZoomInNotice`, attribution. |
| **User actions** | Pan/zoom, tap marker/cluster, filter by category, set date range, search a place or keyword, Near me, open details, share link (URL holds position, zoom, filters **[C]**), start a report. |
| **Loading** | Page shell and header appear first. Map area shows a neutral placeholder with a spinner label "Loading map…". Marker fetch runs after map idle (debounced **[C]**): a thin progress bar under the chips; existing markers stay until new ones arrive. Preview/list uses skeleton cards. |
| **Empty** | No incidents in view: centred card over map "No reports in this area yet. Zoom out or try another filter." with **Clear filters** and **Report an incident**. Never imply an area is safe **[P]**. |
| **Error** | Marker fetch failed: inline banner "Couldn't load reports. Retry" over the map; map stays interactive. Tile failure: message "Map tiles are unavailable. You can still search and browse the list." with link to List view. Location denied: inline hint (see §3.4). |
| **Success** | Markers and clusters visible. Toast "Link copied" when sharing. |
| **Mobile** | Chips scroll horizontally (snap). Preview opens as a **bottom sheet** (peek → half → full) **[P]**. FAB for Report. Map controls on the right, above the sheet. Search collapses to icon. |
| **Accessibility** | List view alternative. Chips are a labelled toggle group (`aria-pressed`). Marker text labels expose category + title. Focus returns to the originating marker after closing preview. Map has keyboard zoom/pan. Reduced motion disables fly-to. |

**Details**
- **Filters [C]:** category chips (multi-select per FR-08.2), date: Today / Last 7 days / Last 30 days / Custom range. Wireframe shows a "Date: 7 days" control.
- **Default view [C]:** whole of Bangladesh, centred on Dhaka (FR-03.5). See conflict §11.3 (Dhaka-first rollout).
- **Preview card content [C]:** title, category, time, area, comment count, link to details (FR-03.2). The PRD wireframe also shows Support/Dispute counts. `TBC` which to show; see §11.3.
- **Request size [C]:** up to 500 incidents per request; beyond that show "Zoom in to see more".

### 4.2 Incident submission page (`/report`) — F01, F02, F10, F11

**Decision [C]:** a dedicated page with a 4-step stepper (Category, Details, Location, Review and CAPTCHA), followed by the credentials screen. Not a modal.

| | |
|---|---|
| **Purpose** | Let a visitor submit an anonymous incident quickly and safely. |
| **Layout** | Single column, max width 640 px on desktop, centred. Top: stepper with progress ("Step 2 of 4"). Middle: step content. Bottom: sticky action bar (Back / Next). Step 3 on desktop may use a two-column layout: form left, map right **[P]**. |
| **Main components** | `Stepper`, `CategoryPicker`, `TextField` + `CharacterCounter`, `TextArea`, `DateTimePicker`, `LocationPicker` (map + draggable pin), `UseMyLocationButton`, `RoadAreaField`, `SimilarReportNotice`, `ReviewSummary`, `TurnstileWidget`, `SubmitButton`, `CredentialsPanel`. |
| **User actions** | Choose category, enter text, set time, place pin, edit area, review, pass CAPTCHA, submit, copy/download credentials, confirm saved, view report, go back to edit. |
| **Loading** | Reverse geocoding: small spinner next to the area field, field editable meanwhile. Submit: button shows spinner + "Publishing…", all inputs disabled to prevent double submit. |
| **Empty** | Not applicable. Initial state is a fresh form. |
| **Error** | Per-field messages plus an error summary at the top of the step. Geocoding failure: "We couldn't find the road name. Please type the area." Rate limit, CAPTCHA required, offline, server error: friendly messages per §10. Never show raw error text **[C]**. |
| **Success** | Credentials screen (§4.2.2). |
| **Mobile** | Full-width form. Sticky bottom bar with Back/Next, 44 px buttons. Map step uses crosshair mode **[P]**. Keyboard-safe: sticky bar rises above the on-screen keyboard. |
| **Accessibility** | Each step is a heading; focus moves to the step heading on change. Stepper is an ordered list with `aria-current="step"`. Counters are announced politely at thresholds, not per keystroke **[P]**. Map step has a text alternative: type a place name to move the map; manual area text; keyboard arrow movement of the pin **[P]**. |

#### 4.2.1 Step specifications

| Step | Fields | Rules shown to the user [C] |
|---|---|---|
| 1 Category | Six large selectable cards with icon, colour accent, and label. Exactly one. | Category cannot be changed after posting; hint text "You can't change this later" **[P]** (FR-11.2). |
| 2 Details | Title (5–100), Description (20–2,000), Safety tip optional (0–500), Incident date and time. | Counters on all text fields. Time not in the future, not older than 90 days. No phone numbers, emails, or links. Safety tip labelled "Optional. Reporter-provided safety tip." |
| 3 Location | Map with draggable pin, **Use my location**, road/area text (max 120). | Pin must be in Bangladesh bounds. Coordinates are the pin, not GPS. |
| 4 Review | Read-only summary with **Edit** links per section; Turnstile; **Submit**. | A short statement: "Your report will be published immediately and anonymously." |

Each step validates before continuing **[C]**.

**Anonymity cue [P]:** a persistent one-line note under the stepper: "No account. No name. Your report is anonymous."

**Similar-report notice [C]:** non-blocking card "A similar report exists" with title and link, shown on step 3 or 4 when the server signals it. `TBC`: the PRD does not say at which step this arrives; see §11.3.

#### 4.2.2 Credentials screen — F01 FR-01.4/01.5, F07

| | |
|---|---|
| **Purpose** | Show Tracking ID and secret once and make sure the reporter saves them. |
| **Layout** | Centred card. Success header "Your report is live". Large Tracking ID. Large secret in groups of five (FR-07.2). Copy and Download (.txt) buttons for each or both. Warning box. Checkbox. **View my report** button disabled until the checkbox is ticked. |
| **Components** | `CredentialsPanel`, `CopyButton`, `DownloadButton`, `WarningCallout`, `Checkbox`. |
| **Actions** | Copy ID, copy secret, download `.txt`, tick "I have saved these", view report. |
| **Loading** | n/a (data already returned). Download is instant. |
| **Empty** | If the page is reloaded and the credentials are no longer in memory: show "Credentials can't be shown again" with links to the report and Track page **[P]**. |
| **Error** | Copy fails (clipboard blocked): select text and show "Press Ctrl/⌘+C to copy" **[P]**. |
| **Success** | "Copied" confirmation on the button label for 2 s plus polite announcement. |
| **Mobile** | Stacked. Secret wraps in groups; monospace; at least 20 px. Buttons full width. |
| **Accessibility** | Warning is a text block with an icon, not colour only. Secret is not obscured so users can read and write it down. Checkbox label states the consequence. Leaving the page while unchecked asks for confirmation **[P]**. |

**Required content [C]:**
- Warning box: "We cannot recover your secret."
- Checkbox: "I have saved these."
- States plainly that the secret cannot be recovered (FR-01.5).
- Secret is never put in the URL, never logged **[C]** (so it is not shown on any link).

**Downloaded .txt content [P]:** Tracking ID, secret, public report link, Track page link, and the "cannot be recovered" warning. No other personal data exists.

**Character set [C]:** Tracking ID format `MD-` + 8 Crockford Base32 characters; secret is 26 Base32 characters grouped in fives. Display in monospace with extra letter spacing; avoid look-alike characters is a generation rule, so the UI does not need to correct them.

### 4.3 Incident details page (`/incident/:trackingId`) — F04

| | |
|---|---|
| **Purpose** | Read a full report, respond (Support/Dispute/Report), and add information. |
| **Layout** | Desktop: two columns. Left (≈ 60 %): header, description, safety tip, notice, responses, comments. Right (≈ 40 %): small location map, location text, metadata. Mobile: single column; map after the description. |
| **Main components** | `IncidentHeader` (category badge, title, Edited label, team label), `IncidentMeta`, `IncidentDescription`, `SafetyTipBlock`, `NotVerifiedNotice`, `LocationMiniMap`, `SupportDisputeControl`, `ReportAction`, `ShareButton`, `CommentSection`, `TrackingIdLine`. |
| **User actions** | Share (copy link), Support, Dispute, remove vote, Report, comment, report a comment, delete own recent comment, open map, go back. |
| **Loading** | Skeleton for title, meta lines, and description. Comments load separately with their own skeleton list. Mini-map lazy-loads with a grey placeholder. |
| **Empty** | No safety tip → block not rendered (FR-04.2). No comments → comment empty state (§6.5). |
| **Error** | Not found: friendly "This report doesn't exist or is no longer available" with link to map. Hidden or removed incident public view: `TBC` (§11.3). Load failure: retry button. Vote/flag errors: inline message near the control. |
| **Success** | Toasts: "Link copied", "Vote saved", "Thanks. Moderators will review this." |
| **Mobile** | Sticky bottom action bar with Support, Dispute, Report **[P]** so responses are reachable without scrolling. Mini-map is tap-to-expand. |
| **Accessibility** | One `h1` (title). Counts use text, not just numbers ("12 people support"). Vote buttons use `aria-pressed`. Comment section is a labelled landmark. Time elements use `<time>` with Dhaka-time text. |

**Content order [P]:**
1. Back link (to previous map/search state, preserving filters).
2. Category badge, title, "Edited" label, "Posted by Mamladibe team" label if applicable.
3. Incident time and posting time (both shown, labelled), area/district.
4. Description.
5. Safety tip block (only if present), labelled "Reporter-provided safety tip" **[C]**.
6. Neutral notice: "This content is community-provided and not verified." **[C]**
7. Support / Dispute controls, Report, Share.
8. Location with mini-map, road, area, district **[C]** (FR-04.1).
9. Comments.

### 4.4 Search and filter interface (`/search` and filter UI on `/`) — F08

| | |
|---|---|
| **Purpose** | Find incidents by text, category, date, and place. |
| **Layout** | Desktop: left filter column (280 px) + results list. Mobile: results list with a **Filters** button opening a full-height sheet. Result count and sort at the top; **Show on map** link **[C]** (PRD §7.2). |
| **Main components** | `SearchInput` (keyword and place), `FilterPanel` (`CategoryFilter`, `DateFilter`, `PlaceFilter`), `SortSelect`, `ActiveFilterTags`, `IncidentCard` (list variant), `LoadMoreButton`, `ShowOnMapLink`. |
| **User actions** | Type query, choose categories (multi-select), choose date (Today / Last 7 days / Last 30 days / Custom range), choose place (district or area), sort (Newest default, Oldest, Nearest), clear filters, load more, show on map. |
| **Loading** | Skeleton cards (6). Filter changes keep current results dimmed with a thin progress bar. |
| **Empty** | "No reports match your search." Suggestions: clear a filter, widen date range, try different words. Button **Clear all filters**. |
| **Error** | "Search isn't working right now. Try again." with retry. |
| **Success** | List of `IncidentCard`s with total or "20 shown" text. |
| **Mobile** | Filters in a bottom sheet with **Apply** and **Clear**. Active filters as removable tags above results. |
| **Accessibility** | Filter panel is a labelled form. Results region announces result count when it changes (polite). Sort is a native select. Removable tags have accessible names ("Remove filter: Road Accident"). |

**Rules [C]:**
- Search covers title, description, road, area, district; Bangla and English both supported (FR-08.1).
- **Nearest** is available only when the visitor's location is known; otherwise the option is disabled with a hint "Turn on location to sort by nearest" (FR-08.3).
- **No verification-status filter** exists (FR-08.5). Do not add one, and do not add Support/Dispute-based filters or sorting **[P]** (avoids implying truth).
- Page size 20, cursor based **[C]**. Because cursor pagination cannot jump to page numbers, use a **Load more** button instead of numbered pages **[P]**.

**Header search box [P]:** one input. As the visitor types, show two suggestion groups: "Search reports for 'x'" (goes to `/search`) and "Go to place 'x'" (geocoding proxy, moves the map). Place search triggers on submit or selection, not on every keystroke, to protect geocoding allowance **[C rule: lookup not while typing for reverse geocoding; forward search rate-limited]**.

### 4.5 Track my report page (`/track`) — F07, F09

| | |
|---|---|
| **Purpose** | Let a reporter view the private status of their post and edit within 15 minutes. |
| **Layout** | Step A: credentials form (Tracking ID, secret). Step B (after success): status card, counts, edit panel with countdown, version history. Single column, max width 640 px. |
| **Main components** | `TrackForm`, `SecretInput` (show/hide toggle), `StatusCard`, `ModerationOutcomeNote`, `EditCountdown`, `QuickEditForm`, `LockedFieldDisplay`, `VersionHistoryList`, `NoRecoveryNotice`. |
| **User actions** | Enter ID and secret, view status, edit title/description/safety tip, save, view version history, open the public page. |
| **Loading** | Submit button spinner; on success, skeleton for status card and history. |
| **Empty** | No edits yet → version list shows only "Original version". After the window: edit panel replaced by closed message. |
| **Error** | Wrong credentials → one generic message: "Tracking ID or secret is incorrect." Never say which is wrong **[C]**. After 5 failures: "Too many attempts. Try again in 15 minutes." with lock timer **[C]**. Edit errors: `EDIT_WINDOW_CLOSED`, `EDIT_LIMIT_REACHED`, validation messages (§10). |
| **Success** | Status card visible. After saving an edit: "Saved. Your report now shows 'Edited'." |
| **Mobile** | Single column; secret input uses `autocomplete="off"`, no browser password-save prompt; countdown pinned at top of the edit panel. |
| **Accessibility** | Secret toggle has an accessible name. Countdown announced at start, at 1 minute, at 0. Locked fields show a lock icon with text "Locked after posting". Error summary linked to fields. |

**Always-visible notice [C]:** "If you lose your secret it cannot be recovered or reset." (FR-07.5)

**Status card content [C]:** current status (published, hidden by moderators, removed), counts, version history, edit availability with countdown, moderation outcome category if any.

**Edit rules shown as help text [C]:** "Corrections only (like typos). Each field can change by at most 30 %. Up to 3 edits within 15 minutes." Remaining edits "2 of 3 edits left" **[P]**; `TBC` whether the server returns the remaining count (§11.3).

**Edit panel [P]:** editable fields title, description, safety tip show counters. Locked fields (category, location, incident time) appear read-only. Countdown uses **server time** from the meta data endpoint so a wrong device clock cannot mislead **[P]** (PRD §8.3 `GET /meta` returns server time).

**Secret handling [C]:** held in memory only, cleared on leaving the page.

### 4.6 Report content interface (dialog) — F05

| | |
|---|---|
| **Purpose** | Flag an incident or a comment that breaks the rules. |
| **Layout** | Modal dialog on desktop (max 480 px); bottom sheet on mobile. |
| **Components** | `Dialog`/`BottomSheet`, `RadioGroup` (5 reasons), `TextArea` + counter (incident: note max 200), `PrimaryButton`, `SecondaryButton`. |
| **User actions** | Choose reason (required), add note (optional), submit, cancel. |
| **Loading** | Submit spinner; dialog stays open and inputs disabled. |
| **Empty** | n/a |
| **Error** | Already reported → "You have already reported this." (`DUPLICATE_ACTION`). Rate limit (20 flag actions/day) → "You've reached today's reporting limit." Generic → retry. |
| **Success** | Dialog closes, trigger shows "Reported", toast "Thanks. Moderators will review this." |
| **Mobile** | Bottom sheet; reason options are full-width tap rows. |
| **Accessibility** | Focus trapped, `Esc` closes, focus returns to the trigger. Radio group has legend "Why are you reporting this?". |

Reasons **[C]**: Spam, Fake, Misleading, Inappropriate, Irrelevant. Short plain-language helper text per reason is **[P]** (e.g. Fake: "Seems made up"). Wording needs review since "Fake" is a reporter opinion, not a platform verdict.

**Neutral language [P]:** the dialog states "Reports go to moderators. They check rule-breaking content, not whether the incident is true."

### 4.7 Support / Dispute interaction

See §5.9 for the component. Page-level behaviour is covered in §4.3 and §3.5.

### 4.8 Static help and legal pages — F15

Routes: `/about`, `/how-it-works`, `/guidelines`, `/terms`, `/privacy`, `/contact`.

| | |
|---|---|
| **Purpose** | Explain the product, rules, privacy, and how to request removal. |
| **Layout** | Single column, max 70 characters per line, sticky table of contents on desktop for long pages **[P]**, headings anchored. |
| **Components** | `ProseContainer`, `TableOfContents`, `LanguageNote`, `ContactForm`/details `TBC`. |
| **Actions** | Read, switch language, follow contact route for removal or appeal. |
| **Loading** | Static content: skeleton only for Bangla font swap. |
| **Empty** | n/a |
| **Error** | Content failed to load: retry. |
| **Success** | n/a |
| **Mobile** | Single column; TOC collapses into a "On this page" disclosure. |
| **Accessibility** | Semantic headings, skip link, readable line length, Bangla line height 1.7. |

**Content needs [C]:**
- **Privacy Notice** must state the data table in PRD §12.4 and the pseudonymous actor tracking for moderation.
- **Contact** covers Content Removal Request.
- Legal review required before launch.
- Bangla and English versions required (PRD §19).

`TBC`: whether the Contact page is a form or just contact details. The PRD says "Contact / Content Removal Request details" (§7.2) and does not specify a form or endpoint. No form is designed here.

### 4.9 Generic pages — **[P]**

| Page | Behaviour |
|---|---|
| 404 | "We can't find that page." Links to map and search. |
| Server error | "Something went wrong on our side." Retry and home links. |
| Offline | Banner plus cached shell if available. |

### 4.10 Admin login (`/admin/login`) — F14

| | |
|---|---|
| **Purpose** | Authenticate moderators and Super Admins with email, password, then TOTP. |
| **Layout** | Centred narrow card on a plain background. No public header links or language switch **[P]**. Two stages in the same card: (1) email + password, (2) 6-digit two-factor code. |
| **Components** | `AdminLoginForm`, `PasswordInput` (show/hide), `TotpInput` (6 digit), `ErrorSummary`. |
| **Actions** | Sign in, enter code, back to step 1. |
| **Loading** | Button spinner; inputs disabled. |
| **Empty** | n/a |
| **Error** | Generic message only: "Email, password, or code is incorrect." **[C]** (generic errors). After 5 failed logins: "Too many attempts. Try again in 15 minutes." with lock timer **[C]**. Session expired: "Your session ended. Sign in again." |
| **Success** | Redirect to `/admin` dashboard. |
| **Mobile** | Full-width card; numeric keyboard for code (`inputmode="numeric"`). |
| **Accessibility** | Standard labels; `autocomplete` for password manager on step 1; TOTP `autocomplete="one-time-code"`. |

No "Sign up", "Forgot password", or social login. Two-factor recovery is by Super Admin reset only **[C]**, so the login page has an informational line "Lost your code? Contact a Super Admin." `TBC` whether a password reset exists; the PRD does not define one.

### 4.11 Admin dashboard (`/admin`) — F14

| | |
|---|---|
| **Purpose** | Give moderators an at-a-glance view of work to do. |
| **Layout** | Sidebar + main. Top row: five stat cards. Below: recent audit entries; quick links to oldest open flags **[P]**. |
| **Components** | `AdminShell`, `StatCard`, `RecentAuditList`, `OpenFlagsPreview` **[P]**. |
| **Actions** | Click a card to open the filtered list. Open an audit entry. |
| **Loading** | Card skeletons. |
| **Empty** | Zeroes shown as `0`. Audit list empty: "No recent activity." |
| **Error** | Per-card error with retry; one failing card must not break the page. |
| **Success** | n/a |
| **Mobile/tablet** | Cards in 2 columns (tablet) or 1 (mobile). Sidebar becomes a drawer. |
| **Accessibility** | Cards are links with descriptive names ("Open flags: 12"). |

**Cards [C]** (PRD §10.6): new incidents today, open flags, hidden items, active restrictions, comments today. Recent audit entries.

---

## 5. Incident design

### 5.1 Incident card (list/search/preview) — **[P]** layout, **[C]** content

Content [C] (FR-03.2 preview): title, category, time, area, comment count. Optional (see TBC): Support and Dispute counts.

| Variant | Use | Layout |
|---|---|---|
| `IncidentCard` list | Search results | Category badge top-left, time top-right, title (2 lines max, ellipsis), area line, footer: comment count (and counts if approved). Whole card is one link. |
| `IncidentCard` compact | Map list view, bottom sheet | Single row: category icon tile, title, area · time. |
| `MapPreviewCard` | Map marker tap | Card with category badge, title, area, time, comment count, **View details** button, close button. |

States: default, hover/focus (border darkens, focus ring), pressed, skeleton, loading failed (not shown individually).

- Title is plain text; long titles truncate at 2 lines.
- Times use Dhaka time, e.g. "2 hours ago" with full date in a `title`/tooltip alternative accessible via text `<time>` **[P]**.
- No thumbnail or image (V1 text only **[C]**).

### 5.2 Map marker — **[C]** colour/icon, **[P]** form

| Property | Spec |
|---|---|
| Shape | Circular pin (32 px visual, 44 px hit target) **[P]** |
| Fill | Category colour (§1.4.1) **[C]** |
| Icon | Category icon in white or dark per contrast (§1.4.2) **[C/P]** |
| Outline | 2 px white **[P]** |
| Selected | Larger (40 px), 3 px dark ring, brought to front **[P]** |
| Cluster | Neutral dark circle with count; size steps with count **[P]**. Not category-coloured because it may mix categories. |
| Labels | Accessible name "Road Accident: <title>, <area>" **[C]** intent |
| Focus | Keyboard focus ring visible on marker |

Clustering when markers overlap **[C]** (FR-03.1). Tapping a cluster zooms to its bounds.

### 5.3 Category badge — **[C]/[P]**

| Property | Spec |
|---|---|
| Content | Icon + full category text label |
| Colour use | Colour on icon tile or left accent; text in dark neutral (see §1.4.2) |
| Sizes | `sm` (chips, cards), `md` (details header) |
| Short label | Used only in filter chips (wireframe labels) |
| Interactive? | Not clickable on cards. Clickable chips are a separate component. |

### 5.4 Incident status — public vs private

The PRD has **no verification status** and no truth label **[C]** (FR-08.5, P3). Statuses that exist are moderation statuses:

| Status [C] (PRD §9.1, FR-07.3) | Who sees it | UI |
|---|---|---|
| Published | Everyone (implicit — no badge needed) | No status badge on public pages **[P]**. Published is the normal state. |
| Hidden by moderators | Reporter on Track page. Public sees nothing (item is not listed). | Neutral status card: "Hidden by moderators" + outcome category if any. |
| Removed (deleted) | Reporter on Track page. | "Removed" + outcome category if any. |

Rules **[P]**: no colour-coded "verified/unverified" pills. Status card uses neutral grey/info styling, not red/green. Support and Dispute counts never change the visual treatment of an incident.

### 5.5 Edited indicator — **[C]** (FR-04.3)

| Case | Display |
|---|---|
| Edited by reporter | "Edited" + edit time, near the title, small grey label with clock icon |
| Redacted by moderator | "Edited by moderators" label (public) |
| Posted by team | "Posted by Mamladibe team" label (public, admin API) |

Edit time uses Dhaka time. Labels are text, never colour alone. `TBC`: whether both "Edited" and "Edited by moderators" can show together; design shows both stacked if both apply.
Clicking "Edited" does **not** reveal version history publicly: history is visible only to the reporter (Track) and admins **[C]** (FR-09.4).

### 5.6 Safety tip — **[C]** (FR-04.2, FR-10.1)

- Rendered only if present.
- Own block under the description, with info icon and label **"Reporter-provided safety tip"**.
- Light info background, plain text, up to 500 characters.
- Not styled as official advice. Do not use warning/danger colours.
- On the report form it is optional and sits in step 2.

### 5.7 Tracking ID display — **[C]** content, **[P]** style

| Context | Display |
|---|---|
| Incident URL | `/incident/MD-7K3Q9XTB` (public) |
| Details page | Small line "Report ID: MD-7K3Q9XTB" with Copy button **[P]**. The Tracking ID is public; it alone gives no private access **[C]** (D-08). |
| Credentials screen | Large monospace, Copy/Download |
| Track form | Input with `MD-` prefix helper **[P]** |
| Admin | Shown in incident list/detail, plus short actor ID |

The **secret** is never displayed outside the credentials screen and the Track input **[C]**. Admins never see it **[C]**.

### 5.8 Incident detail layout — see §4.3.

### 5.9 Support / Dispute controls — **[C]** behaviour, **[P]** visual

| Aspect | Spec |
|---|---|
| Form | Two equal-width toggle buttons side by side: **Support** and **Dispute**. Each shows its count. |
| Labels | Visible text "Support" / "Dispute". Counts as "N people support" / "N people dispute" (below or inside the button). |
| States | Inactive, active (filled neutral primary), hover, focus, disabled while saving, error. |
| Colour | Same neutral styling for both. No green/red **[P]**. |
| Interaction | Tap inactive → vote. Tap other → switch. Tap active → remove. |
| Helper text | "Your opinion. This does not verify the report." **[P]** |
| Accessibility | `role="group"` + label "Your opinion on this report"; `aria-pressed`; announce "You support this report. 13 people support." |
| Limits | 30 vote actions per hour per actor; message on limit |

No bars, ratios, or "controversial" labels derived from counts **[C]** (FR-06.4).

### 5.10 Report action — **[C]**

- Tertiary text button "Report" with neutral flag icon, placed after Support/Dispute and Share.
- Opens the dialog (§4.6).
- After reporting: label "Reported" (disabled).
- Count display: FR-04.1 and FR-05.3 say the total flag count is shown on the incident. Show as plain text, e.g. "3 reports", in the metadata line, no badge, no colour **[P]**. `TBC` wording and placement (§11.3).

---

## 6. Comment design

### 6.1 Comment list — **[C]** (FR-13.6)

- Flat list, no replies, newest first, 20 per page.
- Section heading: "Comments (N)".
- Notice near heading: "Community comments, not verified."

**Comment item [P] layout:**

| Part | Content |
|---|---|
| Type badge | One of three types (§6.3) |
| Body | Plain text, preserved line breaks (max 5), long words wrap |
| Meta | Posted time (Dhaka), no author name (no usernames **[C]**) |
| Notice | "Community comment, not verified" (each comment carries it **[C]**, FR-13.2). Shown as small caption; may be collapsed to an icon + tooltip-equivalent text on dense layouts **[P]**, but must remain accessible to screen readers. |
| Actions | Report (flag). Delete (author only, 15 min). |

No avatars, no anonymous ID, no ranking **[C/P]**. Comments never alter Support/Dispute counts or create a status **[C]** (FR-13.9).

### 6.2 Comment form — **[C]**

| Element | Spec |
|---|---|
| Heading | "Add information" |
| Type selector | Required, three options (segmented control or radio cards) |
| Body | Textarea, counter "n / 500", min 5; helper "No links, emails, or phone numbers." |
| Quota line | "N of 5 left today" **[C]** |
| Submit | "Post comment"; disabled until type chosen and body valid |
| CAPTCHA | Turnstile appears inline only when required (risk/IP cap) |
| Line breaks | Max 5; counter warns at limit |

States: idle, valid, sending (spinner), cooldown (button disabled with "Wait 24 s"), quota exhausted (§6.4), error, success.

### 6.3 Comment types — **[C]** (FR-13.2)

| Type | Badge label | Icon **[P]** |
|---|---|---|
| Additional information | "Additional information" | Plus/info |
| Correction / different information | "Correction / different information" | Edit/arrows |
| Personal experience / opinion | "Personal experience / opinion" | Person-speech |

Badges use neutral grey/blue-grey. Do **not** colour "Correction" red or "Additional" green: that would imply truth **[P]**. Type is shown as a badge on every comment.

### 6.4 Daily limit message — **[C]** (FR-13.4)

| State | UI |
|---|---|
| Plenty left | "5 of 5 left today" caption |
| Low (≤ 1) | Caption turns warning style: "1 of 5 left today" |
| Exhausted | Form fields and submit disabled. Message: "You've used all 5 comments for today. You can comment again at 12:00 AM (Dhaka time)." Reset time shown. |
| Server refusal (`QUOTA_EXCEEDED`) | Same message with the reset time from the server |
| Note [C] | Deleted comments still count; tooltip/help text "Deleting a comment doesn't give back a slot." **[P]** |

Quota value comes from the per-actor quota data (PRD lists `GET /me/quota`). Show a skeleton for the counter until loaded; if it fails, hide the counter and let the server enforce **[P]**.

### 6.5 Empty state — **[P]**

"No comments yet. Be the first to add information." with the form visible. No illustration.

### 6.6 Comment report action — **[C]** (FR-13.7)

- "Report" text button on each comment, opens the same dialog with the five reasons.
- PRD API for comment flags takes `reason` only (no note); the dialog hides the note field for comments **[C/P]**.
- Flag counts on comments are visible to **moderators only** **[C]**, so the public UI shows no count; after reporting, only "Reported".

### 6.7 Moderation state — **[C]** (FR-13.10)

| State | Display |
|---|---|
| Published | Normal |
| Hidden by moderators | Placeholder row: "Removed by moderators", no body, no type badge `TBC` (§11.3), neutral grey |
| Redacted | `TBC`: PRD gives no public label for redacted comments (the incident has "Edited by moderators") |
| Parent incident hidden | Comments hidden with it; nothing is shown |
| Deleted by author | `TBC` — PRD does not say whether a placeholder is shown (e.g. "Deleted by author") or the comment disappears; quota still counts |

### 6.8 Author delete — **[C]** (FR-13.8)

- Same actor can delete within 15 minutes. Comments are not editable (no edit button, ever).
- UI: "Delete" text button with remaining time hint "Delete (12 min left)" **[P]**.
- Confirm in a small dialog: "Delete this comment? It will still count toward today's limit."
- `TBC`: how the interface knows a comment belongs to the current actor. The PRD does not list an "is mine" field for comments (it does for the caller's vote/flag state on incidents). Design assumes it is provided; flagged in §11.3.

### 6.9 Pagination / loading — **[C]** 20 per page, cursor; **[P]** UX

- First 20 load with the page (own skeleton).
- **Show more comments** button appends the next 20 (cursor). No infinite scroll (keeps footer reachable, helps accessibility and low bandwidth).
- New own comment is inserted at the top without a refetch.
- Failure: inline "Couldn't load comments. Try again."
- Focus moves to the first newly loaded comment after "Show more" **[P]**.

---

## 7. Admin dashboard design

General admin rules:
- **Desktop-first [P]**; tablet works; mobile gives read access and basic actions `TBC` (§11.3).
- Dense but readable tables: 14 px minimum body inside tables **[P]** (public minimum remains 16 px; the 12.8 px caption is for non-essential text only).
- **Every state-changing action requires a written reason** where the PRD says so (moderation edit, hide, delete, restrict, resolve note) and writes an audit entry **[C]**.
- Admin pages are `noindex`, `no-store` **[C]**; after sign-out, the back button must not reveal data **[P]**.
- Session: 8 h absolute, 30 min idle **[C]**. Show a "Session ends in 2 minutes" dialog with **Stay signed in** **[P]**.
- Admin sees user content as plain text, never HTML **[C]**.
- Admins **never** see secrets, raw IPs, or exact browser tokens **[C]**; do not design any field for them.

### 7.1 Dashboard overview

See §4.11. Cards: new incidents today, open flags, hidden items, active restrictions, comments today; recent audit entries **[C]**.

### 7.2 Incident management — **[C]** content (PRD §10.2, §10.6)

**List:** table with search and filters: status, category, district, date, Tracking ID, actorId.

| Column [P] | Notes |
|---|---|
| Tracking ID | Monospace, link |
| Title | Truncated |
| Category | Badge |
| District | |
| Status | Published / Hidden / Deleted (moderation statuses) |
| Posted | Date/time (Dhaka) |
| Actor | Short ID (first 8 chars) **[C]** |
| Flags | Count |
| Source | Public / Team |

**Detail:** full content, version history, flags, comments, moderation history, actions **[C]**.

| Action | Moderator | Super Admin | UI |
|---|---|---|---|
| Create team incident (labelled "Posted by Mamladibe team") | Yes | Yes | Form reusing the public report fields; label preview. `TBC`: Turnstile and credentials behaviour (§11.3) |
| Moderation edit / redact | Yes | Yes | Edit view with side-by-side diff; reason required; public label "Edited by moderators" |
| Correct category | Yes | Yes | Category selector within moderation edit; reason required |
| Hide / unhide | Yes | Yes | Confirm dialog with reason |
| Soft delete / restore | Yes | Yes | Confirm with reason; notes 30-day recovery |
| Permanent delete | **No** | Yes | Button hidden for moderators; destructive confirm requiring typed Tracking ID and reason **[P]** |

States: loading skeleton rows; empty "No incidents match these filters."; error with retry; success toast + audit confirmation link.

### 7.3 Comment moderation

**List** filters: status, type, flagged **[C]**. Columns: comment excerpt, type badge, incident link, status, posted, actor short ID, flag count.

**Detail:** full text, parent incident link, flags, actions **[C]**.

| Action | Moderator | Super Admin |
|---|---|---|
| Redact text (reason) | Yes | Yes |
| Hide / unhide | Yes | Yes |
| Soft delete | Yes | Yes |
| Permanent delete | No | Yes |
| Create comment | Not allowed | Not allowed |

Flag counts on comments are visible here (moderators only) **[C]**.

### 7.4 Report queue — **[C]**

- Queue of flags for incidents **and** comments (PRD §8.4).
- Sort: oldest open (default) and by count **[C]**. Filter: open / actioned / dismissed, target type **[P]**.
- **Side-by-side layout [C]:** left, target preview (incident or comment, full content and context); right, reasons and notes list and actor history summary; bottom, decision bar.
- **Resolve [C]:** outcome **actioned** or **dismissed** with a note. The moderation action (hide, redact, delete, restrict) is taken separately or from the same panel with its own reason **[P]**.
- **Urgency [C]:** urgent harm (threats, personal data) target 24 h; others 72 h (PRD §10.5). UI: age indicator "Open 2 days" with an overdue marker at 24 h / 72 h; urgent marking method `TBC` (the PRD has no urgent field) — see §11.3.
- Reports cannot be deleted by admins (kept for audit) **[C]**.
- Empty: "No open reports. Nice work." (neutral tone, no confetti) **[P]**.

### 7.5 Anonymous activity investigation — **[C]** (PRD §10.3)

**Entry [C guardrail]:** Opening an actor profile writes an audit entry with the admin and a **reason category**. Design: an interstitial dialog "Why are you opening this profile?" with the reason category selector before the data loads. `TBC`: the list of reason categories (§11.3).

**Search [C]:** by actorId prefix or Tracking ID.

**Profile shows [C]:**
- Short actorId (first 8 characters), first and last seen
- Posts with Tracking IDs and status
- Comments with type and status; today's quota used
- Votes and flags counts; flags the actor filed
- Rate-limit and quota hits
- Restriction state and history
- Moderator notes

**Never shown or stored [C]:** raw IP, name, email, phone, device fingerprint, reporter secret, exact browser token, cross-device linking. Include a permanent banner on the profile: "This ID identifies one browser, not a person." **[C guardrail 1, P wording]**

**Restrict / unrestrict [C]:** limit posting, commenting, and/or voting for a period, with reason; add notes. Form: scope checkboxes (post, comment, vote), duration, reason, confirm. Standard durations `TBC`. Restrictions are time-limited, reasoned, reviewable **[C]** — show expiry date and history.

**Layout [P]:** header with ID + restriction state; tabs or sections: Timeline, Posts, Comments, Flags filed, Limits, Notes.

### 7.6 Admin user management — Super Admin only **[C]**

| Element | Spec |
|---|---|
| List | Email, role, active/inactive, last login |
| Create | Email, role (moderator / super), temporary credential flow `TBC` — PRD says admins are created by a Super Admin, with password min 12 characters and mandatory TOTP; the initial password/enrolment UX is not specified |
| Change role / deactivate / delete | Confirm with reason; audit entry |
| Reset two-factor | Confirm dialog; explains the user must re-enrol |
| Safeguards [P] | Cannot deactivate or demote yourself; the last Super Admin cannot be removed |

Moderators do not see this module **[C]**.

### 7.7 Audit log

- Append-only, read-only table **[C]**. No edit or delete controls anywhere.
- Filters: admin, target, date **[C]**. Columns: time, admin, action, target type/ID, reason, before/after summary.
- Row expands to show before/after summaries side by side.
- Moderator sees **own actions only**; Super Admin sees all **[C]**.
- Retention note in the footer "Kept 2 years" **[P]** (PRD §5.1).

### 7.8 Settings — Super Admin only **[C]**

- Two emergency switches: **Freeze posting**, **Freeze comments**.
- Each toggle opens a confirmation dialog stating the effect and requiring a reason.
- Current state shown as a persistent admin banner when any freeze is active **[P]**.
- Public-facing behaviour of a freeze: `TBC`.

### 7.9 Role-based visibility — summary **[C]** (PRD §10.1)

| Capability | Moderator | Super Admin | UI rule |
|---|---|---|---|
| Dashboard, incidents, comments, reports | Yes | Yes | Visible |
| Tracking ID and actor ID | Yes | Yes | Visible |
| Secrets | Never | Never | No field exists |
| Create team incident | Yes | Yes | Visible |
| Moderation edit/redact | Yes | Yes | Visible |
| Hide/unhide, soft delete/restore | Yes | Yes | Visible |
| Permanent delete | No | Yes | **[P]** hidden for moderators (route still returns forbidden) |
| Resolve flags | Yes | Yes | Visible |
| Restrict/unrestrict actor | Yes | Yes | Visible |
| Manage admin users, reset 2FA | No | Yes | Nav item hidden for moderators |
| Audit log | Own actions | All | Scope label at top of page |
| Platform settings | No | Yes | Nav item hidden for moderators |

If a moderator opens a restricted URL directly, show a "You don't have access to this page" screen (matches `FORBIDDEN`) **[P]**.

---

## 8. Responsive design

### 8.1 Breakpoints — **[P]** (aligned with Tailwind defaults)

| Name | Width | Notes |
|---|---|---|
| Base (mobile) | 360–639 px | Design baseline **[C]** (360 px) |
| `sm` | ≥ 640 px | Large phones, landscape |
| `md` (tablet) | ≥ 768 px | |
| `lg` (desktop) | ≥ 1024 px | |
| `xl` | ≥ 1280 px | Wide desktop; content max width 1280 px |

Supported widths from 360 px **[C]**; reflow down to 320 px is best-effort **[P]**. Browsers: last 2 versions of Chrome, Edge, Firefox, Safari; Android 8+, iOS 14+ **[C]**.

### 8.2 Behaviour by screen size

| Screen | Mobile | Tablet | Desktop |
|---|---|---|---|
| Header | Logo, search icon, language, Report; rest in More menu | Logo, search bar, language, Report | Full header |
| Map home | Full-screen map; chips scroll; bottom sheet for preview/list; FAB Report | Map + collapsible side panel (list) | Map with left list panel (≈ 360 px) **[P]** and floating preview card |
| Report form | One column; crosshair map; sticky action bar | One column, wider | Step 3 two-column (form + map) |
| Incident details | Single column; sticky response bar; mini-map after description | Single column, wider | Two columns |
| Search | List + Filters sheet | Filter column collapsible | Persistent filter column |
| Track | Single column | Single column | Single column, centred |
| Admin | Drawer nav; tables become card lists; read + core actions `TBC` | Collapsible sidebar; horizontal-scroll tables | Fixed sidebar; full tables |

### 8.3 Map and submission usability on mobile — **[C]** requirement

| Concern | Design response **[P]** |
|---|---|
| Fat-finger pin placement | Crosshair-centre mode with **Confirm location**; draggable pin as secondary |
| Map vs page scroll | Map page has no page scroll; on form pages the map area is a fixed-height region (e.g. 50 % viewport) with two-finger pan hint avoided by using a single-finger pan inside the map and an explicit "Done" |
| On-screen keyboard | Sticky bar lifts; focused field scrolls into view |
| One-handed use | Primary actions at the bottom, in reach |
| Weak network | Skeletons; keep last markers on error; retry controls; no blocking spinners over the map |
| Bundle | Map chunk lazy-loaded; initial JS under 250 KB compressed before map chunk **[C]** (PRD §13) |
| Performance | First meaningful map view under 3 s on typical mobile **[C]** |
| Text input | `inputmode`, `autocomplete`, and `enterkeyhint` set appropriately; Bangla keyboards supported |

---

## 9. Design system components

Inventory for React + TypeScript + Tailwind. **This is a naming and behaviour inventory only. No code is provided.** The PRD folder layout `components/ (ui primitives: Button, Badge, Card, Dialog, Toast)` and `features/` is **[C]**; names below are **[P]** except those four primitives.

### 9.1 Design tokens (Tailwind theme extension)

| Group | Tokens |
|---|---|
| Colors | `category.*` (6, §1.4.1), `neutral.*`, `primary.*`, `info/warning/error/success` |
| Font | `sans` (system + Noto Sans Bengali for `bn`), `mono` |
| Font size | caption, body, lead, h2, h1, display |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64 |
| Radius | sm, md, lg, full |
| Shadow | sm, md, lg |
| Breakpoints | sm 640, md 768, lg 1024, xl 1280 |
| Z-index | base, sticky, dropdown, sheet, dialog, toast |
| Motion | duration 150/200 ms; reduced-motion variant |

Design tokens are created in milestone M0 (PRD §16.2), so approval of this document is needed before then.

### 9.2 UI primitives (`components/ui`)

| Component | Variants | States | Notes |
|---|---|---|---|
| `Button` | primary, secondary, tertiary (text), destructive, icon-only | default, hover, focus, active, disabled, loading | Min 44 px height; loading keeps width |
| `IconButton` | — | same | Required accessible name |
| `Badge` | neutral, category, type, status | — | Always icon + text for category |
| `Card` | flat (border), elevated | interactive hover/focus | |
| `Dialog` | standard, destructive confirm | open/closed | Focus trap |
| `BottomSheet` | peek / half / full | drag, open/close | Mobile counterpart to Dialog |
| `Toast` | info, success, error | auto-dismiss 5 s, persistent for errors | Polite live region |
| `Tooltip` | — | — | Never sole carrier of information |
| `Tabs`, `SegmentedControl` | — | selected | Used for comment type, admin sections |
| `Chip` / `FilterChip` | toggle | on/off | `aria-pressed` |
| `Skeleton` | line, card, table row | — | Shimmer disabled for reduced motion |
| `Spinner`, `ProgressBar` | — | — | |
| `Alert` / `Callout` | info, warning, error, success | dismissible optional | Used for notices and warnings |
| `Banner` | offline, freeze (`TBC`), admin freeze | — | |
| `Skeleton`, `EmptyState` | — | — | Text + optional icon |
| `ErrorState` | inline, page | retry | Friendly message mapping §10 |

### 9.3 Form components

| Component | Notes |
|---|---|
| `Field` (label, hint, error wrapper) | Standard wiring for accessibility |
| `TextInput`, `PasswordInput`, `TextArea` | Counter slot |
| `CharacterCounter` | "n / max", thresholds |
| `Select`, `RadioGroup`, `Checkbox` | Native-based where possible |
| `DateTimePicker` | Constrains: not future, within 90 days; Dhaka time |
| `DateRangePicker` | Custom range filter |
| `CategoryPicker` | Six large cards, single select |
| `CopyField` / `CopyButton` | Clipboard + fallback |
| `OtpInput` (TOTP) | 6 digits |
| `TurnstileWidget` | Wrapper with loading and retry |
| `ErrorSummary` | Lists errors, focuses first |

### 9.4 Map components (`features/map`)

| Component | Purpose |
|---|---|
| `MapCanvas` | MapLibre wrapper, URL-synced view |
| `MapMarker`, `ClusterMarker` | §5.2 |
| `MapPreviewCard` | Marker tap preview |
| `LocationPicker` | Pin drop/drag + crosshair mode |
| `NearMeButton`, `UseMyLocationButton` | GPS |
| `ZoomControls` | |
| `MapAttribution` | Required attribution |
| `ZoomInNotice` | "Zoom in to see more" |
| `LocationMiniMap` | Static-ish map on details |
| `MapFallbackNotice` | Tile failure |

### 9.5 Incident and community components

| Component | Purpose |
|---|---|
| `IncidentCard` (list/compact) | §5.1 |
| `CategoryBadge`, `CategoryIcon` | §5.3 |
| `EditedLabel`, `TeamPostLabel` | §5.5 |
| `SafetyTipBlock` | §5.6 |
| `NotVerifiedNotice` | Neutral notice |
| `SupportDisputeControl` | §5.9 |
| `ReportButton`, `ReportDialog` | §4.6 |
| `ShareButton` | Copy link |
| `CommentSection`, `CommentList`, `CommentItem`, `CommentForm`, `CommentTypeBadge`, `CommentTypeSelector`, `QuotaIndicator`, `CommentPlaceholder` | §6 |
| `CredentialsPanel` | §4.2.2 |
| `TrackForm`, `StatusCard`, `EditCountdown`, `QuickEditForm`, `VersionHistoryList` | §4.5 |
| `Stepper` | Report form |
| `SearchInput`, `FilterPanel`, `SortSelect`, `ActiveFilterTags` | §4.4 |

### 9.6 Layout components

`AppHeader`, `AppFooter`, `PageContainer`, `ProseContainer`, `SplitLayout` (map + list), `SkipLink`, `LanguageSwitch`, `CookieNotice`, `OfflineBanner`.

### 9.7 Admin components (`features/admin`)

`AdminShell`, `AdminSidebar`, `AdminTopBar`, `StatCard`, `DataTable` (sortable, filterable, sticky header, row actions), `FilterBar`, `DetailPanel`, `ReasonDialog` (mandatory reason), `DiffView`, `ReportQueueItem`, `ModerationActionBar`, `ActorProfileHeader`, `ActorTimeline`, `RestrictionForm`, `AuditTable`, `RoleGate` (hides/guards UI by role), `SessionTimeoutDialog`, `AccessDenied`.

### 9.8 Internationalisation in components

- All visible strings come from locale files (en, bn) **[C]** (react-i18next).
- No component hard-codes width for text; plural and number formatting use locale rules; Bangla numerals when `bn` **[C]**.
- User-generated content is passed through as plain text and never translated **[C]**.

---

## 10. Content and message patterns

Friendly messages for the error codes in PRD §8.2. Wording is **[P]** (needs review and Bangla translation). Never show raw error text **[C]**.

| Code [C] | Where | Message pattern |
|---|---|---|
| `VALIDATION_ERROR` | Forms | Field-level, specific: "Title must be 5 to 100 characters." Contact details: "Remove personal contact details." **[C]** |
| `RATE_LIMITED` | Any | "You're doing that too often. Try again in N minutes." **[C]** pattern |
| `QUOTA_EXCEEDED` | Comments | "You've used all 5 comments for today. Resets at 12:00 AM (Dhaka time)." |
| `CAPTCHA_REQUIRED` | Post/comment | Show Turnstile inline with "Please confirm you're not a robot." |
| `FORBIDDEN` | Admin | "You don't have access to this." |
| `UNAUTHORIZED` | Admin | "Your session ended. Sign in again." |
| `NOT_FOUND` | Details/track | "This report doesn't exist or is no longer available." (track: generic credentials message) |
| `EDIT_WINDOW_CLOSED` | Track | "The 15-minute edit window has closed. This post is now permanent." |
| `EDIT_LIMIT_REACHED` | Track | "You've used all your edits for this post." `TBC` whether it also covers the 30 % rule (§11.3) |
| `DUPLICATE_ACTION` | Vote/flag | "You've already reported this." |
| `LOCKED` | Track/admin | "Too many attempts. Try again in 15 minutes." |
| `INTERNAL` | Any | "Something went wrong. Please try again." |
| Offline (client) | Any | "You're offline. We'll retry when you're back." **[C]** list item |

**Tone [P]:** plain, short, no blame, no exclamation marks, no humour near safety topics. Reading level suitable for general audience, in English and Bangla.

**Neutral vocabulary [P]:**

| Use | Avoid |
|---|---|
| "report", "incident" | "case", "crime", "victim", "suspect" |
| "people support / people dispute" | "confirmed", "denied", "true", "false", "fact-checked" |
| "community-provided, not verified" | "verified", "official", "trusted" |
| "removed by moderators" | "banned", "punished" |

---

## 11. Design decisions

### 11.1 Confirmed decisions (from the PRD)

| # | Decision | PRD ref |
|---|---|---|
| C1 | No public accounts, login, usernames, or profiles | §2, P1 |
| C2 | Anonymous submission; valid reports publish immediately | P2, FR-01.4 |
| C3 | No truth verdicts; counts are community opinion only | P3, FR-06.4 |
| C4 | No automatic hiding/deletion from report or vote counts | P4, FR-05.3 |
| C5 | Text only; no media upload | FR-01.6 |
| C6 | Comments in V1: flat, no replies, 5/day, types, notice | F13 |
| C7 | Report form is a 4-step page: Category, Details, Location, Review and CAPTCHA, then credentials screen | §7.2, §7.4 |
| C8 | Credentials screen: Copy, Download (.txt), "I have saved these" checkbox, unrecoverable-secret warning | FR-01.5 |
| C9 | Map: MapLibre, OpenFreeMap, clustering, category-coloured markers, category chips, Near me, URL-synced state | F03, §11 |
| C10 | Default map view: whole Bangladesh centred on Dhaka | FR-03.5 |
| C11 | Category colours and marker icons (six) | §7.5 |
| C12 | System font (English), Noto Sans Bengali (Bangla), 16 px base, scale 1.25 | §7.5 |
| C13 | Spacing scale 4/8/12/16/24/32; 44 px touch targets | §7.5 |
| C14 | Colour never sole carrier of meaning | §7.5 |
| C15 | Light theme only in V1 | §7.5 |
| C16 | Mobile-first at 360 px; WCAG 2.1 AA | §7.1 |
| C17 | Incident URL uses Tracking ID | FR-04.5 |
| C18 | Safety tip block labelled "Reporter-provided safety tip" only when present | FR-04.2 |
| C19 | "Edited" label with time; "Edited by moderators" for redaction | FR-04.3 |
| C20 | Neutral "community-provided and not verified" notice | FR-04.4 |
| C21 | Support/Dispute: one active vote, switch, remove | F06 |
| C22 | Flags: five reasons, one per actor, count shown, optional note (200) | F05 |
| C23 | Search/filter set: text, category multi-select, date presets + custom, place; sort Newest/Oldest/Nearest; 20 per page; no verification filter | F08 |
| C24 | Track page content, generic error, 5-failure lock for 15 min | F07 |
| C25 | Quick edit: 15 minutes, 3 edits, 30 % rule; editable and locked fields | F09 |
| C26 | Comment limits: 5/day (Asia/Dhaka), 30 s cooldown, no editing, author delete 15 min, moderator placeholder "Removed by moderators" | F13 |
| C27 | Comment flag counts visible to moderators only | FR-13.7 |
| C28 | Asia/Dhaka times; Bangla numerals in Bangla | FR-16.3 |
| C29 | EN/BN switch, remembered in browser; user content never translated | F16 |
| C30 | First-visit cookie notice; legal pages linked from every footer | FR-15.x |
| C31 | Admin: separate area, email + password + TOTP, 8 h / 30 min session, role matrix, mandatory reasons, audit log, noindex | §10 |
| C32 | Admin never sees secrets, raw IP, or browser tokens; actor view shows short ID (8 chars) | §10.3 |
| C33 | Actor profile open writes an audit entry with a reason category | §10.3 |
| C34 | Moderators do not mark incidents true or false | §10.5 |

### 11.2 Proposed decisions (need approval)

| # | Proposal | Section |
|---|---|---|
| P1 | Visual direction: calm civic tone, flat surfaces, text wordmark placeholder | §1.3 |
| P2 | Neutral palette and blue primary accent | §1.4.3 |
| P3 | Feedback colours; success green never used on content | §1.4.4 |
| P4 | Category colours kept, but never used as text colour; marker outline; icon+label always | §1.4.2 |
| P5 | Type scale tokens, line heights (1.5 / 1.7 Bangla), mono for IDs | §1.5 |
| P6 | Radius, shadow, extra spacing tokens | §1.6–1.8 |
| P7 | Icon style and constraints (no thumbs, ticks, red flags) | §1.9 |
| P8 | Neutral Support/Dispute styling; helper text "does not verify" | §5.9 |
| P9 | Neutral comment type badges (no red/green) | §6.3 |
| P10 | List-view alternative to the map | §4.1 |
| P11 | Mobile bottom sheet for preview; FAB; sticky response bar on details | §4.1, §4.3 |
| P12 | Crosshair "pan map under pin" mode for mobile location picking | §3.3 |
| P13 | "Load more" buttons (not infinite scroll, not page numbers) for search and comments | §4.4, §6.9 |
| P14 | Header search with two suggestion groups (keyword vs place) | §4.4 |
| P15 | Server-time countdowns; announce at limited intervals | §4.5 |
| P16 | Admin desktop-first layout, role-hidden nav, typed-ID confirm for permanent delete, session-timeout dialog | §7 |
| P17 | Breakpoints aligned with Tailwind defaults | §8.1 |
| P18 | Message wording and neutral vocabulary table | §10 |
| P19 | Persistent anonymity note on the report form | §4.2.1 |
| P20 | `.txt` download content | §4.2.2 |

### 11.3 `TO BE CONFIRMED` decisions

Numbered for tracking. Items 1–3 are conflicts between documents; the rest are gaps.

| # | Topic | Detail | Design default until decided |
|---|---|---|---|
| TBC-1 | **Dhaka-first vs nationwide** | The design brief says the first rollout focuses on Dhaka. The PRD says launch scope is all of Bangladesh (D-10, §11.4) with the default view centred on Dhaka. | Follow the PRD (nationwide bounds, Dhaka-centred default). No Dhaka-only restrictions in UI. |
| TBC-2 | **Preview card content** | FR-03.2 lists title, category, time, area, comment count. The wireframe (§7.3) also shows Support and Dispute counts. | Follow FR-03.2; counts not shown on cards. |
| TBC-3 | **Flag count visibility** | FR-04.1/FR-05.3 show the incident's flag count publicly, while FR-13.7 hides comment flag counts to discourage brigading. Public counts could invite pile-on reporting. | Show plain "N reports" on incidents as the PRD says; none on comments. |
| TBC-4 | Hidden / removed incident public URL | PRD does not say what `/incident/:trackingId` shows when the incident is hidden or deleted. | Show the generic "no longer available" page (same as not found). |
| TBC-5 | Deleted / redacted comment display | No public label for author-deleted or moderator-redacted comments. | Author-deleted: removed from list; redacted: show redacted text with no label. Needs decision. |
| TBC-6 | "Is mine" data for comments | UI needs to know which comment the current actor can delete. PRD lists the caller's vote/flag state for incidents only. | Assume available; otherwise hide the Delete control. |
| TBC-7 | Remaining-edits and 30 % feedback | Whether the server returns remaining edit count, and whether `EDIT_LIMIT_REACHED` covers both the 3-edit cap and the 30 % rule. | Generic "edit not allowed" with the rules shown as help text. |
| TBC-8 | Similar-report notice timing | FR-01.7 does not say at which step or by which response the notice arrives. | Show after location pin placement if available, else on submit response. |
| TBC-9 | Public behaviour during freezes | PRD defines admin freeze switches but no public message or error code. | Disable the relevant form with the message "Posting is temporarily paused." |
| TBC-10 | Actor-profile reason categories | PRD requires a reason category but not the list. | Provide a short list: report review, abuse pattern, legal request, other. |
| TBC-11 | Restriction durations | PRD says "for a period". | Presets 24 h, 7 days, 30 days, custom. |
| TBC-12 | Moderation outcome categories | Example "Hidden by moderators: content rule" only. | Use a short list tied to the content rules (§10.5): content rule, personal data, spam, other. |
| TBC-13 | Urgent flag marking | PRD sets 24 h vs 72 h targets but has no field to mark urgency. | Moderator-set label in UI only if a field is approved; otherwise age indicator only. |
| TBC-14 | Team-incident creation details | Turnstile and credentials behaviour for admin-created incidents are not defined. | Form without credentials display; no secret exists for team posts. |
| TBC-15 | Admin account setup UX | Initial password / TOTP enrolment flow is not specified. | Design deferred. |
| TBC-16 | Password reset for admins | Not defined; 2FA reset by Super Admin only. | No "Forgot password" link. |
| TBC-17 | Admin on mobile | PRD gives no admin responsive requirement. | Read access and core actions; full workflow on desktop/tablet. |
| TBC-18 | Contact page format | Form versus details only. | Details only; no form designed. |
| TBC-19 | Logo and brand accent | No brand identity exists. | Text wordmark; blue accent. |
| TBC-20 | Orange/Amber contrast | See §1.4.2. | Keep hex; follow marker/badge mitigations. |
| TBC-21 | Icon library | Not chosen. | Any open-license outline set. |
| TBC-22 | Tracking input normalisation | Whether the secret input accepts lowercase, spaces, or hyphens is a backend rule not stated in the PRD. | UI shows grouped format; does not alter input beyond trimming whitespace. |
| TBC-23 | Bangla copy | All UI strings here are English. Bangla text and terminology (e.g. "Support", "Dispute", "Flag") need native review. | Provide keys only. |
| TBC-24 | Both "Edited" and "Edited by moderators" | Whether both can show together. | Show both, stacked. |
| TBC-25 | Cookie notice wording and Privacy text | Needs legal review (PRD §12.4). | Placeholder text only. |

---

## Appendix A. Documents not reviewed and conflict check

| Item | Status |
|---|---|
| `Mamladibe_PRD_v1_0_Final.pdf` | Read in full |
| `Database.md` | **Not available** in this session. Data references use PRD §9. Any difference must be recorded here and marked `TO BE CONFIRMED`. |
| Other files in `docs/` (incl. nested) | **Not available** |
| Source "V1 Final Feature Specification" (8 Nov 2026) | Referenced by the PRD; not provided |

Recommended follow-up: run the same check against `Database.md` and the `docs/` folder, then update this document and the TBC table.

## Appendix B. PRD traceability (feature → design section)

| Feature | Section |
|---|---|
| F01 Anonymous posting | §3.2, §4.2 |
| F02 Location | §3.3, §3.4, §4.2.1 |
| F03 Map | §4.1, §5.2 |
| F04 Incident details | §4.3, §5 |
| F05 Flags | §3.6, §4.6, §5.10 |
| F06 Support/Dispute | §3.5, §5.9 |
| F07 Tracking | §3.8, §4.5 |
| F08 Search/filter | §4.4 |
| F09 Quick edit | §3.9, §4.5 |
| F10/F11 Safety tips, categories | §4.2.1, §5.3, §5.6 |
| F12 Protections | §10 (messages), §6.4 |
| F13 Comments | §3.7, §6 |
| F14 Admin | §3.11, §4.10, §4.11, §7 |
| F15 Legal pages | §4.8 |
| F16 Bangla/English | §1.5, §9.8 |

## Appendix C. Out of scope for this document

- Frontend code, package installation, or file changes outside `docs/Design.md`.
- New API endpoints, database fields, or product requirements.
- Final visual assets (logo, illustrations), Bangla copywriting, and legal text.
- Dark theme (not in V1 **[C]**).
- Features listed as future scope in PRD Appendix B (images/video, reply threads, notifications, native apps, Community Flagged label).
