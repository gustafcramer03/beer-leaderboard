"use client";

// The in-app rulebook: how to play, how auditing works, and how scoring is
// calculated. Opened from the 📖 button on the leaderboard.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-bold text-accent">{title}</h3>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
  );
}

export function RuleBook({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="text-lg font-bold">📖 How the game works</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-md flex-col gap-6">
          <Section title="🍻 The game">
            <p>
              It&apos;s a friendly drinking competition for the trip. Every beer you log earns
              points, and the leaderboard tracks who&apos;s ahead. The most points by the final day
              wins — simple as that.
            </p>
            <p>
              It runs on the honour system, kept fair by your mates: everyone reviews everyone
              else&apos;s beers (see <span className="font-semibold">Auditing</span> below).
            </p>
          </Section>

          <Section title="🍺 Logging a beer">
            <p>Tap the big 🍺 button at the bottom. Logging a beer takes two photos:</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                <span className="font-semibold">Full photo</span> — snap the beer at the start, full
                and untouched.
              </li>
              <li>
                <span className="font-semibold">Empty photo</span> — snap the empty glass once
                you&apos;re done.
              </li>
            </ol>
            <p>
              The app stamps the time of each photo, so the gap between them is your drinking time.
              Tick <span className="font-semibold">&quot;I chugged it&quot;</span> if you downed it
              in one — that&apos;s worth more points (see scoring).
            </p>
            <p>
              No signal (on a boat, plane, up a mountain)? Use{" "}
              <span className="font-semibold">🛜 Log offline beer</span> — pick the full and empty
              photos from your camera roll later and the app reads the capture times from the
              photos. Offline beers are flagged 🛜 so reviewers know.
            </p>
          </Section>

          <Section title="⚖️ Auditing & challenges">
            <p>
              Before you can log your own beer, you must first audit any of your mates&apos; beers
              waiting for review. You&apos;ll see each beer as a card with both photos — swipe to
              judge it:
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <Badge label="Swipe right = legit ✓" cls="bg-green-100 text-green-700" />
              <Badge label="Swipe left = challenge ✕" cls="bg-red-100 text-red-700" />
            </p>
            <p>
              If you reckon a beer is dodgy (faked, not really finished, not actually chugged), swipe
              left to <span className="font-semibold">challenge</span> it. A challenged beer is sent
              to the <span className="font-semibold">admin</span> for a ruling.
            </p>
            <p>The admin then decides, on the ⚖️ Rulings tab, one of three things:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <span className="font-semibold">Uphold</span> — the beer&apos;s legit and keeps its
                normal score.
              </li>
              <li>
                <span className="font-semibold">Reject</span> — the beer doesn&apos;t count and
                scores 0.
              </li>
              <li>
                <span className="font-semibold">Set score</span> — accept the beer but adjust its
                points by hand (e.g. it was finished but the chug was a fib, so the admin strips the
                bonus). Adjusted beers show an{" "}
                <Badge label="Adjusted ✎" cls="bg-indigo-100 text-indigo-700" /> tag.
              </li>
            </ul>
          </Section>

          <Section title="👀 Seeing the breakdown">
            <p>
              Tap anyone on the league table to open their{" "}
              <span className="font-semibold">ledger</span> — a list of every beer they&apos;ve
              logged, with the points each one scored, the badges explaining why (chug, chain,
              morning, happy hour, early bird, night owl), the challenge tally, and any admin
              adjustments. Tap a beer to see its photos.
            </p>
          </Section>

          <Section title="🏆 Scoring">
            <p>Each beer is worth points like so:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <Badge label="Normal" cls="bg-surface-muted text-muted" /> A standard beer is
                worth <span className="font-semibold">1 point</span>.
              </li>
              <li>
                <Badge label="Chug 🍺×2" cls="bg-accent-soft text-accent-strong" /> Chug it — tick{" "}
                <span className="font-semibold">&quot;I chugged it&quot;</span> when you log the beer
                and it&apos;s worth <span className="font-semibold">2 points</span>. (Only the tick
                counts — a quick gap between photos doesn&apos;t earn it automatically.)
              </li>
              <li>
                <Badge label="Chain ×N" cls="bg-purple-100 text-purple-700" /> Beers in quick
                succession build a <span className="font-semibold">chain</span>: each beer{" "}
                <span className="font-semibold">finished</span> within 5 minutes of finishing the
                last one climbs the chain — the 2nd is worth 2, the 3rd is worth 3, and so on. It&apos;s
                the gap between <span className="font-semibold">empty</span> photos that counts, so
                you have to keep actually downing them. Go more than 5 minutes without finishing the
                next and the chain resets.
              </li>
              <li>
                <Badge label="Morning +1" cls="bg-sky-100 text-sky-700" /> A beer started between{" "}
                <span className="font-semibold">07:00 and 10:59</span> (local time) earns a bonus{" "}
                <span className="font-semibold">+1</span>.
              </li>
              <li>
                <Badge label="Happy hour ⏰ +1" cls="bg-pink-100 text-pink-700" /> Every day the app
                secretly picks one <span className="font-semibold">happy hour</span> between{" "}
                <span className="font-semibold">2pm and 11pm</span> — the same hour for the whole
                trip, different each day. Any beer started during it has its base value{" "}
                <span className="font-semibold">doubled</span> (an added{" "}
                <span className="font-semibold">+1</span>). When you open the app during happy hour, a
                banner pops up to let you know. 🍻
              </li>
              <li>
                <Badge label="Early Bird 🐦 +1" cls="bg-lime-100 text-lime-700" /> A daily prize for
                the <span className="font-semibold">whole group</span>: the{" "}
                <span className="font-semibold">first person in the trip to finish</span> a beer each
                day earns a bonus <span className="font-semibold">+1</span>. Only one beer wins it.
              </li>
              <li>
                <Badge label="Night Owl 🌙 +1" cls="bg-indigo-100 text-indigo-700" /> The mirror
                image, but for genuine late nights only: the{" "}
                <span className="font-semibold">last person in the trip to finish</span> a beer each
                day earns <span className="font-semibold">+1</span> — but{" "}
                <span className="font-semibold">only if that beer is finished after midnight</span>{" "}
                (between 12am and 7am). If everyone calls it a night by 11pm, nobody gets Night Owl
                that day. Judged on the <span className="font-semibold">empty (finish) photo</span>.
                A &quot;day&quot; runs <span className="font-semibold">7am to 7am</span>, so a 4am
                nightcap still counts as the previous day&apos;s last beer — stay up latest to nab
                it. 🌙
              </li>
            </ul>
            <p>
              Chug and chain <span className="font-semibold">don&apos;t stack</span> — a beer takes
              whichever is higher. Morning, happy hour, early bird and night owl are all bonuses{" "}
              <span className="font-semibold">added on top</span>, and they stack with each other.
            </p>
            <p className="rounded-xl bg-surface-muted p-3 text-xs">
              <span className="font-semibold">Example:</span> a chug at 08:30 = 2 (chug) + 1
              (morning) = <span className="font-semibold">3 points</span>. The 4th beer in a chain at
              09:00 = 4 (chain) + 1 (morning) = <span className="font-semibold">5 points</span>. A
              chug during happy hour = 2 (chug) + 1 (happy hour) ={" "}
              <span className="font-semibold">3 points</span>.
            </p>
            <p>
              Rejected beers score <span className="font-semibold">0</span>. An admin can override
              any challenged beer&apos;s score (shown as <span className="font-semibold">Adjusted</span>).
            </p>
          </Section>

          <Section title="🌑 The dark window & reveal">
            <p>
              For the last few days the board goes <span className="font-semibold">dark</span> —
              scores are hidden from everyone so the ending stays a surprise. Keep drinking and
              logging; the <span className="font-semibold">grand reveal</span> on the final day
              crowns the champion. 🥇
            </p>
          </Section>

          <p className="pb-2 text-center text-xs text-faint">Drink responsibly. 🍺</p>
        </div>
      </div>
    </div>
  );
}
