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
- [ ] **Head-to-head / rivalry card** ⚔️ — tap two players to compare totals, chugs, fastest
  chug, bonus tallies side by side. _Mostly frontend if it reuses ledger/stats data._
- [x] **Pace projection board** 📈 — _SHIPPED_. Full-page line charts: cumulative beers/points
  drawn solid up to today, dashed projection to trip end at current daily pace. Group chart
  (red Beers + blue Points) and a per-player chart (one colour each, 🍺/🎯 toggle, tap a line
  for now/projected totals). Migration 0017 (`pace_series`) + `PaceBoard.tsx`. _Future: also a
  "+3 today" momentum chip/sparkline inline on the board itself._

## ✨ UX polish (cheap, high "easier to use")

- [ ] **Haptics + confetti on key moments** 🎉 — confetti on logging a beer, bagging Early
  Bird/Night Owl, or overtaking someone; `navigator.vibrate()` on log/swipe. _Frontend-only._
- [ ] **Pull-to-refresh + optimistic board** — manual refresh gesture so people don't wait for
  the hourly cron, plus an optimistic "+1" the moment a beer is logged. _Frontend-only._
- [ ] **"Your position" sticky chip** — sticky footer showing your own rank on a long board.
  _Frontend-only._
- [ ] **Empty/loading states with personality** — extend the Stats-tab warmth to an empty board,
  empty audit queue ("All caught up — go drink 🍺"), and skeleton loaders. _Frontend-only._
- [ ] **Share card generator** 📲 — "Share my stats" button rendering a branded image (canvas)
  of your rank/beers/best chug for the group chat. _Frontend (Web Share files API already wired)._

## 🔔 Utility / stickiness

- [ ] **Push notifications** — "Happy hour starts now ⏰", "You've got beers to audit", "Someone
  challenged your beer", "Grand reveal is live". Biggest retention lever, heaviest lift.
  _Needs web-push keys, a subscription table, and a sender._
- [ ] **Daily recap** 🌅 — once-a-day summary card on first open (yesterday's winner, total sunk,
  Early Bird/Night Owl winners). _Reuses stats-style data._
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
