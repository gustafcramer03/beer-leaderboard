# Beer Leaderboard — Feature Roadmap

Ideas to work through over the coming days. Grouped by theme; each notes whether it's
frontend-only or needs a Postgres function/migration. Tick items off as they ship.

---

## 🎯 Engagement & fun

- [x] **Trip activity window** ⏱️ — _SHIPPED_ (migration 0041). Beers can only be logged while the trip is
  actually on. Added a `start_time` (alongside `end_time`); uploads are blocked before start and after end
  (server-enforced in the insert trigger, online + offline), with a friendly "trip hasn't started / trip's
  over" screen on the log tab. Create a group early so people can join, but logging only opens at the start.
  Times are picked in the create form and editable in the admin controls; they gate uploads + the reveal
  only — the 7am–7am beer-day stats are unchanged. Finishing an in-progress beer stays allowed.
- [x] **Daily tally** 📊 — _SHIPPED_ (migration 0040). Menu → 📊: a grouped bar chart of your beers
  finished each day next to the group average for that day, for every beer-day from trip start to today
  (7am–7am boundary). Tap a day for exact numbers; readout shows your trip total + your/group beers-per-day.
  Group aggregate + own data, so visible while dark. `daily_bars(holiday)` RPC + `DailyBars.tsx`.
- [x] **Unfinished-beer penalty** 🏳️ — _SHIPPED_ (migration 0039). A beer left unfinished costs −1 (not
  0). Never auto-applied: a started beer with no empty photo after 90 min triggers a blocking resolution
  gate on next app open — "I finished it" (resume the empty upload) or "I didn't" (−1 + a note, with a
  cheeky confirm); there's also an "I didn't finish this beer" button on the empty-photo step. Declared
  ones are raised to the admin Rulings panel as "Unfinished beer?" cards — uphold the −1 or reinstate +1.
  The −1 lands optimistically and is reversed if reinstated. Accounting: status='unfinished' contributes
  `coalesce(score_override,-1)`, never touching beer counts/chains. `declare_beer_unfinished` /
  `admin_rule_unfinished` / `overdue_open_beers` RPCs; the adjust term spans all points readers.
- [x] **Emoji reactions on beers** 🔥 — _SHIPPED_ (migration 0030). WhatsApp-style one-tap emoji
  (🍺🔥💪😂😮🤮) on a mate's beer in the player ledger — exactly one reaction per person per beer
  (tap a new one to replace, tap the same to remove); existing reactions show as counted pills with
  your own ringed, and a "🙂+" trigger pops the picker. Stored in an RLS-locked `beer_reactions`
  table reached only via the `react_to_beer` RPC (returns the fresh `{counts, mine}` aggregate) and
  read back through `user_ledger`. `PlayerLedger.tsx` + `lib/reactions.ts`.
- [x] **Captions on beer submissions** 💬 — _SHIPPED_ (migration 0030). An optional ≤140-char note
  attached when logging (online via `finishBeer`, offline via the `log_offline_beer` RPC), shown
  italicised in the player ledger and on the audit-deck card so reviewers see it. `beers.caption`
  column; surfaced by `user_ledger` + `audit_queue`. `LogBeer.tsx`, `OfflineLogBeer.tsx`,
  `AuditDeck.tsx`, `PlayerLedger.tsx`.
- [x] **Achievements / trophy cabinet** 🏆 — _SHIPPED_. Snapchat-trophies-style 3×N grid
  of trophies a player has won, each with an emoji, a one-line "how it's won", and a count
  (e.g. `2× Centurion` = 200 beers). Includes **Legend of the Day** (most beers in a single
  day). Lives in the new bottom-ribbon **Menu**. Migration 0016 (`user_achievements`) +
  `AchievementsCabinet.tsx`.
- [x] **Live activity feed / "what's happening"** 📰 — _SHIPPED_ (migration 0025). Menu → "What's
  happening": reverse-chron ticker of only the *bigger* moments — chugs ⚡, Early Bird 🐦, Night Owl
  🌙, happy-hour window banners 🍻 ("GO QUENCH YOUR THIRST" at the start, then a beers-sunk tally at
  the end), completed 3+ chains 🔥 (with final length), per-day milestones (10th
  then every 5th) 🍺, per-trip milestones (10th, 25th & every 25th) 🏅, lead changes 👑, Legend of
  the Day 🏆, and first blood 🩸 (the trip's very first beer). `activity_feed(holiday, limit)` RPC
  derives events on the fly from `beers`, reusing the exact `compute_standings` scoring so "took the
  lead" matches the board; polls every 45s + on focus. Withheld while the board is dark for
  non-admins. `ActivityFeed.tsx`.
- [x] **Profile photos** 📸 — _SHIPPED_ (migration 0021). Optional selfie/library photo at
  sign-up, square-cropped + compressed client-side to a ~256px JPEG, stored in a private
  `avatars` bucket at `{uid}/avatar.jpg` and read via signed URLs. `profiles.avatar_path` holds
  it; accounts without one fall back to a bundled static Lorax (`public/default-avatar.png`, zero
  storage; `public/default-avatar.jpg`). Reusable `Avatar.tsx`; editable from the Menu profile
  card (covers existing accounts).
  Foundation for the rivalry cards below.
- [x] **Head-to-head / rivalry card** ⚔️ — _SHIPPED_ (migration 0024). Menu → "Head to head":
  pick any two players and see their stats side by side — points, beers, chugs, fastest chug,
  longest chain, morning/happy-hour/early-bird/night-owl tallies, active days — the stronger
  value in green and the weaker in red, with each player's avatar and an overall "leads N–M"
  crown. `head_to_head` RPC reuses the exact `compute_standings` scoring so points match the
  board; `holiday_members` feeds the picker. Withheld while the board is dark. `RivalryCard.tsx`.
- [x] **Pace projection board** 📈 — _SHIPPED_. Full-page line charts: cumulative beers/points
  drawn solid up to today, dashed projection to trip end at current daily pace. Group chart
  (red Beers + blue Points) and a per-player chart (one colour each, 🍺/🎯 toggle, tap a line
  for now/projected totals). Migration 0017 (`pace_series`) + `PaceBoard.tsx`. _Future: also a
  "+3 today" momentum chip/sparkline inline on the board itself._

### Brainstormed 2026-06-04 — not yet started

- [ ] **Streaks** 🔥 — consecutive beer-days with at least one beer logged; a flame count on your
  row plus a "don't break the chain" nudge. _Needs a scoring/RPC addition (derive per-player day runs)._
- [ ] **Teams / squads** — split a trip into 2+ teams (Reds vs Blues) with a team total shown
  alongside the individual board. _Needs migration (team membership) + standings aggregation._
- [ ] **Predictions market** — each morning players predict the day's Legend or the trip champion;
  correct calls earn bragging-only "oracle points". _Needs migration (predictions table + resolution)._
- [ ] **Bounties / dares** — admin (or anyone) posts a challenge ("finish a chug before noon", "a
  beer in every bar"); completers claim bonus points. _Needs migration (bounties + claims/approval)._
- [ ] **Surprise power hour** — admin fires a live double-points window on demand, distinct from the
  scheduled happy hour. _Needs migration (ad-hoc window) + scoring hook + optional push._
- [ ] **"Who's catching you"** — an inline board chip showing the gap to your nearest rivals
  ("Erik is 2 beers behind you"). _Frontend-only (derive from the standings already loaded)._
- [ ] **Beer wall / photo gallery** 🖼️ — every beer photo in a scrollable grid as the trip's visual
  diary. _Mostly frontend (signed URLs); maybe a lightweight listing RPC; gate while dark._
- [ ] **Trip Wrapped** 🎁 — a Spotify-Wrapped-style swipeable end-of-trip recap (totals, biggest day,
  fastest chug, rival, a superlative). _Reuses existing stats RPCs; new full-screen reveal-time view._
- [x] **Drinking heatmap** 🔥 — _SHIPPED_ (migration 0035). Menu → "Drinking heatmap": a day × hour
  grid of beer counts in the trip's local timezone, keyed on when each beer was cracked
  (`full_taken_at`); cell darkness ramps with intensity, tap a cell for its exact count, and a
  readout calls out the busiest hour. `heatmap_data` RPC is a pure group aggregate (no per-player
  data) so it shows even while the board is dark, like `trip_stats` group totals. `DrinkingHeatmap.tsx`.
- [x] **Brand / type tagging + Beer insights** 🍻 — _SHIPPED_ (migration 0036). Optional brand picker
  in both log flows (online + offline) drawn from a catalogue of UK pub staples + Greek beers
  (incl. Nymfi) in `lib/brands.ts`. Brand marks render as "colour chip + logo drop-in": `BrandBadge`
  shows `/brands/{slug}.png` once the slug is registered in `LOGO_SLUGS`, else a brand-coloured name
  pill (no copyrighted logos ship by default). Badges overlay the full-beer photo in the ledger and
  audit deck. New Menu → "Beer insights" tab (`BeerInsights.tsx`): per-brand popularity bars, country
  split, style split — backed by the `beer_insights` RPC (pure group aggregate, visible while dark).
  Brand threaded through `log_offline_beer`/`user_ledger`/`audit_queue`/`admin_beers`.
  _To light up a real logo: drop the PNG in `public/brands/` and add its slug to `LOGO_SLUGS`._

## ✨ UX polish (cheap, high "easier to use")

- [x] **Polish & optimisation pass** ✨ — _SHIPPED_ (2026-06-08). Perceived speed: batch beer-photo
  signing (`signedUrls`), audit deck preloads the next card's photos, in-memory avatar-URL cache,
  polling pauses while the tab is hidden (activity feed + nav badges) and the board's quiet refetch is
  rate-guarded, `loading="lazy"`/`decoding="async"` on photos, and `canvas-confetti` lazy-loads on first
  use. Crispness: keyboard `:focus-visible` ring, finished the `.press` sweep, `font-display` on all
  screen/modal titles, unified photo radii, and a clear active **bottom-nav** indicator (accent pill +
  weight + `aria-current`, `<nav>` landmark). Intuitive: log flow shows a **Step 1/2** indicator + clearer
  button labels + success copy, the brand picker surfaces an explicit **Other** chip on no-match, the audit
  deck shows the LEGIT/CHALLENGE labels at rest + a photo skeleton + no longer silently skips a failed
  vote, and a reusable token-styled `ErrorBox` replaced the ad-hoc red boxes (which broke in dark mode).
  New: a lightweight global **toast** system (`components/Toast.tsx`, `useToast()`) wired into beer-logged,
  log/audit errors, admin rulings/score, and DB-management actions.
- [x] **Frontend refresh — typography, tokens, depth + motion** ✨ — _SHIPPED_ (2026-06-05).
  Wired `next/font` (Fraunces display + Plus Jakarta Sans body) onto `<html>`, replacing the silent
  Arial fallback. Added a semantic design-token layer in `globals.css` (`surface`/`text`/`line`/
  `accent` families with auto-flipping dark mode), elevation shadows (`shadow-card`/`-raise`/`-nav`),
  `rounded-card` radius, and `.card`/`.press` component classes. Input feel: `touch-action:
  manipulation`, tap-highlight off, `.press` tap feedback, `will-change` on the swipe card, lighter
  swipe-commit velocity. Motion: `lib/motion.ts` + animated tab switches and slide-up menu views
  (board stays mounted to preserve optimistic state). All 30 components migrated off raw
  `amber-*`/`neutral-*` onto tokens, light + dark, keeping deliberate celebration gradients and
  canvas colours.
- [x] **Haptics + confetti on key moments** 🎉 — _SHIPPED_. `canvas-confetti` + Web Vibration API
  via `lib/celebrate.ts`. Confetti on every beer logged (online + offline), with a **bigger golden
  burst** (centre blast + two side cannons) when a chug is claimed; a sustained 1s shower on the
  **grand reveal** (champion unveiled) and the **Legend of the Day** popup. Haptics fire only on
  those two big moments (`vibrate([60,40,120])`); silently no-ops on iOS Safari. _Future picks left
  on the table: confetti/haptics on audit swipes and on overtaking someone (needs rank tracking)._
- [x] **Pull-to-refresh + optimistic board** — _SHIPPED_. Pull down on the board to force a fresh
  snapshot (`refresh_snapshot` is member-callable) — a rubber-band 🍺 indicator damps the drag and
  fires past a 60px threshold. Logging a beer now bumps your own row by **+1 beer / +1 pt instantly**
  (pending beers already count in `compute_standings`), re-sorted with the board's exact ordering, then
  a background `reconcile()` refreshes the snapshot and clears the overlay (a chug/chain may be worth
  more, so the truth wins). The board stays mounted across tabs (hidden wrapper) so the optimistic
  state survives, and re-activating the board tab quietly re-fetches without a skeleton flash.
  `Leaderboard.tsx` (logSignal/refreshSignal/active props, `applyOptimistic`, `reconcile`) +
  `HolidayHub.tsx` (touch handlers, signals). _Frontend-only._
- [x] **"Your position" sticky chip** — _SHIPPED_. A clone of your own row styled like the amber
  highlighted row that pins to the top edge (`top-2`) when your row has scrolled above the
  viewport and to the bottom edge above the nav (`bottom-24`) when it's below; hidden while your
  real row is visible. Tap to smooth-scroll back to it. IntersectionObserver on the user's `<li>`
  decides top vs bottom from `boundingClientRect.top` vs `rootBounds.top` (negative bottom
  `rootMargin` so a row hidden behind the nav counts as off-screen). `Leaderboard.tsx`,
  frontend-only.
- [x] **Empty/loading states with personality** — _SHIPPED_. Shared `Loading.tsx`: a bouncing-🍺
  spinner with a random bartender pun ("Pouring the standings…", "Counting the empties…"), plus
  `SkeletonRows`/`SkeletonCards` pulse placeholders. The board now shows shaped skeleton rows on
  first load and the activity feed shows skeleton cards; every other view (stats, pace, trophies,
  head-to-head, rulings, holiday picker, hub gate, boot screen) swaps its bare "Loading…" for a
  context-specific witty line. Empty states already had warmth (e.g. "No beers logged yet. Be the
  first! 🍺"). _Frontend-only._
- [x] **Share card generator** 📲 — _SHIPPED_ (migration 0027). Menu → "Share card": renders your
  headline stats to a 1080×1920 (Instagram-story) canvas — avatar, trip name, big rank "#N of M",
  beers + points, plus fastest-chug ⚡ / longest-chain 🔥 / active-days 🌅 chips on a warm amber→stout
  gradient. "Share to story" hands the PNG to the native share sheet via the Web Share **files** API
  (`navigator.canShare({files})`), so it drops straight into Instagram → Story; falls back to a
  download on desktop. `share_card` RPC reuses the exact `compute_standings` scoring (rank ordered
  like the board: points desc, beers desc) and is withheld while dark so the rank can't leak. Avatar
  is loaded CORS-clean (initials fallback) to keep the canvas exportable. `ShareCard.tsx`.

- [x] **Dark-mode reveal countdown** ⏳ — _SHIPPED_ (migration 0020). The "board has gone dark"
  screen now shows a live days/hrs/min/sec countdown to the grand reveal. `get_latest_standings`
  returns `reveal_at` (midnight of `end_date` in the trip's timezone); `RevealCountdown` in
  `Leaderboard.tsx` ticks every second and flips to "reveal is imminent" once it passes.

## 🔔 Utility / stickiness

- [~] **Push notifications** — _PHASE 1 SHIPPED (happy-hour start & end, migration 0028); PHASE 2 SHIPPED (grand reveal, migration 0034)_.
  Web Push (VAPID) with no new always-on server: the existing hourly `pg_cron` runs
  `dispatch_happy_hour_push()`, which calls `happy_hour_push_due()` to find any happy-hour
  boundary landing in the current hour (per holiday, in its tz), logs it once in `push_sent_log`
  so it can't double-fire, gathers every member's device subscription, and `net.http_post`s the
  payload (via `pg_net`) to `/api/push/happy-hour` on Vercel. That Node route validates a shared
  secret (`x-push-secret`) and signs+sends each notification with the `web-push` library. Devices
  register via `save_push_subscription`/`delete_push_subscription` RPCs (RLS-locked tables; one row
  per push endpoint). Start fires "🍻 happy hour is ON … GO QUENCH YOUR THIRST!"; end fires a
  beers-sunk tally. Client: `lib/push.ts` (subscribe/unsubscribe, hardcoded public VAPID key),
  `components/PushToggle.tsx` in the Menu (iOS needs Add-to-Home-Screen; nudges accordingly), and
  `push`/`notificationclick` handlers in `public/sw.js`. _Future phases: beers-to-audit,
  challenge-on-your-beer._
- [x] **Grand-reveal push** 🏆 — _SHIPPED_ (migration 0034). When a trip flips into reveal state
  (the clock crossing `end_date + end_time`, or the admin forcing it via "End the trip"), every
  member gets a one-off "🏆 The Grand Reveal!" push nudging them to open the app and see who's top
  of the hops. Reuses the phase-1 pipeline: `reveal_push_due()` (dedup kind `'reveal'`, logged only
  once at least one device is subscribed so it retries while nobody's signed up) feeds the unified
  `dispatch_push()`, and `set_holiday_state` fires it immediately on a forced reveal. Verified live.
- [x] **Legend of the Day** 👑 — _SHIPPED_ (migration 0022). Once-a-day popup on first open
  crowning whoever sank the most beers yesterday — profile photo, name and beer count. Day is
  resolved in the trip timezone; the `legend_of_the_day` RPC returns the celebrated day plus the
  current day, and the client gates the popup once-per-day in localStorage on the server's `today`.
  Withheld during the dark finale so it doesn't leak the leader. (Distinct from the trophy of the
  same name in the cabinet.) `LegendOfTheDay.tsx`.
- [x] **Daily recap** 🌅 — _SHIPPED_ (migration 0026). Once-a-day wrap-up of the beer-day that just
  ended (07:00→07:00 in the trip tz): total beers sunk, the **Legend of the Day** champion, plus
  Early Bird 🐦, Night Owl 🌙, Fastest Chug ⚡ and Longest Chain 🔥 honours. Auto-pops on first open
  each day (confetti + gated in localStorage on the server's `today`) **and** lives in the Menu →
  "Daily recap" for on-demand viewing. `daily_recap` RPC reuses the exact chug/chain/finisher logic
  from `compute_standings`; withheld while the board is dark and null on dry days. Replaces the old
  standalone Legend-of-the-Day popup (the cabinet trophy of the same name stays). `DailyRecap.tsx`.
- [x] **Audit + rulings nudge badges** — _SHIPPED_. Red count bubbles on the 🔄 Audit beers tile
  (mates' beers waiting to swipe) and, for the admin, the ⚖️ Rulings tile (beers awaiting a
  ruling); the ☰ Menu bottom-nav tab shows the combined total. Polls every 60s and on window
  focus so new beers/challenges surface without forcing the audit gate. `HolidayHub.tsx`, reuses
  `getAuditQueue` + `challengedBeers`.
- [x] **Rulings are final** — _SHIPPED_ (migration 0019). A beer reaches the admin only the first
  time it's challenged; once ruled (uphold / reject / set score) it's stamped `admin_ruled_at` and
  a later challenge can never re-escalate it. Players still audit every beer; admin reviews once.

### Brainstormed 2026-06-04 — not yet started

- [ ] **Round tracker** — a "whose round is it?" rotation so the group knows who's buying next.
  _Needs migration (rotation state) + simple UI._
- [ ] **Hydration / pace nudge** 💧 — an optional gentle "grab a water" push after N beers in M
  hours. _Reuses the push pipeline; needs a per-user rate check + opt-in setting._
- [ ] **"Done for the night" status** — flag yourself out so you're hidden from the active-race
  chips ("who's catching you" etc.). _Frontend + a small per-user status flag._

## 🛠️ Admin niceties

- [ ] **Invite via QR / share link** — faster onboarding than typing the invite code.
- [ ] **Co-admins** — let the admin promote a second admin to share the audit/rulings load.
  _Needs migration (multiple admins per holiday) + admin-check updates across RPCs._
- [ ] **Configurable scoring** — admin sets bonus values (chug multiplier, happy-hour points, etc.)
  per trip rather than hard-coded. _Larger: needs a per-holiday scoring-config table threaded through
  every scoring function — keep all readers in sync._
- [x] **Admin "adjust score" with reason** — _SHIPPED_ (migration 0029). The admin's "Set score ✎"
  ruling now takes an optional note (≤200 chars) stored in `beers.score_override_reason` alongside
  `score_override`; `admin_set_beer_score(beer, points, reason)` persists it and `admin_rule_beer`
  (uphold/reject) clears it with the override. `user_ledger` returns `override_reason`, and tapping
  an _Adjusted ✎_ beer in the player ledger reveals the reason above the photos. `AdminQueue.tsx`
  (reason input) + `PlayerLedger.tsx`.

---

_What's left, by effort-to-payoff: cheapest wins are the frontend-only ideas — **"who's catching
you"**, **"done for the night"**, **beer wall**, and **Trip Wrapped** (reuses existing stats RPCs).
**Invite via QR / share link** remains the easy admin nicety. The richer competition mechanics
(**streaks**, **teams**, **predictions**, **bounties**, **surprise power hour**) and **configurable
scoring** each need a migration. **Push notifications** phase 1 (happy-hour) and phase 2 (grand
reveal) are live; remaining phases (audit nudges, challenge alerts, hydration nudge) reuse the same
pipeline. The 2026-06-04 brainstorm batch is now captured under each section's "Brainstormed" heading._
