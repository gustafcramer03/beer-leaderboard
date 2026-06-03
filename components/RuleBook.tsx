"use client";

// The in-app rulebook: how to play, how auditing works, and how scoring is
// calculated. Opened from the 📖 button on the leaderboard.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-bold text-amber-600">{title}</h3>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
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
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">📖 How the game works</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
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
              morning), the challenge tally, and any admin adjustments. Tap a beer to see its photos.
            </p>
          </Section>

          <Section title="🏆 Scoring">
            <p>Each beer is worth points like so:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <Badge label="Normal" cls="bg-neutral-200 text-neutral-700" /> A standard beer is
                worth <span className="font-semibold">1 point</span>.
              </li>
              <li>
                <Badge label="Chug 🍺×2" cls="bg-amber-100 text-amber-700" /> Chug it — empty within
                60 seconds of the full photo, or you ticked &quot;I chugged it&quot; — and it&apos;s
                worth <span className="font-semibold">2 points</span>.
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
            </ul>
            <p>
              Chug and chain <span className="font-semibold">don&apos;t stack</span> — a beer takes
              whichever is higher. Morning is the one bonus added on top.
            </p>
            <p className="rounded-xl bg-neutral-100 p-3 text-xs dark:bg-neutral-800">
              <span className="font-semibold">Example:</span> a chug at 08:30 = 2 (chug) + 1
              (morning) = <span className="font-semibold">3 points</span>. The 4th beer in a chain at
              09:00 = 4 (chain) + 1 (morning) = <span className="font-semibold">5 points</span>.
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

          <p className="pb-2 text-center text-xs text-neutral-400">Drink responsibly. 🍺</p>
        </div>
      </div>
    </div>
  );
}
