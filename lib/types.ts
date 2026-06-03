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
  is_offline: boolean;
  score_override: number | null;
  points: number;
  reviews_total: number;
  reviews_challenged: number;
  full_photo_path: string | null;
  empty_photo_path: string | null;
};

export type StandingsResult = {
  state: "live" | "dark" | "reveal";
  is_admin: boolean;
  can_peek: boolean;
  generated_at: string | null;
  standings: Standing[] | null;
};
