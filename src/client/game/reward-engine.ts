/**
 * Character Engine — RewardEngine
 *
 * Central subscription point that listens to EventBus and translates
 * events into coin/exp deltas via RewardTable, dispatching
 * to the provided sinks (shop.earnCoins / levels.gainExp).
 *
 * Also tracks first-use of PetClaw tools and emits tool:first_use.
 *
 * See: docs/skills/specs/2026-04-18-godot-game-loop-design.md §3 / §5.1
 */

import type { PersistenceStore } from "./attribute-engine.ts";
import type { EventBus } from "./event-bus.ts";
import { lookupReward, type RewardDelta } from "./reward-table.ts";

export interface RewardSinks {
  earnCoins: (amount: number, source: string) => void;
  gainExp: (amount: number, source: string) => void;
}

interface RewardEngineState {
  firstUsedTools: string[];
  totalCoins: number;
  totalExp: number;
}

const STORE_KEY = "reward-engine";

// Heuristic: tool name patterns that qualify as "heavy" (higher reward).
// Keep list conservative — false positives inflate the economy.
const HEAVY_TOOL_PATTERNS = [
  /write_code/i,
  /generate_image/i,
  /generate_video/i,
  /generate_audio/i,
  /edit_image/i,
  /long_task/i,
  /bash/i,
  /deploy/i,
];

function classifyTool(toolName: string): "light" | "heavy" {
  for (const p of HEAVY_TOOL_PATTERNS) {
    if (p.test(toolName)) {
      return "heavy";
    }
  }
  return "light";
}

export class RewardEngine {
  private _bus: EventBus;
  private _store: PersistenceStore;
  private _sinks: RewardSinks;
  private _firstUsed: Set<string>;
  private _totalCoins = 0;
  private _totalExp = 0;

  constructor(bus: EventBus, store: PersistenceStore, sinks: RewardSinks) {
    this._bus = bus;
    this._store = store;
    this._sinks = sinks;
    this._firstUsed = new Set();

    const saved = this._store.load(STORE_KEY) as RewardEngineState | null;
    if (saved) {
      this._firstUsed = new Set(saved.firstUsedTools ?? []);
      this._totalCoins = saved.totalCoins ?? 0;
      this._totalExp = saved.totalExp ?? 0;
    }

    this._wire();
  }

  getStats(): {
    totalCoins: number;
    totalExp: number;
    firstUsedTools: string[];
  } {
    return {
      totalCoins: this._totalCoins,
      totalExp: this._totalExp,
      firstUsedTools: Array.from(this._firstUsed),
    };
  }

  // ─── internal ─────────────────────────────────────────────

  private _wire(): void {
    this._bus.on("chat:eval", ({ intent }) => {
      this._issue("chat:eval", `chat:eval:${intent}`, lookupReward("chat:eval", { intent }));
    });

    this._bus.on("level:up", ({ level }) => {
      this._issue("level:up", `level:up:${level}`, lookupReward("level:up", { level }));
    });

    this._bus.on("achievement:unlock", ({ id }) => {
      this._issue(
        "achievement:unlock",
        `achievement:${id}`,
        lookupReward("achievement:unlock", {}),
      );
    });

    this._bus.on("login:streak", ({ streak }) => {
      this._issue(
        "login:streak",
        `login:streak:${streak}`,
        lookupReward("login:streak", { streak }),
      );
    });

    this._bus.on("login:online30min", () => {
      this._issue("login:online30min", "login:online30min", lookupReward("login:online30min", {}));
    });

    this._bus.on("chat:interval", ({ count }) => {
      this._issue(
        "chat:interval",
        `chat:interval:${count}`,
        lookupReward("chat:interval", { count }),
      );
    });

    this._bus.on("agent:phase", (payload) => {
      if (payload.phase !== "tool_call") {
        return;
      }
      const toolName = payload.toolName ?? "unknown";
      const weight = classifyTool(toolName);
      console.log(`[RewardEngine] tool:invoked name=${toolName} weight=${weight}`);

      this._issue("tool:invoked", `tool:${toolName}`, lookupReward("tool:invoked", { weight }));

      if (!this._firstUsed.has(toolName)) {
        this._firstUsed.add(toolName);
        console.log(`[RewardEngine] tool:first_use name=${toolName}`);
        this._bus.emit("tool:first_use", {
          toolName,
          source: "reward-engine",
          timestamp: Date.now(),
        });
        this._issue(
          "tool:first_use",
          `tool:first_use:${toolName}`,
          lookupReward("tool:first_use", {}),
        );
      }
    });

    this._bus.on("learn:lesson-complete", ({ courseId, lessonOrder, complexity }) => {
      this._issue(
        "learn:lesson-complete",
        `learn:lesson:${courseId}:${lessonOrder}`,
        lookupReward("learn:lesson-complete", { complexity }),
      );
    });

    this._bus.on("learn:exam-passed", ({ courseId, complexity }) => {
      this._issue(
        "learn:exam-passed",
        `learn:exam:${courseId}`,
        lookupReward("learn:exam-passed", { complexity }),
      );
    });

    this._bus.on("learn:all-lessons-done", ({ courseId, complexity }) => {
      this._issue(
        "learn:all-lessons-done",
        `learn:all-done:${courseId}`,
        lookupReward("learn:all-lessons-done", { complexity }),
      );
    });

    this._bus.on("todo:verified", ({ todo, rewards }) => {
      this._issue(
        "todo:verified",
        `todo:verified:${todo.id}`,
        lookupReward("todo:verified", { rewards }),
      );
    });

    this._bus.on("narrative:completed", ({ session, outcome }) => {
      this._issue(
        "narrative:completed",
        `narrative:completed:${session.id}`,
        lookupReward("narrative:completed", { outcome }),
      );
    });

    this._bus.on("adventure:completed", ({ adventure, result }) => {
      this._issue(
        "adventure:completed",
        `adventure:completed:${adventure.id}`,
        lookupReward("adventure:completed", { result }),
      );
    });
  }

  private _issue(eventType: string, source: string, delta: RewardDelta): void {
    if (delta.coins > 0) {
      this._sinks.earnCoins(delta.coins, source);
    }
    if (delta.exp > 0) {
      this._sinks.gainExp(delta.exp, source);
    }

    this._totalCoins += Math.max(0, delta.coins);
    this._totalExp += Math.max(0, delta.exp);

    this._persist();

    this._bus.emit("reward:issued", {
      eventType,
      coins: delta.coins,
      exp: delta.exp,
      source,
    });
  }

  private _persist(): void {
    const state: RewardEngineState = {
      firstUsedTools: Array.from(this._firstUsed),
      totalCoins: this._totalCoins,
      totalExp: this._totalExp,
    };
    this._store.save(STORE_KEY, { ...state });
  }
}
