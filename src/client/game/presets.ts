/**
 * Character Engine — Default Presets
 *
 * Standard attribute definitions that replicate the original desktop
 * character's MoodSystem, HungerSystem, and HealthSystem behavior.
 *
 * Clients can use these defaults or define their own.
 */

import type { AttributeDef } from "./attribute-engine.ts";

export const ATTR_MOOD: AttributeDef = {
  key: "mood",
  name: "情感",
  initial: 80,
  min: 15,
  max: 100,
  decayPerMinute: 0.06, // 慢速离线: 8h 约扣 1/5 (含 Lv21-25 系数 0.7 → 480*0.06*0.7≈20)
  maxOfflineHours: 8,
  levels: [
    { name: "sad", threshold: 0 },
    { name: "normal", threshold: 30 },
    { name: "happy", threshold: 52 },
    { name: "joyful", threshold: 78 },
  ],
};

export const ATTR_POWER: AttributeDef = {
  key: "power",
  name: "电量",
  initial: 210,
  min: 0,
  max: 300,
  decayPerMinute: 0.18, // 慢速衰减(离线 8h 封顶约扣 1/5); 另叠加输入 token 掉电(见 chat-eval)
  maxOfflineHours: 8,
  levels: [
    { name: "starving", threshold: 0 },
    { name: "hungry", threshold: 30 },
    { name: "normal", threshold: 105 },
    { name: "full", threshold: 225 },
  ],
};

export const ATTR_HEALTH: AttributeDef = {
  key: "health",
  name: "健康",
  initial: 100,
  min: 0,
  max: 100,
  decayPerMinute: 0, // driven by dependencies, not time
  maxOfflineHours: 4,
  levels: [
    { name: "sick", threshold: 0 },
    { name: "subhealthy", threshold: 35 },
    { name: "healthy", threshold: 70 },
  ],
  dependencies: [
    {
      sourceKey: "power",
      effect: (level) => {
        if (level === "starving") {
          return -0.5;
        }
        if (level === "hungry") {
          return -0.2;
        }
        if (level === "full") {
          return 0.15;
        }
        return 0;
      },
    },
    {
      sourceKey: "mood",
      effect: (level) => {
        if (level === "sad") {
          return -0.2;
        }
        if (level === "joyful") {
          return 0.15;
        }
        return 0;
      },
    },
  ],
};

/** All default attributes bundled together */
export const DEFAULT_ATTRIBUTES: AttributeDef[] = [ATTR_MOOD, ATTR_POWER, ATTR_HEALTH];
