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
- [ ] **Live activity feed / "what's happening"** 📰 — reverse-chron ticker ("🍺 Anna sank her
  4th… 🐦 Tom grabbed Early Bird… 🔥 Sam's on a 3-chain!"). Makes the trip feel alive between
  board refreshes. _Needs a small RPC over recent `beers` rows + frontend list._
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
- [ ] **Empty/loading states with personality** — extend the Stats-tab warmth to an empty board,
  empty audit queue ("All caught up — go drink 🍺"), and skeleton loaders. _Frontend-only._
- [ ] **Share card generator** 📲 — "Share my stats" button rendering a branded image (canvas)
  of your rank/beers/best chug for the group chat. _Frontend (Web Share files API already wired)._

- [x] **Dark-mode reveal countdown** ⏳ — _SHIPPED_ (migration 0020). The "board has gone dark"
  screen now shows a live days/hrs/min/sec countdown to the grand reveal. `get_latest_standings`
  returns `reveal_at` (midnight of `end_date` in the trip's timezone); `RevealCountdown` in
  `Leaderboard.tsx` ticks every second and flips to "reveal is imminent" once it passes.

## 🔔 Utility / stickiness

- [ ] **Push notifications** — "Happy hour starts now ⏰", "You've got beers to audit", "Someone
  challenged your beer", "Grand reveal is live". Biggest retention lever, heaviest lift.
  _Needs web-push keys, a subscription table, and a sender._
- [x] **Legend of the Day** 👑 — _SHIPPED_ (migration 0022). Once-a-day popup on first open
  crowning whoever sank the most beers yesterday — profile photo, name and beer count. Day is
  resolved in the trip timezone; the `legend_of_the_day` RPC returns the celebrated day plus the
  current day, and the client gates the popup once-per-day in localStorage on the server's `today`.
  Withheld during the dark finale so it doesn't leak the leader. (Distinct from the trophy of the
  same name in the cabinet.) `LegendOfTheDay.tsx`.
- [ ] **Daily recap** 🌅 — once-a-day summary card on first open (yesterday's winner, total sunk,
  Early Bird/Night Owl winners). _Reuses stats-style data; Legend of the Day is the first slice._
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

_Best effort-to-payoff picks: confetti/haptics + audit-count badge for instant polish, then the
activity feed or achievements as the next "fun" headline feature (slot into the RPC-per-view
pattern)._
