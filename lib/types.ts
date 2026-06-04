export type Holiday = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  end_time: string;
  dark_days: number;
  admin_id: string;
  invite_code: string;
  timezone: string;
  created_at: string;
};

export type Beer = {
  id: string;
  holiday_id: string;
  user_id: string;
  full_photo_path: string | null;
  empty_photo_path: string | null;
  full_taken_at: string | null;
  empty_taken_at: string | null;
  claimed_chug: boolean;
  status: "open" | "pending" | "challenged" | "confirmed" | "rejected";
  is_offline: boolean;
  score_override: number | null;
  created_at: string;
};

export type AuditItem = {
  beer_id: string;
  owner_name: string;
  full_photo_path: string;
  empty_photo_path: string;
  full_taken_at: string;
  empty_taken_at: string;
  claimed_chug: boolean;
  is_offline: boolean;
  is_morning: boolean;
  is_happy_hour: boolean;
  is_early_bird: boolean;
  is_night_owl: boolean;
};

export type Standing = {
  user_id: string;
  display_name: string;
  points: number;
  beer_count: number;
};

export type LedgerEntry = {
  beer_id: string;
  full_taken_at: string;
  empty_taken_at: string;
  status: "pending" | "challenged" | "confirmed" | "rejected";
  is_chug: boolean;
  streak_position: number;
  is_morning: boolean;
  is_happy_hour: boolean;
  is_early_bird: boolean;
  is_night_owl: boolean;
  is_offline: boolean;
  score_override: number | null;
  override_reason: string | null;
  points: number;
  reviews_total: number;
  reviews_challenged: number;
  full_photo_path: string | null;
  empty_photo_path: string | null;
};

export type HappyHourStatus = {
  active: boolean;
  start_hour: number;
  end_hour: number;
  now_hour: number;
};

// Trophy cabinet: how many times the player has earned each trophy, keyed by
// trophy id (see user_achievements RPC). 0 = locked.
export type Achievements = Record<string, number>;

// Pace projection board (see pace_series RPC). One cumulative point per actual
// beer event, keyed on its finish time (epoch ms), so the frontend draws a real
// staircase on a time axis. `start`/`end`/`now` (epoch ms) bound the axis and
// anchor the dotted projection from now to the trip's end.
export type PaceEvent = { t: number; beers: number; points: number };
export type PaceSeries = {
  state: "live" | "dark" | "reveal";
  start: number;
  end: number;
  now: number;
  group_events: PaceEvent[];
  players: {
    user_id: string;
    display_name: string;
    events: PaceEvent[];
  }[];
};

// Legend of the Day: yesterday's top drinker (most beers finished that day in
// the trip's timezone). `legend` is null when nobody drank or the board is dark.
// `today` is the current day in the trip tz — the client gates the once-per-day
// popup on it. `date` is the celebrated (yesterday) day.
export type LegendOfTheDay = {
  today: string;
  date: string;
  legend: {
    user_id: string;
    display_name: string;
    avatar_path: string | null;
    beer_count: number;
  } | null;
};

// Daily recap: a summary of the beer-day that just wrapped (07:00 -> 07:00 in
// the trip tz). `recap` is null when the board is dark or nobody drank that day.
// `today` is the current beer-day (the client gates the once-per-day popup on
// it); `date` is the recapped day. Each honour is null when nobody qualifies.
export type DailyRecap = {
  today: string;
  date: string;
  recap: {
    total_beers: number;
    champion: {
      user_id: string;
      display_name: string;
      avatar_path: string | null;
      beer_count: number;
    };
    early_bird: { user_id: string; display_name: string; avatar_path: string | null } | null;
    night_owl: { user_id: string; display_name: string; avatar_path: string | null } | null;
    fastest_chug: {
      user_id: string;
      display_name: string;
      avatar_path: string | null;
      seconds: number;
    } | null;
    longest_chain: {
      user_id: string;
      display_name: string;
      avatar_path: string | null;
      length: number;
    } | null;
  } | null;
};

// Share card: the caller's own headline stats for a branded, shareable image
// (e.g. an Instagram story). `card` is null while the board is dark (the rank
// would leak who's ahead). fastest_chug is seconds, or null if never chugged.
export type ShareCard = {
  state: "live" | "dark" | "reveal";
  card: {
    holiday_name: string;
    display_name: string;
    avatar_path: string | null;
    rank: number;
    players: number;
    points: number;
    beers: number;
    chugs: number;
    morning_beers: number;
    fastest_chug: number | null;
    longest_chain: number;
    active_days: number;
    early_birds: number;
    night_owls: number;
  } | null;
};

// A trip member as shown in the head-to-head player picker.
export type HolidayMember = {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
};

// One side of a head-to-head rivalry card. fastest_chug is seconds (lower is
// better) or null if they've never chugged.
export type RivalryPlayer = {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
  beers: number;
  points: number;
  chugs: number;
  fastest_chug: number | null;
  longest_chain: number;
  morning_beers: number;
  happy_hours: number;
  early_birds: number;
  night_owls: number;
  active_days: number;
};

// head_to_head RPC result. `players` is null while the board is dark (a
// comparison would leak who's ahead); otherwise a [a, b] pair in pick order.
export type HeadToHead = {
  state: "live" | "dark" | "reveal";
  players: [RivalryPlayer, RivalryPlayer] | null;
};

// One entry in the live activity feed. `n` carries the type-specific number
// (chain length, milestone count, the leader's running points) or null when the
// event doesn't need one. `at` is the moment it happened (ISO timestamptz).
export type ActivityEventType =
  | "chug"
  | "early_bird"
  | "night_owl"
  | "happy_hour_start"
  | "happy_hour_end"
  | "chain"
  | "day_milestone"
  | "trip_milestone"
  | "lead"
  | "legend"
  | "first_blood";

// user_id / display_name / avatar_path are null for player-less events
// (the happy-hour window announcements).
export type ActivityEvent = {
  type: ActivityEventType;
  at: string;
  user_id: string | null;
  display_name: string | null;
  avatar_path: string | null;
  n: number | null;
};

// activity_feed RPC result. `events` is null while the board is dark for
// non-admins (it would leak standings); otherwise newest-first, capped.
export type ActivityFeed = {
  state: "live" | "dark" | "reveal";
  events: ActivityEvent[] | null;
};

export type StandingsResult = {
  state: "live" | "dark" | "reveal";
  is_admin: boolean;
  can_peek: boolean;
  generated_at: string | null;
  reveal_at: string | null;
  standings: Standing[] | null;
};

export type AdminTrip = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  invite_code: string;
  created_at: string;
  member_count: number;
  beer_count: number;
  photo_count: number;
  storage_bytes: number;
};

export type AdminMember = {
  user_id: string;
  display_name: string;
  is_admin: boolean;
  beer_count: number;
  photo_count: number;
  storage_bytes: number;
};

export type AdminStorageSummary = {
  total_photos: number;
  total_bytes: number;
  limit_bytes: number;
  used_pct: number;
};

export type TripStats = {
  state: "live" | "dark" | "reveal";
  is_admin: boolean;
  members: number;
  total_beers: number;
  total_points: number;
  chugs: number;
  morning_beers: number;
  offline_beers: number;
  active_days: number;
  first_beer_at: string | null;
  last_beer_at: string | null;
  challenges_raised: number;
  beers_rejected: number;
  happiest_hour: { hour: number; count: number } | null;
  happiest_day: { date: string; count: number } | null;
  fastest_chug: { seconds: number; name: string | null } | null;
  longest_chain: { length: number; name: string | null } | null;
  top_drinker: { name: string; count: number } | null;
};
