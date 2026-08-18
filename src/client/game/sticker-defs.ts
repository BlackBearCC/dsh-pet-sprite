/**
 * Sticker definitions — 贴纸目录表
 *
 * 贴纸是可收集的装饰品, 贴在技能卡上提供视觉标识。
 * emoji 零成本渲染, 未来可升级为 Texture2D。
 * 复用 inventory (category="sticker") + shop 系统存储和出售。
 */

export type StickerRarity = "common" | "rare" | "epic" | "legendary";
export type StickerCategory = "skill" | "chat" | "decor";

export interface StickerDef {
  id: string;
  name: string;
  emoji: string;
  category: StickerCategory;
  rarity: StickerRarity;
  description: string;
  source: "shop" | "adventure" | "event" | "default";
  price?: number;
  unlockLevel?: number;
}

/** 稀有度 → 边框色 (对应 BookT token, Godot 侧映射) */
export const RARITY_COLORS: Record<StickerRarity, string> = {
  common: "INK_FAINT",
  rare: "MG_BLUE",
  epic: "MG_GOLD",
  legendary: "MG_RED",
};

/** 默认贴纸 (角色创建时 grant) */
export const DEFAULT_STICKER_IDS = [
  "sticker_default_star",
  "sticker_default_heart",
  "sticker_default_leaf",
];

export const STICKER_CATALOG: StickerDef[] = [
  // ── 默认贴纸 (source=default, 角色创建即拥有) ──
  {
    id: "sticker_default_star",
    name: "小星星",
    emoji: "⭐",
    category: "skill",
    rarity: "common",
    description: "每个人都有一颗星星。",
    source: "default",
  },
  {
    id: "sticker_default_heart",
    name: "小心心",
    emoji: "💛",
    category: "skill",
    rarity: "common",
    description: "暖呼呼的。",
    source: "default",
  },
  {
    id: "sticker_default_leaf",
    name: "小叶子",
    emoji: "🌿",
    category: "skill",
    rarity: "common",
    description: "新鲜摘的。",
    source: "default",
  },

  // ── 技术域 ──
  {
    id: "sticker_tech_bug",
    name: "小虫子",
    emoji: "🐛",
    category: "skill",
    rarity: "common",
    description: "又来 bug 了。",
    source: "shop",
    price: 30,
    unlockLevel: 1,
  },
  {
    id: "sticker_tech_rocket",
    name: "小火箭",
    emoji: "🚀",
    category: "skill",
    rarity: "rare",
    description: "一键部署。",
    source: "shop",
    price: 80,
    unlockLevel: 3,
  },
  {
    id: "sticker_tech_lightning",
    name: "闪电",
    emoji: "⚡",
    category: "skill",
    rarity: "epic",
    description: "快到看不见。",
    source: "shop",
    price: 200,
    unlockLevel: 8,
  },

  // ── 创作域 ──
  {
    id: "sticker_art_brush",
    name: "画笔",
    emoji: "🎨",
    category: "skill",
    rarity: "common",
    description: "随手涂鸦。",
    source: "shop",
    price: 30,
    unlockLevel: 1,
  },
  {
    id: "sticker_art_fire",
    name: "灵感之火",
    emoji: "🔥",
    category: "skill",
    rarity: "rare",
    description: "烧不尽的创意。",
    source: "shop",
    price: 80,
    unlockLevel: 3,
  },
  {
    id: "sticker_art_crown",
    name: "创作之冠",
    emoji: "👑",
    category: "skill",
    rarity: "legendary",
    description: "作品封神。",
    source: "shop",
    price: 500,
    unlockLevel: 15,
  },

  // ── 办公域 ──
  {
    id: "sticker_office_clip",
    name: "回形针",
    emoji: "📎",
    category: "skill",
    rarity: "common",
    description: "夹住一切。",
    source: "shop",
    price: 20,
    unlockLevel: 1,
  },
  {
    id: "sticker_office_mug",
    name: "咖啡杯",
    emoji: "☕",
    category: "skill",
    rarity: "rare",
    description: "续命专用。",
    source: "shop",
    price: 60,
    unlockLevel: 3,
  },

  // ── 探索域 ──
  {
    id: "sticker_explore_compass",
    name: "指南针",
    emoji: "🧭",
    category: "skill",
    rarity: "common",
    description: "永远向前。",
    source: "shop",
    price: 30,
    unlockLevel: 1,
  },
  {
    id: "sticker_explore_map",
    name: "藏宝图",
    emoji: "🗺️",
    category: "skill",
    rarity: "rare",
    description: "X 标记处。",
    source: "shop",
    price: 100,
    unlockLevel: 5,
  },
  {
    id: "sticker_explore_gem",
    name: "宝石",
    emoji: "💎",
    category: "skill",
    rarity: "legendary",
    description: "稀世珍宝。",
    source: "shop",
    price: 600,
    unlockLevel: 18,
  },

  // ── 生活域 ──
  {
    id: "sticker_life_sun",
    name: "小太阳",
    emoji: "☀️",
    category: "skill",
    rarity: "common",
    description: "暖洋洋。",
    source: "shop",
    price: 25,
    unlockLevel: 1,
  },
  {
    id: "sticker_life_moon",
    name: "小月亮",
    emoji: "🌙",
    category: "skill",
    rarity: "rare",
    description: "晚安。",
    source: "shop",
    price: 70,
    unlockLevel: 3,
  },

  // ── 社交域 ──
  {
    id: "sticker_social_handshake",
    name: "握手",
    emoji: "🤝",
    category: "skill",
    rarity: "common",
    description: "合作愉快。",
    source: "shop",
    price: 30,
    unlockLevel: 1,
  },
  {
    id: "sticker_social_megaphone",
    name: "大喇叭",
    emoji: "📣",
    category: "skill",
    rarity: "rare",
    description: "全场听到。",
    source: "shop",
    price: 90,
    unlockLevel: 5,
  },

  // ── 情感域 ──
  {
    id: "sticker_emotion_rainbow",
    name: "彩虹",
    emoji: "🌈",
    category: "skill",
    rarity: "rare",
    description: "雨后天晴。",
    source: "shop",
    price: 80,
    unlockLevel: 3,
  },
  {
    id: "sticker_emotion_aurora",
    name: "极光",
    emoji: "🌠",
    category: "skill",
    rarity: "epic",
    description: "一生难忘。",
    source: "shop",
    price: 250,
    unlockLevel: 10,
  },

  // ── 娱乐域 ──
  {
    id: "sticker_fun_dice",
    name: "骰子",
    emoji: "🎲",
    category: "skill",
    rarity: "common",
    description: "赌一把。",
    source: "shop",
    price: 25,
    unlockLevel: 1,
  },
  {
    id: "sticker_fun_joystick",
    name: "手柄",
    emoji: "🎮",
    category: "skill",
    rarity: "rare",
    description: "再来一局。",
    source: "shop",
    price: 75,
    unlockLevel: 3,
  },

  // ── 通用 / 冒险奖励 ──
  {
    id: "sticker_adventure_key",
    name: "金钥匙",
    emoji: "🗝️",
    category: "skill",
    rarity: "epic",
    description: "打开未知之门。",
    source: "adventure",
  },
  {
    id: "sticker_event_lantern",
    name: "灯笼",
    emoji: "🏮",
    category: "skill",
    rarity: "epic",
    description: "节日限定。",
    source: "event",
  },
];

export const STICKER_MAP: Record<string, StickerDef> = Object.fromEntries(
  STICKER_CATALOG.map((s) => [s.id, s]),
);

export function getStickerById(id: string): StickerDef | undefined {
  return STICKER_MAP[id];
}

/** 商城出售的贴纸 (source=shop) */
export function getShopStickers(): StickerDef[] {
  return STICKER_CATALOG.filter((s) => s.source === "shop");
}

/** 默认贴纸 (source=default) */
export function getDefaultStickers(): StickerDef[] {
  return STICKER_CATALOG.filter((s) => s.source === "default");
}
