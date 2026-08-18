/**
 * Character Engine — InventorySystem
 *
 * Manages the character's item inventory (backpack).
 * Items have effects, cooldowns, and quantity limits.
 */

import type { PersistenceStore } from "./attribute-engine.ts";
import type { EventBus } from "./event-bus.ts";

// ─── Types ───

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  category: "food" | "toy" | "medicine" | "special" | "collection";
  description: string;
  /** Prose shown after use; separate from the catalog description and pet reaction bubbles. */
  useText?: string;
  effects: {
    power?: number;
    mood?: number;
    health?: number;
    exp?: number;
  };
  /** Use cooldown in ms (undefined = no cooldown) */
  cooldownMs?: number;
  /** If true, item is always available and not consumed */
  permanent?: boolean;
  /** If true, item is unlimited (free, but respects cooldown) */
  unlimited?: boolean;
  /** Item tier (1-5), higher = more rare/powerful */
  tier?: number;
  /** Adventure buff effect when equipped */
  adventureEffect?: {
    type: "roll_bonus" | "reroll" | "damage_ignore" | "theme_bonus";
    value: number;
    condition?: string; // e.g. "puzzle" or "forest,cave"
  };
  /** For collection items: additional metadata (e.g., adventure book data) */
  metadata?: Record<string, unknown>;
}

export interface InventorySlot {
  itemId: string;
  quantity: number;
  lastUsedAt?: number;
}

// ─── Item Definitions ───

export const ITEM_DEFS: Record<string, ItemDef> = {
  // ─── Lv.1 · 单属性为主，解决基本需求 ───
  巴别鱼罐头: {
    id: "巴别鱼罐头",
    name: "巴别鱼罐头",
    icon: "🐠",
    category: "food",
    description: '美味的鱼罐头，管饱。——"把它塞进耳朵里就能听懂宇宙一切语言。" ——指南',
    useText: "罐头开封后，语言能力没有增加，但电量感以十分自信的语气宣布自己有效。",
    effects: { power: 50 },
    tier: 1,
    adventureEffect: { type: "roll_bonus", value: 2, condition: "puzzle" },
  },
  不要恐慌胶囊: {
    id: "不要恐慌胶囊",
    name: "不要恐慌胶囊",
    icon: "💊",
    category: "medicine",
    description: '吞下去，心情好起来了。——"DON\'T PANIC." ——银河系漫游指南封面',
    useText: "胶囊吞下后，恐慌被折成一张很小的纸条，夹回封面背后。",
    effects: { mood: 15 },
    tier: 1,
    adventureEffect: { type: "damage_ignore", value: 1 },
  },
  马文牌退烧贴: {
    id: "马文牌退烧贴",
    name: "马文牌退烧贴",
    icon: "🤖",
    category: "medicine",
    description: '贴上后身体好多了。——"我脑子有行星那么大，却只能贴退烧贴。" ——马文',
    useText: "退烧贴贴上后，体温终于承认自己刚才有点夸张。",
    effects: { health: 20 },
    tier: 1,
  },

  // ─── Lv.3 · 仍然单属性，但效果略强或有侧重 ───
  宇宙棉花糖: {
    id: "宇宙棉花糖",
    name: "宇宙棉花糖",
    icon: "☁️",
    category: "food",
    description: '入口即化，纯粹的快乐。——"在零重力下它会自己飘进嘴里。" ——星际甜品指南',
    useText: "棉花糖消散得像一朵有临时通行证的云，甜味留下了签收单。",
    effects: { mood: 12 },
    tier: 1,
  },
  星际薯条: {
    id: "星际薯条",
    name: "星际薯条",
    icon: "🍟",
    category: "food",
    description: '宇宙快餐标配，分量不大但够顶一阵。——"文明的唯一共识就是薯条。" ——福特·普里弗克特',
    useText: "薯条被逐根注销，账本认定文明暂时没有崩塌。",
    effects: { power: 35 },
    tier: 1,
  },
  // ─── Lv.5 · 开始出现双属性，但有代价或主次分明 ───
  毛巾: {
    id: "毛巾",
    name: "毛巾",
    icon: "🧣",
    category: "toy",
    description: '安全感满满，但玩着玩着会耗电。——"知道毛巾在哪的人，值得信赖。" ——指南',
    useText: "毛巾展开后，安全感像一条备用路线，被认真塞进了账本边角。",
    effects: { mood: 18, power: -5 },
    tier: 2,
    adventureEffect: { type: "roll_bonus", value: 1 },
  },
  假装正常药水: {
    id: "假装正常药水",
    name: "假装正常药水",
    icon: "🧪",
    category: "medicine",
    description: '喝完看起来完全正常了。——"正常只是一种统计学幻觉。" ——赞福德·毕乔布莱斯特',
    useText: "药水完成了外观层面的正常化，剩下的荒谬被标注为系统特性。",
    effects: { health: 15 },
    tier: 2,
  },

  // ─── Lv.8 · 双属性，有明确主副 ───
  心灵感应茶: {
    id: "心灵感应茶",
    name: "心灵感应茶",
    icon: "🍵",
    category: "food",
    description: '据说喝完能短暂读懂猫的心思。——"它想要的只是鱼罐头，一直都是。" ——匿名猫语翻译器',
    useText: "茶杯见底后，猫语翻译器短暂亮灯，又立刻假装无事发生。",
    effects: { power: 30, mood: 8 },
    tier: 2,
  },
  猫薄荷星云: {
    id: "猫薄荷星云",
    name: "猫薄荷星云",
    icon: "🌿",
    category: "toy",
    description: '稀有猫薄荷，极度愉悦但消耗体力。——"整个星系都是我的猫抓板。" ——某只太空猫',
    useText: "星云被拨散后，快乐以螺旋形式占领了附近的注释栏。",
    effects: { mood: 22, power: -10 },
    tier: 2,
  },

  // ─── Lv.10 · 双属性，数值开始强力 ───
  福特的三明治: {
    id: "福特的三明治",
    name: "福特的三明治",
    icon: "🥪",
    category: "food",
    description:
      '福特的私房配方，份量管够。——"在毁灭前吃顿好的，这是银河系的传统。" ——福特·普里弗克特',
    useText: "三明治被归入灾前标准餐，电量在签字栏里写下撤退。",
    effects: { power: 65, mood: 5 },
    tier: 3,
  },
  概率修复喷雾: {
    id: "概率修复喷雾",
    name: "概率修复喷雾",
    icon: "💨",
    category: "medicine",
    description:
      '非概率物理学的医疗应用。——"在一个不可能的宇宙里，治愈也是不可能的简单。" ——非概率实验室',
    useText: "喷雾落下后，受损概率被临时调回比较像现实的范围。",
    effects: { health: 30 },
    tier: 3,
    adventureEffect: { type: "reroll", value: 1 },
  },

  // ─── Lv.14 · 双属性强力 + 开始出现特殊效果 ───
  泛银河爆破饮: {
    id: "泛银河爆破饮",
    name: "泛银河爆破饮",
    icon: "🌌",
    category: "food",
    description: '喝完像被柠檬包裹的金砖砸中脑袋。——"宇宙中最烈的酒。" ——指南',
    useText: "饮料抵达胃部时没有敲门，随后把精神状态改写成大写备注。",
    effects: { power: 80, mood: 10 },
    tier: 3,
    adventureEffect: { type: "roll_bonus", value: 2 },
  },
  沃贡诗集护盾: {
    id: "沃贡诗集护盾",
    name: "沃贡诗集护盾",
    icon: "📖",
    category: "medicine",
    description: '听完沃贡诗活下来后获得的免疫力。——"宇宙第三差的诗，但吃不死人。" ——指南',
    useText: "诗集被合上后，幸存本身成为一层很不情愿的护盾。",
    effects: { health: 35, mood: 5 },
    tier: 3,
    adventureEffect: { type: "damage_ignore", value: 1 },
  },
  时间漩涡甜甜圈: {
    id: "时间漩涡甜甜圈",
    name: "时间漩涡甜甜圈",
    icon: "🍩",
    category: "food",
    description: '扭曲时空的甜甜圈，加速一切冷却。——"时间是一种幻觉，午餐时间尤其如此。" ——福特',
    useText: "甜甜圈咬开的一瞬间，时间排队顺序被悄悄改成了甜味优先。",
    effects: { power: 40, mood: 10 },
    tier: 3,
    metadata: { cooldownReduction: 0.2 },
    adventureEffect: { type: "reroll", value: 1 },
  },

  // ─── Lv.18 · 三属性，真正的好东西 ───
  深思重启针: {
    id: "深思重启针",
    name: "深思重启针",
    icon: "💉",
    category: "medicine",
    description: '完全恢复健康。——"七百五十万年的计算，总得有个重启按钮。" ——深思',
    useText: "针剂启动后，身体把旧结论清空，重新计算出一个更能继续运行的答案。",
    effects: { health: 100 },
    tier: 4,
  },
  无限非概率燃料: {
    id: "无限非概率燃料",
    name: "无限非概率燃料",
    icon: "⚡",
    category: "special",
    description: '黄金之心号的核心动力源。——"只要你不在意变成一条沙丁鱼的概率。" ——崔莉恩',
    useText: "燃料入账后，现实短暂绕路；账本只记录结果，不记录路线。",
    effects: { power: 60, mood: 15, health: 10 },
    tier: 4,
    adventureEffect: { type: "roll_bonus", value: 3 },
  },

  // ─── Lv.22 · 全属性 + 特殊效果 ───
  生命宇宙万物答案: {
    id: "生命宇宙万物答案",
    name: "生命宇宙万物答案",
    icon: "4️⃣2️⃣",
    category: "special",
    description: '答案是42，但问题是什么？使用后2h经验+50%。——"四十二。" ——深思',
    useText: "答案被确认仍是数字，问题被暂时放弃追责。",
    effects: { mood: 20, power: 20, health: 20 },
    tier: 4,
    metadata: { expBoost: 0.5, expBoostDurationMs: 2 * 3600 * 1000 },
  },
  马格拉斯定制星球: {
    id: "马格拉斯定制星球",
    name: "马格拉斯定制星球",
    icon: "🪐",
    category: "toy",
    description:
      '掌心大小的定制星球，把玩时可能触发探险。——"我们造星球，订单排到了五百万年后。" ——马格拉斯工厂',
    useText: "星球在掌心转了一圈，把无聊改造成可出发的地形。",
    effects: { mood: 35 },
    tier: 4,
    metadata: { triggerAdventure: true },
  },

  // ─── Lv.26 · 全属性 + 强特殊效果 ───
  金心号舱票: {
    id: "金心号舱票",
    name: "金心号舱票",
    icon: "🎫",
    category: "special",
    description: '登上黄金之心号！重置一切冷却。——"偷来的飞船开起来更带劲。" ——赞福德',
    useText: "舱票打孔后，所有冷却被请到另一条时间线上重新排队。",
    effects: { mood: 30, power: 30, health: 30 },
    tier: 5,
    metadata: { resetAllCooldowns: true },
  },

  // ─── Lv.30 · 终极道具 ───
  上帝的最后留言: {
    id: "上帝的最后留言",
    name: "上帝的最后留言",
    icon: "✉️",
    category: "special",
    description: '使用后24h解锁隐藏人格。——"抱歉给你们带来不便。" ——上帝',
    useText: "留言被读完后，世界没有解释自己，只留下一个可疑的运行许可。",
    effects: { mood: 50, power: 50, health: 50 },
    tier: 5,
    metadata: { hiddenPersona: true, hiddenPersonaDurationMs: 24 * 3600 * 1000 },
  },
};

// ── Sticker items: auto-register from sticker-defs ──
import { STICKER_CATALOG } from "./sticker-defs.ts";
for (const s of STICKER_CATALOG) {
  if (!ITEM_DEFS[s.id]) {
    ITEM_DEFS[s.id] = {
      id: s.id,
      name: s.name,
      icon: s.emoji,
      category: "collection",
      description: s.description,
      effects: {},
      metadata: { sticker: true, stickerRarity: s.rarity, stickerCategory: s.category },
    };
  }
}

const MAX_STACK = 99;
const STORE_KEY = "inventory";

// ─── Helper Functions ───

/** Get the tier of an item (defaults to 1 if not specified) */
export function getItemTier(itemId: string): number {
  const def = ITEM_DEFS[itemId];
  return def?.tier ?? 1;
}

// ─── Persistence shape ───

interface InventoryState {
  slots: InventorySlot[];
}

// ─── System ───

export class InventorySystem {
  private _bus: EventBus;
  private _store: PersistenceStore;
  private _slots: Map<string, InventorySlot>;
  private _capacity: number;

  constructor(bus: EventBus, store: PersistenceStore, capacity: number = 20) {
    this._bus = bus;
    this._store = store;
    this._slots = new Map();
    this._capacity = capacity;

    const saved = this._store.load(STORE_KEY) as InventoryState | null;
    if (saved?.slots) {
      for (const slot of saved.slots) {
        this._slots.set(slot.itemId, slot);
      }
    }
  }

  setCapacity(capacity: number): void {
    this._capacity = capacity;
  }

  /** Get item definition by ID */
  getItemDef(itemId: string): ItemDef | null {
    return ITEM_DEFS[itemId] ?? null;
  }

  /** Register a dynamic collection item (e.g., adventure book) */
  registerCollectionItem(def: ItemDef): void {
    if (ITEM_DEFS[def.id]) {
      return;
    } // already exists
    ITEM_DEFS[def.id] = { ...def, category: "collection", permanent: true };
  }

  /** Add a collection item directly with custom metadata */
  addCollectionItem(
    id: string,
    name: string,
    icon: string,
    description: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    // Register the item definition if not exists
    if (!ITEM_DEFS[id]) {
      this.registerCollectionItem({
        id,
        name,
        icon,
        category: "collection",
        description,
        effects: {},
        permanent: true,
        metadata,
      });
    }

    // Add to inventory slots
    if (!this._slots.has(id)) {
      if (this._slots.size >= this._capacity) {
        return false;
      }
      this._slots.set(id, { itemId: id, quantity: 1 });
      this._save();
    }
    return true;
  }

  /** Get all collection items */
  getCollections(): Array<{
    itemId: string;
    def: ItemDef;
    metadata?: Record<string, unknown>;
  }> {
    return this.list()
      .filter((item) => item.def.category === "collection")
      .map((item) => ({
        itemId: item.itemId,
        def: item.def,
        metadata: item.def.metadata,
      }));
  }

  // ─── Collection Category System ───

  /** Collection category definition */
  static readonly COLLECTION_CATEGORIES = {
    adventure_book: {
      id: "adventure_book",
      name: "冒险书",
      icon: "📖",
      description: "你的冒险故事集",
    },
    memorial: {
      id: "memorial",
      name: "纪念品",
      icon: "🏆",
      description: "珍贵的回忆",
    },
    achievement: {
      id: "achievement",
      name: "成就徽章",
      icon: "🏅",
      description: "达成的成就",
    },
    special: {
      id: "special",
      name: "特殊物品",
      icon: "✨",
      description: "特殊的收藏品",
    },
  } as const;

  /** Get collections grouped by category */
  getCollectionsByCategory(): Record<
    string,
    Array<{
      itemId: string;
      def: ItemDef;
      metadata?: Record<string, unknown>;
    }>
  > {
    const result: Record<
      string,
      Array<{
        itemId: string;
        def: ItemDef;
        metadata?: Record<string, unknown>;
      }>
    > = {};

    // Initialize all categories
    for (const catId of Object.keys(InventorySystem.COLLECTION_CATEGORIES)) {
      result[catId] = [];
    }

    // Group collections by type
    const collections = this.getCollections();
    for (const item of collections) {
      // Determine category from metadata
      const meta = item.def.metadata ?? {};
      let category = "special";

      if (meta.book) {
        category = "adventure_book";
      } else if (meta.memorial) {
        category = "memorial";
      } else if (meta.achievement) {
        category = "achievement";
      }

      result[category].push(item);
    }

    return result;
  }

  /** Get collection items summary for UI */
  getCollectionSummary(): {
    total: number;
    categories: Array<{
      id: string;
      name: string;
      icon: string;
      description: string;
      count: number;
    }>;
  } {
    const grouped = this.getCollectionsByCategory();
    const categories: Array<{
      id: string;
      name: string;
      icon: string;
      description: string;
      count: number;
    }> = [];

    let total = 0;
    for (const [catId, catDef] of Object.entries(InventorySystem.COLLECTION_CATEGORIES)) {
      const items = grouped[catId] ?? [];
      categories.push({
        id: catId,
        name: catDef.name,
        icon: catDef.icon,
        description: catDef.description,
        count: items.length,
      });
      total += items.length;
    }

    return { total, categories };
  }

  /** Read a narrative book (get full content) */
  readNarrativeBook(itemId: string): {
    title: string;
    story: string;
    wordCount: number;
    endings: string;
    scenarioTitle: string;
    starLevel: number;
    createdAt: number;
    type: string;
  } | null {
    const item = this._slots.get(itemId);
    if (!item) {
      return null;
    }

    const def = ITEM_DEFS[itemId];
    if (!def || def.category !== "collection") {
      return null;
    }

    const meta = def.metadata ?? {};
    const book = meta.book as Record<string, unknown> | undefined;

    if (!book) {
      return null;
    }

    return {
      title: book.title as string,
      story: book.story as string,
      wordCount: book.wordCount as number,
      endings: book.endings as string,
      scenarioTitle: book.scenarioTitle as string,
      starLevel: book.starLevel as number,
      createdAt: book.createdAt as number,
      type: book.type as string,
    };
  }

  /** Add items to inventory */
  addItem(itemId: string, qty: number = 1): boolean {
    const def = ITEM_DEFS[itemId];
    if (!def) {
      return false;
    }
    if (def.permanent || def.unlimited) {
      return true;
    } // no need to store quantity

    const existing = this._slots.get(itemId);
    if (existing) {
      existing.quantity = Math.min(MAX_STACK, existing.quantity + qty);
    } else {
      if (this._slots.size >= this._capacity) {
        return false;
      } // full
      this._slots.set(itemId, { itemId, quantity: qty });
    }
    this._save();
    return true;
  }

  /** Use an item. Returns the effects if successful, null if failed. */
  useItem(
    itemId: string,
  ): { effects: Record<string, number>; special?: Record<string, unknown> } | null {
    const def = ITEM_DEFS[itemId];
    if (!def) {
      return null;
    }

    // Check cooldown
    if (def.cooldownMs) {
      const slot = this._slots.get(itemId);
      const lastUsed = slot?.lastUsedAt ?? 0;
      if (Date.now() - lastUsed < def.cooldownMs) {
        return null; // still on cooldown
      }
    }

    // Check quantity (for non-permanent, non-unlimited items)
    if (!def.permanent && !def.unlimited) {
      const slot = this._slots.get(itemId);
      if (!slot || slot.quantity <= 0) {
        return null;
      }
      slot.quantity--;
      if (slot.quantity <= 0) {
        this._slots.delete(itemId);
      }
    }

    // Record cooldown
    if (def.cooldownMs) {
      const slot = this._slots.get(itemId) ?? { itemId, quantity: 0 };
      slot.lastUsedAt = Date.now();
      this._slots.set(itemId, slot);
    }

    const effects: Record<string, number> = {};
    for (const [k, v] of Object.entries(def.effects)) {
      if (v !== undefined) {
        effects[k] = v;
      }
    }

    // ─── 特殊效果处理 ───
    const meta = def.metadata;
    const special: Record<string, unknown> = {};

    if (meta) {
      // 冷却缩减（时间漩涡甜甜圈）
      if (typeof meta.cooldownReduction === "number") {
        const reduction = meta.cooldownReduction;
        for (const [slotId, slot] of this._slots.entries()) {
          if (slot.lastUsedAt && slotId !== itemId) {
            const slotDef = ITEM_DEFS[slotId];
            if (slotDef?.cooldownMs) {
              const elapsed = Date.now() - slot.lastUsedAt;
              const remaining = slotDef.cooldownMs - elapsed;
              if (remaining > 0) {
                // 把 lastUsedAt 往前推，等效于缩短剩余冷却
                slot.lastUsedAt -= Math.floor(remaining * reduction);
              }
            }
          }
        }
        special.cooldownReduction = reduction;
      }

      // 冷却全部重置（金心号舱票）
      if (meta.resetAllCooldowns) {
        for (const slot of this._slots.values()) {
          slot.lastUsedAt = undefined;
        }
        special.resetAllCooldowns = true;
      }

      // 经验加成（生命宇宙万物答案）
      if (typeof meta.expBoost === "number") {
        special.expBoost = meta.expBoost;
        special.expBoostUntil = Date.now() + ((meta.expBoostDurationMs as number) ?? 7200000);
      }

      // 触发探险（马格拉斯定制星球）
      if (meta.triggerAdventure) {
        special.triggerAdventure = true;
      }

      // 隐藏人格（上帝的最后留言）
      if (meta.hiddenPersona) {
        special.hiddenPersona = true;
        special.hiddenPersonaUntil =
          Date.now() + ((meta.hiddenPersonaDurationMs as number) ?? 86400000);
      }
    }

    this._bus.emit("inventory:use", { itemId, effects, special });
    this._save();
    return { effects, ...(Object.keys(special).length > 0 ? { special } : {}) };
  }

  /** Get cooldown remaining in ms (0 = ready) */
  getCooldown(itemId: string): number {
    const def = ITEM_DEFS[itemId];
    if (!def?.cooldownMs) {
      return 0;
    }
    const slot = this._slots.get(itemId);
    if (!slot?.lastUsedAt) {
      return 0;
    }
    return Math.max(0, def.cooldownMs - (Date.now() - slot.lastUsedAt));
  }

  /**
   * Remove qty of an item from inventory **without** applying its mechanical effects.
   * Used for narrative-only consumption (e.g. narrative scenario DM says player gave
   * away / lost / ate an item, and resource changes if any are emitted by DM via
   * narrative.attr.adjust separately). Returns { ok, removed } — false if not present.
   */
  removeItem(itemId: string, qty: number = 1): { ok: boolean; removed: number; reason?: string } {
    const slot = this._slots.get(itemId);
    if (!slot) {
      return { ok: false, removed: 0, reason: "not in inventory" };
    }
    const take = Math.min(qty, slot.quantity);
    if (take <= 0) {
      return { ok: false, removed: 0, reason: "qty must be positive" };
    }
    slot.quantity -= take;
    if (slot.quantity <= 0) {
      this._slots.delete(itemId);
    }
    this._save();
    return { ok: true, removed: take };
  }

  /** Check if an item can be used right now */
  canUse(itemId: string): boolean {
    const def = ITEM_DEFS[itemId];
    if (!def) {
      return false;
    }
    if (this.getCooldown(itemId) > 0) {
      return false;
    }
    if (def.permanent || def.unlimited) {
      return true;
    }
    const slot = this._slots.get(itemId);
    return !!slot && slot.quantity > 0;
  }

  /** List all inventory items with their defs and quantities */
  list(): Array<{
    itemId: string;
    def: ItemDef;
    quantity: number;
    cooldownRemaining: number;
    canUse: boolean;
  }> {
    const result: Array<{
      itemId: string;
      def: ItemDef;
      quantity: number;
      cooldownRemaining: number;
      canUse: boolean;
    }> = [];

    // Always include permanent/unlimited items
    for (const [id, def] of Object.entries(ITEM_DEFS)) {
      if (def.permanent || def.unlimited) {
        result.push({
          itemId: id,
          def,
          quantity: -1,
          cooldownRemaining: this.getCooldown(id),
          canUse: this.canUse(id),
        });
      }
    }

    // Include owned items
    for (const [id, slot] of this._slots) {
      const def = ITEM_DEFS[id];
      if (!def || def.permanent || def.unlimited) {
        continue;
      }
      result.push({
        itemId: id,
        def,
        quantity: slot.quantity,
        cooldownRemaining: this.getCooldown(id),
        canUse: this.canUse(id),
      });
    }

    return result;
  }

  get capacity(): number {
    return this._capacity;
  }

  get usedSlots(): number {
    let count = 0;
    for (const [id] of this._slots) {
      const def = ITEM_DEFS[id];
      if (def?.permanent || def?.unlimited) {
        continue;
      }
      count++;
    }
    return count;
  }

  private _save(): void {
    const slots: InventorySlot[] = [];
    for (const [, slot] of this._slots) {
      slots.push(slot);
    }
    this._store.save(STORE_KEY, { slots });
  }
}
