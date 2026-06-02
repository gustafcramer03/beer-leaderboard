// Backend smoke test: signs in anonymously and exercises the full chain.
// Run: node scripts/smoke.mjs   (env vars read from process.env)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const ok = (m) => console.log("  ✓", m);
const fail = (m, e) => {
  console.error("  ✗", m, "->", e?.message ?? e);
  process.exit(1);
};

// Two independent clients = two "devices"/users.
function client() {
  return createClient(url, anon, { auth: { persistSession: false } });
}

async function signIn(c, name) {
  const { data, error } = await c.auth.signInAnonymously();
  if (error) fail(`anon sign-in (${name})`, error);
  await c.from("profiles").upsert({ id: data.user.id, display_name: name });
  ok(`signed in + profile: ${name} (${data.user.id.slice(0, 8)})`);
  return data.user.id;
}

async function logBeer(c, holidayId, { chug = false } = {}) {
  const { data: ins, error: e1 } = await c
    .from("beers")
    .insert({ holiday_id: holidayId, user_id: (await c.auth.getUser()).data.user.id })
    .select("id")
    .single();
  if (e1) fail("insert beer", e1);
  const id = ins.id;
  const full = `${holidayId}/${id}/full.jpg`;
  const empty = `${holidayId}/${id}/empty.jpg`;
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
  let r = await c.storage.from("beer-photos").upload(full, blob, { upsert: true });
  if (r.error) fail("upload full", r.error);
  await c.from("beers").update({ full_photo_path: full }).eq("id", id);
  r = await c.storage.from("beer-photos").upload(empty, blob, { upsert: true });
  if (r.error) fail("upload empty", r.error);
  const { error: e2 } = await c
    .from("beers")
    .update({ empty_photo_path: empty, claimed_chug: chug })
    .eq("id", id);
  if (e2) fail("finish beer", e2);
  return id;
}

async function main() {
  console.log("URL:", url);
  const alice = client();
  const bob = client();
  await signIn(alice, "Alice");
  await signIn(bob, "Bob");

  // Alice creates a holiday (ends today => reveal state for a quick check later;
  // use a future end so it's 'live').
  const today = new Date();
  const end = new Date(today.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const start = today.toISOString().slice(0, 10);
  const { data: hol, error: ce } = await alice.rpc("create_holiday", {
    p_name: "Smoke Test Trip",
    p_start: start,
    p_end: end,
    p_dark_days: 2,
  });
  if (ce) fail("create_holiday", ce);
  ok(`holiday created: ${hol.name} code=${hol.invite_code}`);

  // Bob joins via code.
  const { error: je } = await bob.rpc("join_holiday", { p_code: hol.invite_code });
  if (je) fail("join_holiday", je);
  ok("Bob joined via code");

  // Both log beers.
  const b1 = await logBeer(alice, hol.id, { chug: true });
  await logBeer(bob, hol.id);
  ok("Alice logged a (chug) beer, Bob logged one");

  // Bob audits Alice's beer (should appear; cannot see his own).
  const { data: q, error: qe } = await bob.rpc("audit_queue", { p_holiday: hol.id });
  if (qe) fail("audit_queue", qe);
  if (!q.some((x) => x.beer_id === b1)) fail("audit queue missing Alice's beer", "not found");
  ok(`Bob's audit queue has ${q.length} beer(s), incl. Alice's`);

  // Bob challenges Alice's beer -> should escalate.
  const { error: re } = await bob.rpc("submit_review", { p_beer: b1, p_verdict: "challenge" });
  if (re) fail("submit_review challenge", re);
  ok("Bob challenged Alice's beer");

  // Alice (admin) sees it in challenged queue and rejects it.
  const { data: ch, error: che } = await alice
    .from("beers")
    .select("id,status")
    .eq("holiday_id", hol.id)
    .eq("status", "challenged");
  if (che) fail("read challenged", che);
  if (!ch.length) fail("challenged beer not visible to admin", "empty");
  await alice.rpc("admin_rule_beer", { p_beer: b1, p_decision: "reject" });
  ok("Admin rejected the challenged beer");

  // Refresh + read standings.
  await alice.rpc("refresh_snapshot", { p_holiday: hol.id });
  const { data: stand, error: se } = await alice.rpc("get_latest_standings", { p_holiday: hol.id });
  if (se) fail("get_latest_standings", se);
  ok(`standings state=${stand.state} rows=${stand.standings?.length}`);
  console.log("    ", JSON.stringify(stand.standings));

  // Bob must NOT be able to review his own beer.
  const { data: bobBeers } = await bob
    .from("beers")
    .select("id")
    .eq("user_id", (await bob.auth.getUser()).data.user.id)
    .limit(1);
  const { error: selfErr } = await bob.rpc("submit_review", {
    p_beer: bobBeers[0].id,
    p_verdict: "confirm",
  });
  if (selfErr) ok("self-review correctly blocked: " + selfErr.message);
  else fail("self-review was NOT blocked", "should have errored");

  console.log("\nALL BACKEND CHECKS PASSED ✅");
}

main();
