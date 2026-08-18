/**
 * Character Engine — CareSystem
 *
 * Manages care actions: feed, play, heal.
 * Delegates item consumption to InventorySystem,
 * attribute adjustments to AttributeEngine.
 */

import type { AttributeEngine } from "./attribute-engine.ts";
import type { EventBus } from "./event-bus.ts";
import type { InventorySystem } from "./inventory-system.ts";
import type { LevelSystem } from "./level-system.ts";

// ─── Play actions ───

export interface PlayAction {
  id: string;
  name: string;
  effects: { mood: number; power?: number };
}

export const PLAY_ACTIONS: PlayAction[] = [
  { id: "hide_seek", name: "捉迷藏", effects: { mood: 10, power: -18 } },
  { id: "sunbathe", name: "晒太阳", effects: { mood: 5, power: -6 } },
];

// ─── System ───

// SLEEP rate (per second)
const SLEEP_MOOD_PER_SEC = 1.0;
const SLEEP_POWER_PER_SEC = 0.1;

export class CareSystem {
  private _bus: EventBus;
  private _attributes: AttributeEngine;
  private _inventory: InventorySystem;
  private _levels: LevelSystem;

  constructor(
    bus: EventBus,
    attributes: AttributeEngine,
    inventory: InventorySystem,
    levels: LevelSystem,
  ) {
    this._bus = bus;
    this._attributes = attributes;
    this._inventory = inventory;
    this._levels = levels;
  }

  /** Feed using an item from inventory */
  feed(itemId: string): { ok: boolean; reason?: string; effects?: Record<string, number> } {
    const result = this._inventory.useItem(itemId);
    if (!result) {
      const cd = this._inventory.getCooldown(itemId);
      if (cd > 0) {
        return { ok: false, reason: "cooldown", effects: { cooldownRemaining: cd } };
      }
      return { ok: false, reason: "no_item" };
    }

    this._applyEffects(result.effects);
    this._levels.gainExp(this._careExp(result.effects), "feed");
    this._bus.emit("care:action", { action: "feed", itemId, effects: result.effects });

    return { ok: true, effects: result.effects };
  }

  /** Perform a play action */
  play(actionId: string): { ok: boolean; reason?: string; effects?: Record<string, number> } {
    const action = PLAY_ACTIONS.find((a) => a.id === actionId);
    if (!action) {
      return { ok: false, reason: "unknown_action" };
    }

    if (action.effects.power && action.effects.power < 0) {
      const currentHunger = this._attributes.getValue("power");
      if (currentHunger < Math.abs(action.effects.power)) {
        return { ok: false, reason: "too_low_power" };
      }
    }

    const effects: Record<string, number> = {};
    for (const [k, v] of Object.entries(action.effects)) {
      if (v !== undefined) {
        effects[k] = v;
      }
    }

    this._applyEffects(effects);
    this._levels.gainExp(this._careExp(effects), "play");
    this._bus.emit("care:action", { action: `play:${actionId}`, effects });

    return { ok: true, effects };
  }

  /** Use any inventory item (generic) — consume + apply effects */
  useItem(itemId: string): { ok: boolean; reason?: string; effects?: Record<string, number> } {
    const result = this._inventory.useItem(itemId);
    if (!result) {
      const cd = this._inventory.getCooldown(itemId);
      if (cd > 0) {
        return { ok: false, reason: "cooldown", effects: { cooldownRemaining: cd } };
      }
      return { ok: false, reason: "no_item" };
    }

    this._applyEffects(result.effects);
    this._levels.gainExp(this._careExp(result.effects), "use_item");
    this._bus.emit("care:action", { action: `use:${itemId}`, effects: result.effects });

    return { ok: true, effects: result.effects };
  }

  /**
   * SLEEP redesign: trade power for mood.
   * The client behavior_system tracks duration and calls this once on wake to apply in batch.
   * See docs/design/2026-07-20-sleep-重设计-design.md
   */
  rest(params?: { duration?: number; wokeBy?: string }): {
    ok: boolean;
    reason?: string;
    effects?: Record<string, number>;
    duration?: number;
    wokeBy?: string;
    moodGain?: number;
    powerCost?: number;
  } {
    const duration = params?.duration;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
      return { ok: false, reason: "invalid_duration" };
    }
    const wokeBy = typeof params?.wokeBy === "string" ? params.wokeBy : "manual";
    const moodGain = Math.round(duration * SLEEP_MOOD_PER_SEC);
    const powerCost = Math.round(duration * SLEEP_POWER_PER_SEC * 10) / 10; // keep 1 decimal place
    // -0 → 0, avoids Object.is(-0, 0) false negatives in tests
    const effects: Record<string, number> = { mood: moodGain, power: -powerCost || 0 };
    this._applyEffects(effects);
    this._bus.emit("care:action", {
      action: "rest",
      effects,
      duration,
      wokeBy,
      moodGain,
      powerCost,
    });
    return { ok: true, effects, duration, wokeBy, moodGain, powerCost };
  }

  /** Use a healing item */
  heal(itemId: string): { ok: boolean; reason?: string; effects?: Record<string, number> } {
    const result = this._inventory.useItem(itemId);
    if (!result) {
      const cd = this._inventory.getCooldown(itemId);
      if (cd > 0) {
        return { ok: false, reason: "cooldown", effects: { cooldownRemaining: cd } };
      }
      return { ok: false, reason: "no_item" };
    }

    this._applyEffects(result.effects);
    this._levels.gainExp(this._careExp(result.effects), "heal");
    this._bus.emit("care:action", { action: "heal", itemId, effects: result.effects });

    return { ok: true, effects: result.effects };
  }

  /** Care XP = total item effect × 5 (min 100): stronger content yields more XP. */
  private _careExp(effects: Record<string, number>): number {
    let sum = 0;
    for (const v of Object.values(effects)) {
      sum += Math.abs(v);
    }
    return Math.max(100, Math.round(sum * 5));
  }

  private _applyEffects(effects: Record<string, number>): void {
    for (const [key, amount] of Object.entries(effects)) {
      if (key === "exp") {
        this._levels.gainExp(amount, "item");
      } else {
        this._attributes.adjust(key, amount);
      }
    }
  }
}
