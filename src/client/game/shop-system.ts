/**
 * Character Engine — ShopSystem
 *
 * Manages the star-coin wallet and in-game shop.
 * Coins are earned through gameplay only (tasks, login, level-up, achievements).
 * Shop items have daily/weekly purchase limits.
 *
 * Persistence: wallet.json + shop-purchases.json
 */

import type { PersistenceStore } from "./attribute-engine.ts";
import type { EventBus } from "./event-bus.ts";
import type { InventorySystem } from "./inventory-system.ts";
import { ITEM_DEFS } from "./inventory-system.ts";
import type { LevelSystem } from "./level-system.ts";

// ─── Types ───

export interface ShopItemDef {
  id: string; // matches ITEM_DEFS key
  price: number; // star-coin cost
  dailyLimit: number; // max purchases per day (0 = unlimited)
  weeklyLimit?: number; // max purchases per week (optional)
  unlockLevel?: number; // minimum character level to buy (default 1)
}

export interface WalletInfo {
  coins: number;
  totalEarned: number;
  totalSpent: number;
}

export interface ShopListItem extends ShopItemDef {
  /** How many purchased today */
  todayBought: number;
  /** How many purchased this week */
  weekBought: number;
  /** Whether the player can buy right now */
  canBuy: boolean;
  /** Reason if canBuy is false */
  reason?: string;
}

export interface BuyResult {
  ok: boolean;
  reason?: string;
  wallet?: WalletInfo;
}

// ─── Shop catalog (from design doc §9.2) ───

export const SHOP_CATALOG: ShopItemDef[] = [
  // ── Lv.1 · single-attribute basics ──
  { id: "巴别鱼罐头", price: 20, dailyLimit: 5 },
  { id: "不要恐慌胶囊", price: 15, dailyLimit: 5 },
  { id: "马文牌退烧贴", price: 25, dailyLimit: 3 },
  // ── Lv.3 · single-attribute variants ──
  { id: "宇宙棉花糖", price: 12, dailyLimit: 10, unlockLevel: 3 },
  { id: "星际薯条", price: 15, dailyLimit: 8, unlockLevel: 3 },
  // ── Lv.5 · dual attributes begin (with trade-offs) ──
  { id: "毛巾", price: 40, dailyLimit: 3, unlockLevel: 5 },
  { id: "假装正常药水", price: 30, dailyLimit: 3, unlockLevel: 5 },
  // ── Lv.8 · dual attributes, primary/secondary ──
  { id: "心灵感应茶", price: 45, dailyLimit: 3, unlockLevel: 8 },
  { id: "猫薄荷星云", price: 40, dailyLimit: 3, unlockLevel: 8 },
  // ── Lv.10 · strong dual attributes ──
  { id: "福特的三明治", price: 60, dailyLimit: 2, unlockLevel: 10 },
  { id: "概率修复喷雾", price: 55, dailyLimit: 2, unlockLevel: 10 },
  // ── Lv.14 · dual attributes + special effects arrive ──
  { id: "泛银河爆破饮", price: 80, dailyLimit: 2, unlockLevel: 14 },
  { id: "沃贡诗集护盾", price: 75, dailyLimit: 2, unlockLevel: 14 },
  { id: "时间漩涡甜甜圈", price: 90, dailyLimit: 2, unlockLevel: 14 },
  // ── Lv.18 · triple attributes / strong single attribute ──
  {
    id: "深思重启针",
    price: 150,
    dailyLimit: 0,
    weeklyLimit: 2,
    unlockLevel: 18,
  },
  { id: "无限非概率燃料", price: 120, dailyLimit: 1, unlockLevel: 18 },
  // ── Lv.22 · all attributes + special effects ──
  {
    id: "生命宇宙万物答案",
    price: 250,
    dailyLimit: 1,
    unlockLevel: 22,
  },
  {
    id: "马格拉斯定制星球",
    price: 280,
    dailyLimit: 0,
    weeklyLimit: 1,
    unlockLevel: 22,
  },
  // ── Lv.26 · all attributes + strong special effects ──
  {
    id: "金心号舱票",
    price: 450,
    dailyLimit: 0,
    weeklyLimit: 1,
    unlockLevel: 26,
  },
  // ── Lv.30 · ultimate ──
  {
    id: "上帝的最后留言",
    price: 800,
    dailyLimit: 0,
    weeklyLimit: 1,
    unlockLevel: 30,
  },
];

// ── Sticker shop items: auto-register from sticker-defs ──
import { getShopStickers } from "./sticker-defs.ts";
for (const s of getShopStickers()) {
  SHOP_CATALOG.push({
    id: s.id,
    price: s.price ?? 50,
    dailyLimit: 1,
    unlockLevel: s.unlockLevel ?? 1,
  });
}

// ─── Persistence keys ───

const WALLET_KEY = "wallet";
const PURCHASES_KEY = "shop-purchases";

// ─── Persistence shapes ───

interface WalletState {
  coins: number;
  totalEarned: number;
  totalSpent: number;
}

interface PurchaseRecord {
  /** ISO date "2026-03-08" */
  date: string;
  /** ISO week "2026-W10" */
  week: string;
  /** { itemId: count } for today */
  daily: Record<string, number>;
  /** { itemId: count } for this week */
  weekly: Record<string, number>;
}

// ─── Helpers ───

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoWeek(): string {
  const d = new Date();
  // Simple ISO week calculation
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((d.getTime() - jan1.getTime()) / 86_400_000);
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function computeItemScore(
  def: ShopItemDef,
  state: { power: number; health: number; mood: number; adventureActive: boolean },
  inventory: InventorySystem,
): number {
  let score = 0;

  const itemDef = ITEM_DEFS[def.id];
  const category = itemDef?.category;

  if (state.power < 60 && category === "food") {
    score += 30;
  }
  if (state.health < 40 && category === "medicine") {
    score += 30;
  }
  if (state.mood < 30 && category === "toy") {
    score += 30;
  }

  if (state.adventureActive && itemDef?.adventureEffect) {
    score += 20;
  }

  const hasItem = inventory.list().some((i) => i.itemId === def.id && i.quantity > 0);
  if (!hasItem) {
    score += 15;
  }

  return score;
}

// ─── System ───

export class ShopSystem {
  private _bus: EventBus;
  private _store: PersistenceStore;
  private _inventory: InventorySystem;
  private _levels: LevelSystem;

  private _coins: number = 0;
  private _totalEarned: number = 0;
  private _totalSpent: number = 0;

  private _purchaseDate: string = "";
  private _purchaseWeek: string = "";
  private _dailyPurchases: Record<string, number> = {};
  private _weeklyPurchases: Record<string, number> = {};

  constructor(
    bus: EventBus,
    store: PersistenceStore,
    inventory: InventorySystem,
    levels: LevelSystem,
  ) {
    this._bus = bus;
    this._store = store;
    this._inventory = inventory;
    this._levels = levels;

    // Load wallet
    const walletSaved = this._store.load(WALLET_KEY) as WalletState | null;
    if (walletSaved) {
      this._coins = walletSaved.coins ?? 0;
      this._totalEarned = walletSaved.totalEarned ?? 0;
      this._totalSpent = walletSaved.totalSpent ?? 0;
    }

    // Load purchase records
    const purchSaved = this._store.load(PURCHASES_KEY) as PurchaseRecord | null;
    if (purchSaved) {
      this._purchaseDate = purchSaved.date ?? "";
      this._purchaseWeek = purchSaved.week ?? "";
      this._dailyPurchases = purchSaved.daily ?? {};
      this._weeklyPurchases = purchSaved.weekly ?? {};
    }

    // Reset stale records
    this._ensureFresh();
  }

  // ─── Wallet ───

  /** Add coins (from tasks, login, achievements, level-up) */
  earnCoins(amount: number, source: string): void {
    if (amount <= 0) {
      return;
    }
    this._coins += amount;
    this._totalEarned += amount;
    this._bus.emit("shop:coin-earn", { amount, source, balance: this._coins });
    this._saveWallet();
  }

  /** Get current wallet info */
  getWallet(): WalletInfo {
    return {
      coins: this._coins,
      totalEarned: this._totalEarned,
      totalSpent: this._totalSpent,
    };
  }

  /** Spend coins (for adventure book generation, etc.) */
  spendCoins(amount: number, reason: string): { ok: boolean; reason?: string } {
    if (amount <= 0) {
      return { ok: false, reason: "invalid_amount" };
    }
    if (this._coins < amount) {
      return { ok: false, reason: "insufficient_coins" };
    }

    this._coins -= amount;
    this._totalSpent += amount;
    this._bus.emit("shop:coin-spend", { amount, reason, balance: this._coins });
    this._saveWallet();
    return { ok: true };
  }

  // ─── Shop ───

  /** List all shop items with purchase state */
  listShop(state?: {
    power: number;
    health: number;
    mood: number;
    adventureActive: boolean;
  }): ShopListItem[] {
    this._ensureFresh();
    const playerLevel = this._levels.level;

    const items = SHOP_CATALOG.map((def) => {
      const todayBought = this._dailyPurchases[def.id] ?? 0;
      const weekBought = this._weeklyPurchases[def.id] ?? 0;
      const { canBuy, reason } = this._checkCanBuy(def, todayBought, weekBought, playerLevel);

      return {
        ...def,
        todayBought,
        weekBought,
        canBuy,
        reason,
      };
    });

    if (state) {
      items.sort((a, b) => {
        const scoreA = computeItemScore(a, state, this._inventory);
        const scoreB = computeItemScore(b, state, this._inventory);
        return scoreB - scoreA; // descending
      });
    }

    return items;
  }

  /** Purchase an item */
  buy(itemId: string, qty: number = 1): BuyResult {
    this._ensureFresh();

    const def = SHOP_CATALOG.find((d) => d.id === itemId);
    if (!def) {
      return { ok: false, reason: "item_not_found" };
    }

    if (qty < 1) {
      return { ok: false, reason: "invalid_quantity" };
    }

    const todayBought = this._dailyPurchases[def.id] ?? 0;
    const weekBought = this._weeklyPurchases[def.id] ?? 0;
    const playerLevel = this._levels.level;

    // Check each unit
    for (let i = 0; i < qty; i++) {
      const { canBuy, reason } = this._checkCanBuy(
        def,
        todayBought + i,
        weekBought + i,
        playerLevel,
      );
      if (!canBuy) {
        return { ok: false, reason };
      }
    }

    const totalCost = def.price * qty;
    if (this._coins < totalCost) {
      return { ok: false, reason: "insufficient_coins" };
    }

    // Execute purchase
    this._coins -= totalCost;
    this._totalSpent += totalCost;
    this._dailyPurchases[def.id] = todayBought + qty;
    this._weeklyPurchases[def.id] = weekBought + qty;

    // Add to inventory
    this._inventory.addItem(itemId, qty);

    this._bus.emit("shop:buy", {
      itemId,
      qty,
      totalCost,
      balance: this._coins,
    });

    this._saveWallet();
    this._savePurchases();

    return { ok: true, wallet: this.getWallet() };
  }

  // ─── Internals ───

  private _checkCanBuy(
    def: ShopItemDef,
    todayBought: number,
    weekBought: number,
    playerLevel: number,
  ): { canBuy: boolean; reason?: string } {
    if (def.unlockLevel && playerLevel < def.unlockLevel) {
      return { canBuy: false, reason: `需要 Lv.${def.unlockLevel}` };
    }
    if (def.dailyLimit > 0 && todayBought >= def.dailyLimit) {
      return { canBuy: false, reason: "今日已售罄" };
    }
    if (def.weeklyLimit && weekBought >= def.weeklyLimit) {
      return { canBuy: false, reason: "本周已售罄" };
    }
    if (this._coins < def.price) {
      return { canBuy: false, reason: "星币不足" };
    }
    return { canBuy: true };
  }

  private _ensureFresh(): void {
    const today = todayStr();
    const week = isoWeek();

    if (this._purchaseDate !== today) {
      this._purchaseDate = today;
      this._dailyPurchases = {};
    }
    if (this._purchaseWeek !== week) {
      this._purchaseWeek = week;
      this._weeklyPurchases = {};
    }
  }

  private _saveWallet(): void {
    this._store.save(WALLET_KEY, {
      coins: this._coins,
      totalEarned: this._totalEarned,
      totalSpent: this._totalSpent,
    });
  }

  private _savePurchases(): void {
    this._store.save(PURCHASES_KEY, {
      date: this._purchaseDate,
      week: this._purchaseWeek,
      daily: this._dailyPurchases,
      weekly: this._weeklyPurchases,
    });
  }
}
