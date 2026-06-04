// The fixed set of emoji you can react to a beer with (WhatsApp-style: exactly
// one per user per beer). MUST stay in sync with the allowed array in the
// react_to_beer RPC (migration 0030).
export const REACTION_EMOJIS = ["🍺", "🔥", "💪", "😂", "😮", "🤮"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// The fresh aggregate react_to_beer returns for a beer.
export type ReactionState = {
  counts: Record<string, number>;
  mine: string | null;
};
