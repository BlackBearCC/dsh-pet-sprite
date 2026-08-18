/**
 * Character Engine — LevelSystem
 *
 * Manages character level (Lv.1-30) driven by EXP from various sources:
 * chat, feeding, playing, learning, daily tasks, achievements, login streaks.
 *
 * Level affects decay multiplier, unlock content, and persona enrichment.
 */

import type { PersistenceStore } from "./attribute-engine.ts";
import type { EventBus } from "./event-bus.ts";

// ─── EXP table (cumulative EXP needed for each level) ───

export const MAX_LEVEL = 100;

/**
 * 到达 `level` 级所需的累计经验(公式, 满级 Lv.100)。
 * 二次曲线 cumExp(L) = 2500 × (L-1)^2, 配合 token=1:1 的经济。
 * Lv2=2500, Lv10≈20万, Lv23≈121万, Lv30≈210万, Lv100≈2450万(满级)。
 */
export function expForLevel(level: number): number {
  const n = Math.max(0, level - 1);
  return 2500 * n * n;
}

// ─── Level titles ───

export interface LevelTier {
  minLevel: number;
  maxLevel: number;
  title: string;
  decayMultiplier: number;
}

export const LEVEL_TIERS: LevelTier[] = [
  { minLevel: 1, maxLevel: 5, title: "小萌新", decayMultiplier: 1.0 },
  { minLevel: 6, maxLevel: 10, title: "小帮手", decayMultiplier: 1.0 },
  { minLevel: 11, maxLevel: 15, title: "好伙伴", decayMultiplier: 0.85 },
  { minLevel: 16, maxLevel: 20, title: "老搭档", decayMultiplier: 0.75 },
  { minLevel: 21, maxLevel: 25, title: "灵魂伴侣", decayMultiplier: 0.7 },
  { minLevel: 26, maxLevel: 30, title: "传说之猫", decayMultiplier: 0.6 },
];

// ─── Persistence shape ───

interface LevelState {
  exp: number;
  level: number;
}

const STORE_KEY = "level-system";

// ─── System ───

export class LevelSystem {
  private _bus: EventBus;
  private _store: PersistenceStore;
  private _exp: number;
  private _level: number;

  constructor(bus: EventBus, store: PersistenceStore) {
    this._bus = bus;
    this._store = store;
    this._exp = 0;
    this._level = 1;

    const saved = this._store.load(STORE_KEY) as LevelState | null;
    if (saved) {
      this._exp = saved.exp ?? 0;
      this._level = saved.level ?? 1;
    }
  }

  /** Add EXP from a named source */
  gainExp(amount: number, source: string): void {
    if (amount <= 0) {
      return;
    }
    this._exp += amount;

    this._bus.emit("level:exp-gain", {
      amount,
      source,
      totalExp: this._exp,
    });

    // Check for level ups
    const prevLevel = this._level;
    while (this._level < MAX_LEVEL && this._exp >= expForLevel(this._level + 1)) {
      this._level++;
    }

    if (this._level > prevLevel) {
      this._bus.emit("level:up", {
        level: this._level,
        prevLevel,
        title: this.title,
      });
    }

    this._save();
  }

  get exp(): number {
    return this._exp;
  }

  get level(): number {
    return this._level;
  }

  get title(): string {
    return this.getTier().title;
  }

  /** EXP needed for next level (0 if max) */
  get expToNext(): number {
    if (this._level >= MAX_LEVEL) {
      return 0;
    }
    return expForLevel(this._level + 1) - this._exp;
  }

  /** EXP threshold for current level */
  get currentLevelExp(): number {
    return expForLevel(this._level);
  }

  /** EXP threshold for next level */
  get nextLevelExp(): number {
    if (this._level >= MAX_LEVEL) {
      return expForLevel(MAX_LEVEL);
    }
    return expForLevel(this._level + 1);
  }

  /** Get the tier info for current level */
  getTier(): LevelTier {
    for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
      if (this._level >= LEVEL_TIERS[i].minLevel) {
        return LEVEL_TIERS[i];
      }
    }
    return LEVEL_TIERS[0];
  }

  /** Decay multiplier based on current level tier */
  get decayMultiplier(): number {
    return this.getTier().decayMultiplier;
  }

  /** Inventory capacity based on level */
  get inventoryCapacity(): number {
    if (this._level >= 20) {
      return 40;
    }
    if (this._level >= 10) {
      return 30;
    }
    return 20;
  }

  /** Max offline decay window: 8h for all (慢速离线衰减, 约 8h 扣总量 1/5) */
  get maxOfflineHours(): number {
    return 8;
  }

  /** Get a full info snapshot for RPC */
  getInfo() {
    return {
      level: this._level,
      exp: this._exp,
      expToNext: this.expToNext,
      currentLevelExp: this.currentLevelExp,
      nextLevelExp: this.nextLevelExp,
      title: this.title,
      decayMultiplier: this.decayMultiplier,
      inventoryCapacity: this.inventoryCapacity,
    };
  }

  private _save(): void {
    this._store.save(STORE_KEY, {
      exp: this._exp,
      level: this._level,
    });
  }
}
