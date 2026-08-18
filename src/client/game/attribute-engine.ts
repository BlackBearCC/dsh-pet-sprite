/**
 * Character Engine — AttributeEngine
 *
 * Generic attribute system that replaces MoodSystem, HungerSystem,
 * and HealthSystem with a single configurable engine.
 *
 * Each attribute has:
 *   - value (0-100 or custom range)
 *   - decay/regen rate per minute
 *   - named levels with thresholds
 *   - optional dependencies on other attributes
 *   - persistence via a pluggable store
 */

import type { EventBus } from "./event-bus.ts";

// ─── Types ───

export interface AttributeLevel {
  name: string;
  /** Minimum value for this level (inclusive) */
  threshold: number;
}

export interface AttributeDef {
  key: string;
  /** Display name */
  name: string;
  /** Initial value for new characters */
  initial: number;
  min: number;
  max: number;
  /**
   * Decay rate per minute. Positive = value decreases over time.
   * Use negative for attributes that grow over time.
   * Set to 0 for no-decay attributes (e.g. health).
   */
  decayPerMinute: number;
  /** Max offline hours to calculate decay for on restore */
  maxOfflineHours: number;
  /** Ordered ascending by threshold */
  levels: AttributeLevel[];
  /**
   * Optional dependency: compute value adjustments based on other attributes.
   * Called every `checkIntervalMs` alongside regular decay.
   */
  dependencies?: AttributeDependency[];
}

export interface AttributeDependency {
  /** Key of the attribute this depends on */
  sourceKey: string;
  /**
   * Given the source attribute's current level name,
   * return a per-30s adjustment to apply. Return 0 for no effect.
   */
  effect: (sourceLevel: string) => number;
}

export interface AttributeState {
  value: number;
  updatedAt: number;
}

export interface PersistenceStore {
  load(key: string): Record<string, unknown> | null;
  save(key: string, data: Record<string, unknown>): void;
}

// ─── Engine ───

const TICK_INTERVAL_MS = 10_000; // decay every 10s
const SAVE_INTERVAL_MS = 30_000; // persist every 30s
const DEP_CHECK_INTERVAL_MS = 30_000; // dependency check every 30s

interface AttributeRuntime {
  def: AttributeDef;
  value: number;
  level: string;
  decayAcc: number;
  saveAcc: number;
  depCheckAcc: number;
  dirty: boolean;
}

export class AttributeEngine {
  private _attrs = new Map<string, AttributeRuntime>();
  private _store: PersistenceStore;
  private _bus: EventBus;
  private _decayMultiplier = 1.0;
  private _maxOfflineHoursOverride: number | null = null;

  constructor(bus: EventBus, store: PersistenceStore) {
    this._bus = bus;
    this._store = store;
  }

  /** Set a global decay multiplier (driven by character level) */
  setDecayMultiplier(multiplier: number): void {
    this._decayMultiplier = multiplier;
  }

  getDecayMultiplier(): number {
    return this._decayMultiplier;
  }

  /** Override max offline hours for all attributes (driven by character level) */
  setMaxOfflineHours(hours: number): void {
    this._maxOfflineHoursOverride = hours;
  }

  /** Register an attribute definition and restore its state */
  register(def: AttributeDef): void {
    const saved = this._store.load(def.key) as AttributeState | null;
    let value = def.initial;

    if (saved) {
      value = saved.value;
      // Apply offline decay
      if (def.decayPerMinute > 0 && saved.updatedAt) {
        const maxHours = this._maxOfflineHoursOverride ?? def.maxOfflineHours;
        const elapsedMin = Math.min((Date.now() - saved.updatedAt) / 60_000, maxHours * 60);
        value = Math.max(def.min, value - elapsedMin * def.decayPerMinute * this._decayMultiplier);
      }
    }

    const level = this._resolveLevel(def, value);

    this._attrs.set(def.key, {
      def,
      value,
      level,
      decayAcc: 0,
      saveAcc: 0,
      depCheckAcc: 0,
      dirty: true,
    });

    // Initial save with corrected value
    this._store.save(def.key, { value, updatedAt: Date.now() });
  }

  /** Adjust an attribute's value by delta */
  adjust(key: string, delta: number): void {
    const rt = this._attrs.get(key);
    if (!rt) {
      return;
    }
    const prev = rt.level;
    rt.value = Math.max(rt.def.min, Math.min(rt.def.max, rt.value + delta));
    rt.level = this._resolveLevel(rt.def, rt.value);
    rt.dirty = true;
    if (rt.level !== prev) {
      this._bus.emit("attribute:level-change", {
        key,
        level: rt.level,
        value: rt.value,
        prev,
      });
    }
    this._store.save(key, { value: rt.value, updatedAt: Date.now() });
  }

  /** Set an attribute to an exact value */
  set(key: string, value: number): void {
    const rt = this._attrs.get(key);
    if (!rt) {
      return;
    }
    const delta = value - rt.value;
    if (delta !== 0) {
      this.adjust(key, delta);
    }
  }

  /** Get current value */
  getValue(key: string): number {
    return this._attrs.get(key)?.value ?? 0;
  }

  /** Get current level name */
  getLevel(key: string): string {
    return this._attrs.get(key)?.level ?? "";
  }

  /** Get all attribute states (for UI) */
  getAll(): Array<{ key: string; name: string; value: number; level: string; max: number }> {
    const result: Array<{ key: string; name: string; value: number; level: string; max: number }> =
      [];
    for (const [, rt] of this._attrs) {
      result.push({
        key: rt.def.key,
        name: rt.def.name,
        value: Math.round(rt.value),
        level: rt.level,
        max: rt.def.max,
      });
    }
    return result;
  }

  /** Called by game loop every frame. */
  tick(deltaMs: number): void {
    for (const [key, rt] of this._attrs) {
      if (rt.def.decayPerMinute > 0) {
        rt.decayAcc += deltaMs;
        if (rt.decayAcc >= TICK_INTERVAL_MS) {
          const prev = rt.level;
          const decayAmount =
            (rt.decayAcc / 60_000) * rt.def.decayPerMinute * this._decayMultiplier;
          rt.value = Math.max(rt.def.min, rt.value - decayAmount);
          rt.decayAcc = 0;
          rt.level = this._resolveLevel(rt.def, rt.value);
          if (rt.level !== prev) {
            this._bus.emit("attribute:level-change", {
              key,
              level: rt.level,
              value: rt.value,
              prev,
            });
          }
        }
      }

      // Dependency check
      if (rt.def.dependencies?.length) {
        rt.depCheckAcc += deltaMs;
        if (rt.depCheckAcc >= DEP_CHECK_INTERVAL_MS) {
          let totalAdj = 0;
          for (const dep of rt.def.dependencies) {
            const sourceLevel = this.getLevel(dep.sourceKey);
            if (sourceLevel) {
              totalAdj += dep.effect(sourceLevel);
            }
          }
          if (totalAdj !== 0) {
            this.adjust(key, totalAdj);
          }
          rt.depCheckAcc = 0;
        }
      }

      // Periodic save
      rt.saveAcc += deltaMs;
      if (rt.saveAcc >= SAVE_INTERVAL_MS) {
        this._store.save(key, { value: rt.value, updatedAt: Date.now() });
        rt.saveAcc = 0;
      }
    }
  }

  // ─── Internal ───

  private _resolveLevel(def: AttributeDef, value: number): string {
    // levels are sorted ascending by threshold; pick the highest that value meets
    let result = def.levels[0]?.name ?? "unknown";
    for (const lvl of def.levels) {
      if (value >= lvl.threshold) {
        result = lvl.name;
      }
    }
    return result;
  }
}
