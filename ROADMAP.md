# Beer Leaderboard — Feature Roadmap

Ideas to work through over the coming days. Grouped by theme; each notes whether it's
frontend-only or needs a Postgres function/migration. Tick items off as they ship.

---

## 🎯 Engagement & fun

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

## ✨ UX polish (cheap, high "easier to use")

- [x] **Haptics + confetti on key moments** 🎉 — _SHIPPED_. `canvas-confetti` + Web Vibration API
  via `lib/celebrate.ts`. Confetti on every beer logged (online + offline), with a **bigger golden
  burst** (centre blast + two side cannons) when a chug is claimed; a sustained 1s shower on the
  **grand reveal** (champion unveiled) and the **Legend of the Day** popup. Haptics fire only on
  those two big moments (`vibrate([60,40,120])`); silently no-ops on iOS Safari. _Future picks left
  on the table: confetti/haptics on audit swipes and on overtaking someone (needs rank tracking)._
- [ ] **Pull-to-refresh + optimistic board** — manual refresh gesture so people don't wait for
  the hourly cron, plus an optimistic "+1" the moment a beer is logged. _Frontend-only._
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

- [~] **Push notifications** — _PHASE 1 SHIPPED (happy-hour start & end only)_ (migration 0028).
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
  challenge-on-your-beer, grand-reveal-live._
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

## 🛠️ Admin niceties

- [ ] **Invite via QR / share link** — faster onboarding than typing the invite code.
- [ ] **Admin "adjust score" with reason** — store a short note alongside `score_override` so the
  _Adjusted ✎_ badge can show *why* on tap. _Small migration (add a column) + UI._

---

_What's left, by effort-to-payoff: **pull-to-refresh + optimistic board** is the cheap frontend win.
**Push notifications** phase 1 (happy-hour start/end) is live; later phases (audit nudges,
challenge alerts, grand-reveal) reuse the same pipeline. **Invite via QR / share link** and
**admin "adjust score" with reason** round out the admin niceties._
