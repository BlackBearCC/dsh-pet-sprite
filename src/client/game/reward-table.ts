/**
 * Character Engine — RewardTable
 *
 * Pure data mapping: event type + context → resource deltas (coins/exp).
 * See: docs/skills/specs/2026-04-18-godot-game-loop-design.md §3.3
 */

export interface RewardDelta {
  coins: number;
  exp: number;
}

const ZERO: RewardDelta = { coins: 0, exp: 0 };

/** Named event keys understood by the reward engine. */
export type RewardEventKey =
  | "chat:eval"
  | "tool:invoked"
  | "tool:first_use"
  | "level:up"
  | "achievement:unlock"
  | "login:streak"
  | "login:online30min"
  | "chat:interval"
  | "learn:lesson-complete"
  | "learn:exam-passed"
  | "learn:all-lessons-done"
  | "todo:verified"
  | "narrative:completed"
  | "adventure:completed";

type Ctx = Record<string, unknown>;

type Resolver = (ctx: Ctx) => RewardDelta;

// Intensity after global EXP inflation (exp ×100; coins untouched).
const CHAT_EVAL_INTENTS: Record<string, RewardDelta> = {
  praise: { coins: 0, exp: 500 },
  deep_talk: { coins: 0, exp: 500 },
  gratitude: { coins: 0, exp: 500 },
  playful: { coins: 0, exp: 200 },
  sad_share: { coins: 0, exp: 300 },
  neutral: { coins: 0, exp: 100 },
  cold: { coins: 0, exp: 0 },
  impatient: { coins: 0, exp: 0 },
  angry: { coins: 0, exp: 0 },
};

/** Course difficulty 1-5 (from event ctx.complexity); learning EXP scales with difficulty. */
const learnComplexity = (ctx: Ctx): number =>
  Math.min(5, Math.max(1, Math.round(Number(ctx.complexity ?? 1))));

export const REWARD_TABLE: Record<RewardEventKey, Resolver> = {
  "chat:eval": (ctx) => {
    const intent = typeof ctx.intent === "string" ? ctx.intent : "";
    return CHAT_EVAL_INTENTS[intent] ?? ZERO;
  },

  "tool:invoked": (ctx) => {
    const weight = typeof ctx.weight === "string" ? ctx.weight : "light";
    if (weight === "heavy") {
      return { coins: 15, exp: 1500 };
    }
    return { coins: 3, exp: 300 };
  },

  "tool:first_use": () => ({ coins: 20, exp: 1000 }),

  "level:up": () => ({ coins: 30, exp: 0 }),

  "achievement:unlock": () => ({ coins: 50, exp: 0 }),

  "login:streak": (ctx) => {
    const streak = Number(ctx.streak ?? 0);
    return { coins: Math.min(50, 5 * streak), exp: 0 };
  },

  "login:online30min": () => ({ coins: 10, exp: 0 }),

  "chat:interval": () => ({ coins: 5, exp: 0 }),

  // Learning pays more, scaled by course complexity (1-5): hard courses far outweigh easy ones.
  "learn:lesson-complete": (ctx) => ({ coins: 8, exp: learnComplexity(ctx) * 300 }),

  "learn:exam-passed": (ctx) => ({ coins: 40, exp: learnComplexity(ctx) * 2000 }),

  "learn:all-lessons-done": (ctx) => ({ coins: 80, exp: learnComplexity(ctx) * 4000 }),

  "todo:verified": (ctx) => {
    const rewards = (ctx.rewards ?? {}) as { exp?: number; coins?: number };
    return { coins: rewards.coins ?? 0, exp: rewards.exp ?? 0 };
  },

  "narrative:completed": (ctx) => {
    const outcome = (ctx.outcome ?? {}) as {
      won?: boolean;
      rewards?: { exp: number; coins: number };
    };
    const r = outcome.rewards ?? { exp: 0, coins: 0 };
    return { coins: r.coins, exp: r.exp };
  },

  "adventure:completed": (ctx) => {
    const result = (ctx.result ?? {}) as {
      success?: boolean;
      rewards?: { exp: number; coins: number };
    };
    const r = result.rewards ?? { exp: 0, coins: 0 };
    return { coins: r.coins, exp: r.exp };
  },
};

export function lookupReward(eventKey: string, ctx: Ctx): RewardDelta {
  const resolver = REWARD_TABLE[eventKey as RewardEventKey];
  if (!resolver) {
    return { ...ZERO };
  }
  return resolver(ctx);
}
