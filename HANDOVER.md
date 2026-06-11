# Beer-leaderboard — session handover

Snapshot for resuming development in a fresh chat. Last updated **2026-06-05**.

> Fuller detail lives in the persistent memory note `project_beer_leaderboard_handover.md`
> and the feature backlog in `ROADMAP.md` (repo root). This file is the quick-start.

---

## What this is
A phone-first, installable **PWA leaderboard for a competitive holiday beer-drinking game**.
Live at **https://beer-leaderboard.vercel.app**. Players log a beer (full photo → empty photo),
peers audit it, an admin can rule on challenges, and the board reveals at the end of the trip.

First real-world use will be a trip in **Greece**.

## Stack
- **Next.js 16.2.7** (App Router, Turbopack), React 19, TypeScript, Tailwind v4, framer-motion. Single-page app at route `/`.
- **Supabase**: Postgres + Auth (anonymous) + Storage (private buckets `beer-photos` / `avatars`, signed URLs). RLS everywhere; privileged logic in `SECURITY DEFINER` RPCs. `pg_cron` + `pg_net` for hourly snapshot refresh and push.
- Supabase project ref: `femsgktboyefjxumpvel`. GitHub: `gustafcramer03/beer-leaderboard` (tokenless pushes via Git Credential Manager). Vercel alias: `beer-leaderboard.vercel.app`.

## Repo locations (IMPORTANT — cwd caveat)
- **Repo:** `C:\Users\GustafCramer\beer-leaderboard`
- The shell cwd **resets to** `C:\Users\GustafCramer\OneDrive - CAPNOR\Desktop\Claude` between commands. Glob/Bash default to that folder, **not the repo** — always `Set-Location` into the repo (or use absolute paths), and pass an explicit `path` to the Grep tool.
- Node isn't on PATH by default in a fresh shell: prefix with `$env:Path="C:\Program Files\nodejs;$env:Path"` then use `npx.cmd`.

## Data model (key tables)
- `holidays` (id, name, start/end_date, dark_days, admin_id, invite_code, timezone, forced_state).
- `memberships` (holiday_id, user_id).
- `beers` (id, holiday_id, user_id, full/empty_photo_path, full/empty_taken_at [server-stamped by triggers], claimed_chug, status, score_override, score_override_reason, is_offline, caption, **brand**). Status: open → pending → challenged → confirmed/rejected.
- `reviews` (peer audits), `beer_reactions` (RPC-only), `leaderboard_snapshots` (jsonb), push tables (RPC-only).
- Photo path convention: `{holiday_id}/{beer_id}/{full|empty}.jpg`.

## Scoring (lives in Postgres — keep all readers in sync!)
Per-beer points: base 1; **chug ×2** (only when the logger ticked "I chugged it" — `claimed_chug`; a ≤60s photo gap no longer auto-counts, changed in migration 0038) or **chain ×N** (finishes within 5 min climb a run) — take the higher, they don't stack; then additive **+1** each for **morning** (start 07–10), **happy hour** (one deterministic random hour/day), **early bird** (group's first finish of the day) and **night owl** (group's last finish, only if after midnight). `score_override` beats everything; rejected = 0.
Readers that must agree: `compute_standings`, `user_ledger`, `audit_queue`, `trip_stats`, `pace_series`, `admin_beers` — **plus the UI** (`RuleBook.tsx`, badges in `PlayerLedger.tsx`). If you change scoring, update all of them.
**Unfinished beers (migration 0039):** a beer left unfinished is `status='unfinished'` and contributes `coalesce(score_override, -1)` to points — default −1, or +1 if an admin reinstates it (score_override=1). It never enters `beer_count`/chains/bonuses. This adjust term lives in `compute_standings`, `user_ledger`, `pace_series`, `share_card`, `head_to_head`, `admin_beers`; `trip_stats` inherits it via the snapshot. Declared via `declare_beer_unfinished`; ruled via `admin_rule_unfinished` (uphold/reinstate). Overdue (>90 min, no empty) open beers are surfaced by `overdue_open_beers` for the resolution gate.

## Deploy & migration mechanics
**Tokens are transient and secret — they are NOT stored anywhere. Ask the user for the Supabase + Vercel tokens at the start of the session.**

**Migrations (Supabase Management API):**
- POST `{"query":"<sql>"}` to `https://api.supabase.com/v1/projects/femsgktboyefjxumpvel/database/query` with header `Authorization: Bearer <supabase token>`, `-ContentType "application/json"`. Success = `201`, returns `[]` or rows.
- Save every migration to `supabase/migrations/NNNN_name.sql` first, then apply.
- **EMOJI / NON-ASCII GOTCHA (critical):** `ConvertTo-Json` double-encodes emoji → mojibake in the DB. For any SQL containing emoji/non-ASCII, read with `[System.IO.File]::ReadAllText(path,[Text.Encoding]::UTF8)` and escape char-by-char (`"`→`\"`, `\`→`\\`, control chars → `\b\t\n\f\r`, any code <32 or >126 → `\u`+hex4) into `'{"query":"' + escaped + '"}'`. Plain ASCII SQL can use `@{query=$sql}|ConvertTo-Json`.

**Deploy (CLI deploy from the repo is BLOCKED — git author not a team member; deploy from a no-`.git` copy):**
```powershell
$src="C:\Users\GustafCramer\beer-leaderboard"; $dst="C:\Users\GustafCramer\bl-deploy"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
robocopy $src $dst /E /XD ".git" "node_modules" ".next" ".vercel" /NFL /NDL /NJH /NJS /NP | Out-Null  # exit 1 = success
Copy-Item -Recurse -Force "$src\.vercel" "$dst\.vercel"
$env:Path="C:\Program Files\nodejs;$env:Path"; Set-Location $dst
npx.cmd vercel deploy --prod --yes --token <vercel token>
# verify, then clean up:
Invoke-WebRequest -UseBasicParsing -Method Head https://beer-leaderboard.vercel.app   # expect 200
Remove-Item -Recurse -Force $dst
```
Before deploying: `npx.cmd tsc --noEmit` (exit 0) and ideally `npx.cmd next build`.

**Always commit + push to GitHub after every change** so the repo stays in sync with the live site. Use multiple `-m` flags for commit bodies (the PowerShell here-string `'@` closer is fragile).

## Current state — what's already built & live
Migrations through **0036** are applied. Feature highlights (full list in `ROADMAP.md` / memory note):
- Core log/audit/rule/reveal loop; dark window + grand reveal; admin state control.
- Achievements, pace board, trip stats, head-to-head rivalry, activity feed, daily recap, share card.
- Emoji reactions + captions; pull-to-refresh + optimistic board; "Manage beers" admin screen.
- Push notifications (happy-hour start/end + grand reveal) via cron→pg_net→Vercel route.
- **Drinking heatmap** (0035) — Menu → 🔥.
- **Brand tagging + Beer insights** (0036, newest) — see below.
- **DB-management photo browser** (2026-06-05, migration 0037) — in 🗄️ DB Management, tap a trip →
  tap a member → browse their beers → tap a beer to view its full/empty photos (pinch/double-tap zoom).
  Beer list comes from the password-gated `admin_member_beers` RPC. Photos load via a server route
  **`app/api/admin/photo-urls/route.ts`** that mints signed URLs with the **service-role key**
  (bypasses storage RLS), so it works for **any** trip even when the owner isn't a member. The route
  is gated by the management password (`ADMIN_DB_PASSWORD`, defaults to the `'password'` placeholder).
  **New Vercel env var: `SUPABASE_SERVICE_ROLE_KEY`** (production + preview, server-only — never
  expose client-side). Retrieve it from the Supabase dashboard or `GET /v1/projects/<ref>/api-keys?reveal=true`.
- **Polish & optimisation pass** (2026-06-08, frontend-only — no migration) — perceived-speed wins
  (batched photo signing via `signedUrls` in `lib/api.ts`, audit next-card preload, cached `avatarUrl`,
  visibility-gated polling, lazy images, lazy confetti), consistency (focus rings, `.press` sweep,
  `font-display` on screen titles, active bottom-nav indicator), and intuitive flows (log Step 1/2,
  brand-picker Other chip, audit labels/skeleton + retry-on-fail). **New shared infra:** global toasts —
  `components/Toast.tsx` exports `ToastProvider` (mounted in `AppRoot`) + `useToast()` (`toast(msg,
  "success"|"error"|"info")`); and `components/ErrorBox.tsx` for token-styled error callouts. Reuse these
  rather than re-rolling feedback UI.
- **Frontend refresh** (2026-06-05, frontend-only — no migration) — `next/font` (Fraunces + Plus
  Jakarta Sans) replaces the old Arial fallback; semantic design tokens in `globals.css`
  (surface/text/line/accent, auto-flipping dark mode) + `.card`/`.press` + elevation shadows; faster
  tap/swipe feel; `lib/motion.ts` drives animated tab/menu-view transitions. All components migrated
  onto tokens. **Tailwind v4 note:** fonts use plain `@theme` (so `next/font` runtime vars stay
  live), colour tokens use `@theme inline`; Fraunces needs `weight: "variable"` because it sets the
  `opsz` axis. Restart the dev server after any `@theme` edit.

### Newest feature: brand tagging + beer insights (migration 0036)
- `lib/brands.ts` — canonical catalogue (slug/name/country[Greece|UK|International]/kind/colour) of UK pub staples + Greek beers incl. **Nymfi**; helpers (`getBrand`, `brandColour`, `BRANDS_BY_COUNTRY`, `kindLabel`) and a `LOGO_SLUGS` registry + `hasLogo()`.
- "Colour chip + logo drop-in": `components/BrandBadge.tsx` shows `/brands/{slug}.png` **only if the slug is in `LOGO_SLUGS`** (avoids 404s), else a brand-coloured name pill. **To enable a real logo: drop the PNG in `public/brands/` and add its slug to `LOGO_SLUGS`.**
- `components/BrandPicker.tsx` — optional searchable chip picker, used in both log flows (`LogBeer.tsx` empty step + `OfflineLogBeer.tsx`).
- Brand threaded through `finishBeer` / `logOfflineBeer` (lib/api.ts) and the `user_ledger` / `audit_queue` / `admin_beers` RPCs; badge overlays the full-beer photo corner in `PlayerLedger.tsx` + `AuditDeck.tsx`.
- `components/BeerInsights.tsx` (Menu → 🍻) — group favourite, tagged/brands/tag-rate tallies, most-popular bars, country split, style split. Backed by `beer_insights(holiday)` RPC (pure group aggregate, visible while dark). `getBeerInsights()` + `BeerInsights` type.
- Note: the main trip has ~30 eligible beers but **0 tagged** so far (column is brand-new) — insights shows its empty state until people tag.

## Gotchas to remember
- cwd resets to the Claude desktop folder (see Repo locations).
- Emoji migrations need the manual `\uXXXX` escaper — never `ConvertTo-Json` for non-ASCII SQL.
- Changing a function's argument list creates an overload — **drop the old signature first**. Changing a `RETURNS TABLE` shape needs `drop function` then recreate.
- New scoring only hits the **board** after a snapshot refresh (hourly cron, any new beer/ruling, or manual `select public.refresh_snapshot(id) from public.holidays;`). Ledger/audit/insights compute live.
- Vercel env vars: beware trailing newlines (broke push once). The cron POSTs to the alias, so a fresh `--prod` deploy that repoints the alias is what makes the push path go green.
- Sending push to other users' real devices requires explicit user permission.

## Open / possible next steps (from ROADMAP.md)
- **Trip Wrapped** 🎁 — Spotify-Wrapped-style swipeable end-of-trip recap (reuses existing stats RPCs).
- Various UX-polish and engagement items in `ROADMAP.md`.
- Drop real brand logos into `public/brands/` + register slugs in `LOGO_SLUGS`.
- **Token rotation** — the user wants the Supabase + Vercel tokens rotated once development wraps (not yet done).

## Housekeeping
- Assistant-created "Test" trips may still exist in the DB (used for push/verification).
- DB-management RPCs are gated only by the shared password `'password'` (client + server) — hardening is a possible task.
