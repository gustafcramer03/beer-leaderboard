export type Holiday = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
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
