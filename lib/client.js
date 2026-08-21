window.__ModuleLoader__.load({ id: "dsh-pet-sprite", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));

//#region src/client/game/event-bus.ts
var EventBus = class {
	_handlers = /* @__PURE__ */ new Map();
	on(event, handler) {
		if (!this._handlers.has(event)) this._handlers.set(event, /* @__PURE__ */ new Set());
		const set = this._handlers.get(event);
		set.add(handler);
		return () => set.delete(handler);
	}
	emit(event, data) {
		const set = this._handlers.get(event);
		if (!set) return;
		for (const handler of set) try {
			handler(data);
		} catch (e) {
			console.error(`[character:event-bus] handler error for "${event}":`, e);
		}
	}
	off(event, handler) {
		this._handlers.get(event)?.delete(handler);
	}
	removeAll() {
		this._handlers.clear();
	}
};

//#endregion
//#region src/client/game/attribute-engine.ts
const TICK_INTERVAL_MS = 1e4;
const SAVE_INTERVAL_MS = 3e4;
const DEP_CHECK_INTERVAL_MS = 3e4;
var AttributeEngine = class {
	_attrs = /* @__PURE__ */ new Map();
	_store;
	_bus;
	_decayMultiplier = 1;
	_maxOfflineHoursOverride = null;
	constructor(bus, store) {
		this._bus = bus;
		this._store = store;
	}
	/** Set a global decay multiplier (driven by character level) */
	setDecayMultiplier(multiplier) {
		this._decayMultiplier = multiplier;
	}
	getDecayMultiplier() {
		return this._decayMultiplier;
	}
	/** Override max offline hours for all attributes (driven by character level) */
	setMaxOfflineHours(hours) {
		this._maxOfflineHoursOverride = hours;
	}
	/** Register an attribute definition and restore its state */
	register(def) {
		const saved = this._store.load(def.key);
		let value = def.initial;
		if (saved) {
			value = saved.value;
			if (def.decayPerMinute > 0 && saved.updatedAt) {
				const maxHours = this._maxOfflineHoursOverride ?? def.maxOfflineHours;
				const elapsedMin = Math.min((Date.now() - saved.updatedAt) / 6e4, maxHours * 60);
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
			dirty: true
		});
		this._store.save(def.key, {
			value,
			updatedAt: Date.now()
		});
	}
	/** Adjust an attribute's value by delta */
	adjust(key, delta) {
		const rt = this._attrs.get(key);
		if (!rt) return;
		const prev = rt.level;
		rt.value = Math.max(rt.def.min, Math.min(rt.def.max, rt.value + delta));
		rt.level = this._resolveLevel(rt.def, rt.value);
		rt.dirty = true;
		if (rt.level !== prev) this._bus.emit("attribute:level-change", {
			key,
			level: rt.level,
			value: rt.value,
			prev
		});
		this._store.save(key, {
			value: rt.value,
			updatedAt: Date.now()
		});
	}
	/** Set an attribute to an exact value */
	set(key, value) {
		const rt = this._attrs.get(key);
		if (!rt) return;
		const delta = value - rt.value;
		if (delta !== 0) this.adjust(key, delta);
	}
	/** Get current value */
	getValue(key) {
		return this._attrs.get(key)?.value ?? 0;
	}
	/** Get current level name */
	getLevel(key) {
		return this._attrs.get(key)?.level ?? "";
	}
	/** Get all attribute states (for UI) */
	getAll() {
		const result = [];
		for (const [, rt] of this._attrs) result.push({
			key: rt.def.key,
			name: rt.def.name,
			value: Math.round(rt.value),
			level: rt.level,
			max: rt.def.max
		});
		return result;
	}
	/** Called by game loop every frame. */
	tick(deltaMs) {
		for (const [key, rt] of this._attrs) {
			if (rt.def.decayPerMinute > 0) {
				rt.decayAcc += deltaMs;
				if (rt.decayAcc >= TICK_INTERVAL_MS) {
					const prev = rt.level;
					const decayAmount = rt.decayAcc / 6e4 * rt.def.decayPerMinute * this._decayMultiplier;
					rt.value = Math.max(rt.def.min, rt.value - decayAmount);
					rt.decayAcc = 0;
					rt.level = this._resolveLevel(rt.def, rt.value);
					if (rt.level !== prev) this._bus.emit("attribute:level-change", {
						key,
						level: rt.level,
						value: rt.value,
						prev
					});
				}
			}
			if (rt.def.dependencies?.length) {
				rt.depCheckAcc += deltaMs;
				if (rt.depCheckAcc >= DEP_CHECK_INTERVAL_MS) {
					let totalAdj = 0;
					for (const dep of rt.def.dependencies) {
						const sourceLevel = this.getLevel(dep.sourceKey);
						if (sourceLevel) totalAdj += dep.effect(sourceLevel);
					}
					if (totalAdj !== 0) this.adjust(key, totalAdj);
					rt.depCheckAcc = 0;
				}
			}
			rt.saveAcc += deltaMs;
			if (rt.saveAcc >= SAVE_INTERVAL_MS) {
				this._store.save(key, {
					value: rt.value,
					updatedAt: Date.now()
				});
				rt.saveAcc = 0;
			}
		}
	}
	_resolveLevel(def, value) {
		let result = def.levels[0]?.name ?? "unknown";
		for (const lvl of def.levels) if (value >= lvl.threshold) result = lvl.name;
		return result;
	}
};

//#endregion
//#region src/client/game/level-system.ts
const MAX_LEVEL = 100;
/**
* Cumulative EXP required to reach `level` (formula, max Lv.100).
* Quadratic curve cumExp(L) = 2500 × (L-1)^2, paired with a token=1:1 economy.
* Lv2=2500, Lv10≈200k, Lv23≈1.21M, Lv30≈2.1M, Lv100≈24.5M (max level).
*/
function expForLevel(level) {
	const n = Math.max(0, level - 1);
	return 2500 * n * n;
}
const LEVEL_TIERS = [
	{
		minLevel: 1,
		maxLevel: 5,
		title: "小萌新",
		decayMultiplier: 1
	},
	{
		minLevel: 6,
		maxLevel: 10,
		title: "小帮手",
		decayMultiplier: 1
	},
	{
		minLevel: 11,
		maxLevel: 15,
		title: "好伙伴",
		decayMultiplier: .85
	},
	{
		minLevel: 16,
		maxLevel: 20,
		title: "老搭档",
		decayMultiplier: .75
	},
	{
		minLevel: 21,
		maxLevel: 25,
		title: "灵魂伴侣",
		decayMultiplier: .7
	},
	{
		minLevel: 26,
		maxLevel: 30,
		title: "传说之猫",
		decayMultiplier: .6
	}
];
const STORE_KEY$2 = "level-system";
var LevelSystem = class {
	_bus;
	_store;
	_exp;
	_level;
	constructor(bus, store) {
		this._bus = bus;
		this._store = store;
		this._exp = 0;
		this._level = 1;
		const saved = this._store.load(STORE_KEY$2);
		if (saved) {
			this._exp = saved.exp ?? 0;
			this._level = saved.level ?? 1;
		}
	}
	/** Add EXP from a named source */
	gainExp(amount, source) {
		if (amount <= 0) return;
		this._exp += amount;
		this._bus.emit("level:exp-gain", {
			amount,
			source,
			totalExp: this._exp
		});
		const prevLevel = this._level;
		while (this._level < MAX_LEVEL && this._exp >= expForLevel(this._level + 1)) this._level++;
		if (this._level > prevLevel) this._bus.emit("level:up", {
			level: this._level,
			prevLevel,
			title: this.title
		});
		this._save();
	}
	get exp() {
		return this._exp;
	}
	get level() {
		return this._level;
	}
	get title() {
		return this.getTier().title;
	}
	/** EXP needed for next level (0 if max) */
	get expToNext() {
		if (this._level >= MAX_LEVEL) return 0;
		return expForLevel(this._level + 1) - this._exp;
	}
	/** EXP threshold for current level */
	get currentLevelExp() {
		return expForLevel(this._level);
	}
	/** EXP threshold for next level */
	get nextLevelExp() {
		if (this._level >= MAX_LEVEL) return expForLevel(MAX_LEVEL);
		return expForLevel(this._level + 1);
	}
	/** Get the tier info for current level */
	getTier() {
		for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) if (this._level >= LEVEL_TIERS[i].minLevel) return LEVEL_TIERS[i];
		return LEVEL_TIERS[0];
	}
	/** Decay multiplier based on current level tier */
	get decayMultiplier() {
		return this.getTier().decayMultiplier;
	}
	/** Inventory capacity based on level */
	get inventoryCapacity() {
		if (this._level >= 20) return 40;
		if (this._level >= 10) return 30;
		return 20;
	}
	/** Max offline decay window: 8h for all (slow offline decay, ~1/5 of total over 8h) */
	get maxOfflineHours() {
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
			inventoryCapacity: this.inventoryCapacity
		};
	}
	_save() {
		this._store.save(STORE_KEY$2, {
			exp: this._exp,
			level: this._level
		});
	}
};

//#endregion
//#region src/client/game/sticker-defs.ts
const STICKER_CATALOG = [
	{
		id: "sticker_default_star",
		name: "小星星",
		emoji: "⭐",
		category: "skill",
		rarity: "common",
		description: "每个人都有一颗星星。",
		source: "default"
	},
	{
		id: "sticker_default_heart",
		name: "小心心",
		emoji: "💛",
		category: "skill",
		rarity: "common",
		description: "暖呼呼的。",
		source: "default"
	},
	{
		id: "sticker_default_leaf",
		name: "小叶子",
		emoji: "🌿",
		category: "skill",
		rarity: "common",
		description: "新鲜摘的。",
		source: "default"
	},
	{
		id: "sticker_tech_bug",
		name: "小虫子",
		emoji: "🐛",
		category: "skill",
		rarity: "common",
		description: "又来 bug 了。",
		source: "shop",
		price: 30,
		unlockLevel: 1
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
		unlockLevel: 3
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
		unlockLevel: 8
	},
	{
		id: "sticker_art_brush",
		name: "画笔",
		emoji: "🎨",
		category: "skill",
		rarity: "common",
		description: "随手涂鸦。",
		source: "shop",
		price: 30,
		unlockLevel: 1
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
		unlockLevel: 3
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
		unlockLevel: 15
	},
	{
		id: "sticker_office_clip",
		name: "回形针",
		emoji: "📎",
		category: "skill",
		rarity: "common",
		description: "夹住一切。",
		source: "shop",
		price: 20,
		unlockLevel: 1
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
		unlockLevel: 3
	},
	{
		id: "sticker_explore_compass",
		name: "指南针",
		emoji: "🧭",
		category: "skill",
		rarity: "common",
		description: "永远向前。",
		source: "shop",
		price: 30,
		unlockLevel: 1
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
		unlockLevel: 5
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
		unlockLevel: 18
	},
	{
		id: "sticker_life_sun",
		name: "小太阳",
		emoji: "☀️",
		category: "skill",
		rarity: "common",
		description: "暖洋洋。",
		source: "shop",
		price: 25,
		unlockLevel: 1
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
		unlockLevel: 3
	},
	{
		id: "sticker_social_handshake",
		name: "握手",
		emoji: "🤝",
		category: "skill",
		rarity: "common",
		description: "合作愉快。",
		source: "shop",
		price: 30,
		unlockLevel: 1
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
		unlockLevel: 5
	},
	{
		id: "sticker_emotion_rainbow",
		name: "彩虹",
		emoji: "🌈",
		category: "skill",
		rarity: "rare",
		description: "雨后天晴。",
		source: "shop",
		price: 80,
		unlockLevel: 3
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
		unlockLevel: 10
	},
	{
		id: "sticker_fun_dice",
		name: "骰子",
		emoji: "🎲",
		category: "skill",
		rarity: "common",
		description: "赌一把。",
		source: "shop",
		price: 25,
		unlockLevel: 1
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
		unlockLevel: 3
	},
	{
		id: "sticker_adventure_key",
		name: "金钥匙",
		emoji: "🗝️",
		category: "skill",
		rarity: "epic",
		description: "打开未知之门。",
		source: "adventure"
	},
	{
		id: "sticker_event_lantern",
		name: "灯笼",
		emoji: "🏮",
		category: "skill",
		rarity: "epic",
		description: "节日限定。",
		source: "event"
	}
];
const STICKER_MAP = Object.fromEntries(STICKER_CATALOG.map((s) => [s.id, s]));
/** Stickers sold in the shop (source=shop) */
function getShopStickers() {
	return STICKER_CATALOG.filter((s) => s.source === "shop");
}

//#endregion
//#region src/client/game/inventory-system.ts
const ITEM_DEFS = {
	巴别鱼罐头: {
		id: "巴别鱼罐头",
		name: "巴别鱼罐头",
		icon: "🐠",
		category: "food",
		description: "美味的鱼罐头，管饱。——\"把它塞进耳朵里就能听懂宇宙一切语言。\" ——指南",
		useText: "罐头开封后，语言能力没有增加，但电量感以十分自信的语气宣布自己有效。",
		effects: { power: 50 },
		tier: 1,
		adventureEffect: {
			type: "roll_bonus",
			value: 2,
			condition: "puzzle"
		}
	},
	不要恐慌胶囊: {
		id: "不要恐慌胶囊",
		name: "不要恐慌胶囊",
		icon: "💊",
		category: "medicine",
		description: "吞下去，心情好起来了。——\"DON'T PANIC.\" ——银河系漫游指南封面",
		useText: "胶囊吞下后，恐慌被折成一张很小的纸条，夹回封面背后。",
		effects: { mood: 15 },
		tier: 1,
		adventureEffect: {
			type: "damage_ignore",
			value: 1
		}
	},
	马文牌退烧贴: {
		id: "马文牌退烧贴",
		name: "马文牌退烧贴",
		icon: "🤖",
		category: "medicine",
		description: "贴上后身体好多了。——\"我脑子有行星那么大，却只能贴退烧贴。\" ——马文",
		useText: "退烧贴贴上后，体温终于承认自己刚才有点夸张。",
		effects: { health: 20 },
		tier: 1
	},
	宇宙棉花糖: {
		id: "宇宙棉花糖",
		name: "宇宙棉花糖",
		icon: "☁️",
		category: "food",
		description: "入口即化，纯粹的快乐。——\"在零重力下它会自己飘进嘴里。\" ——星际甜品指南",
		useText: "棉花糖消散得像一朵有临时通行证的云，甜味留下了签收单。",
		effects: { mood: 12 },
		tier: 1
	},
	星际薯条: {
		id: "星际薯条",
		name: "星际薯条",
		icon: "🍟",
		category: "food",
		description: "宇宙快餐标配，分量不大但够顶一阵。——\"文明的唯一共识就是薯条。\" ——福特·普里弗克特",
		useText: "薯条被逐根注销，账本认定文明暂时没有崩塌。",
		effects: { power: 35 },
		tier: 1
	},
	毛巾: {
		id: "毛巾",
		name: "毛巾",
		icon: "🧣",
		category: "toy",
		description: "安全感满满，但玩着玩着会耗电。——\"知道毛巾在哪的人，值得信赖。\" ——指南",
		useText: "毛巾展开后，安全感像一条备用路线，被认真塞进了账本边角。",
		effects: {
			mood: 18,
			power: -5
		},
		tier: 2,
		adventureEffect: {
			type: "roll_bonus",
			value: 1
		}
	},
	假装正常药水: {
		id: "假装正常药水",
		name: "假装正常药水",
		icon: "🧪",
		category: "medicine",
		description: "喝完看起来完全正常了。——\"正常只是一种统计学幻觉。\" ——赞福德·毕乔布莱斯特",
		useText: "药水完成了外观层面的正常化，剩下的荒谬被标注为系统特性。",
		effects: { health: 15 },
		tier: 2
	},
	心灵感应茶: {
		id: "心灵感应茶",
		name: "心灵感应茶",
		icon: "🍵",
		category: "food",
		description: "据说喝完能短暂读懂猫的心思。——\"它想要的只是鱼罐头，一直都是。\" ——匿名猫语翻译器",
		useText: "茶杯见底后，猫语翻译器短暂亮灯，又立刻假装无事发生。",
		effects: {
			power: 30,
			mood: 8
		},
		tier: 2
	},
	猫薄荷星云: {
		id: "猫薄荷星云",
		name: "猫薄荷星云",
		icon: "🌿",
		category: "toy",
		description: "稀有猫薄荷，极度愉悦但消耗体力。——\"整个星系都是我的猫抓板。\" ——某只太空猫",
		useText: "星云被拨散后，快乐以螺旋形式占领了附近的注释栏。",
		effects: {
			mood: 22,
			power: -10
		},
		tier: 2
	},
	福特的三明治: {
		id: "福特的三明治",
		name: "福特的三明治",
		icon: "🥪",
		category: "food",
		description: "福特的私房配方，份量管够。——\"在毁灭前吃顿好的，这是银河系的传统。\" ——福特·普里弗克特",
		useText: "三明治被归入灾前标准餐，电量在签字栏里写下撤退。",
		effects: {
			power: 65,
			mood: 5
		},
		tier: 3
	},
	概率修复喷雾: {
		id: "概率修复喷雾",
		name: "概率修复喷雾",
		icon: "💨",
		category: "medicine",
		description: "非概率物理学的医疗应用。——\"在一个不可能的宇宙里，治愈也是不可能的简单。\" ——非概率实验室",
		useText: "喷雾落下后，受损概率被临时调回比较像现实的范围。",
		effects: { health: 30 },
		tier: 3,
		adventureEffect: {
			type: "reroll",
			value: 1
		}
	},
	泛银河爆破饮: {
		id: "泛银河爆破饮",
		name: "泛银河爆破饮",
		icon: "🌌",
		category: "food",
		description: "喝完像被柠檬包裹的金砖砸中脑袋。——\"宇宙中最烈的酒。\" ——指南",
		useText: "饮料抵达胃部时没有敲门，随后把精神状态改写成大写备注。",
		effects: {
			power: 80,
			mood: 10
		},
		tier: 3,
		adventureEffect: {
			type: "roll_bonus",
			value: 2
		}
	},
	沃贡诗集护盾: {
		id: "沃贡诗集护盾",
		name: "沃贡诗集护盾",
		icon: "📖",
		category: "medicine",
		description: "听完沃贡诗活下来后获得的免疫力。——\"宇宙第三差的诗，但吃不死人。\" ——指南",
		useText: "诗集被合上后，幸存本身成为一层很不情愿的护盾。",
		effects: {
			health: 35,
			mood: 5
		},
		tier: 3,
		adventureEffect: {
			type: "damage_ignore",
			value: 1
		}
	},
	时间漩涡甜甜圈: {
		id: "时间漩涡甜甜圈",
		name: "时间漩涡甜甜圈",
		icon: "🍩",
		category: "food",
		description: "扭曲时空的甜甜圈，加速一切冷却。——\"时间是一种幻觉，午餐时间尤其如此。\" ——福特",
		useText: "甜甜圈咬开的一瞬间，时间排队顺序被悄悄改成了甜味优先。",
		effects: {
			power: 40,
			mood: 10
		},
		tier: 3,
		metadata: { cooldownReduction: .2 },
		adventureEffect: {
			type: "reroll",
			value: 1
		}
	},
	深思重启针: {
		id: "深思重启针",
		name: "深思重启针",
		icon: "💉",
		category: "medicine",
		description: "完全恢复健康。——\"七百五十万年的计算，总得有个重启按钮。\" ——深思",
		useText: "针剂启动后，身体把旧结论清空，重新计算出一个更能继续运行的答案。",
		effects: { health: 100 },
		tier: 4
	},
	无限非概率燃料: {
		id: "无限非概率燃料",
		name: "无限非概率燃料",
		icon: "⚡",
		category: "special",
		description: "黄金之心号的核心动力源。——\"只要你不在意变成一条沙丁鱼的概率。\" ——崔莉恩",
		useText: "燃料入账后，现实短暂绕路；账本只记录结果，不记录路线。",
		effects: {
			power: 60,
			mood: 15,
			health: 10
		},
		tier: 4,
		adventureEffect: {
			type: "roll_bonus",
			value: 3
		}
	},
	生命宇宙万物答案: {
		id: "生命宇宙万物答案",
		name: "生命宇宙万物答案",
		icon: "4️⃣2️⃣",
		category: "special",
		description: "答案是42，但问题是什么？使用后2h经验+50%。——\"四十二。\" ——深思",
		useText: "答案被确认仍是数字，问题被暂时放弃追责。",
		effects: {
			mood: 20,
			power: 20,
			health: 20
		},
		tier: 4,
		metadata: {
			expBoost: .5,
			expBoostDurationMs: 2 * 3600 * 1e3
		}
	},
	马格拉斯定制星球: {
		id: "马格拉斯定制星球",
		name: "马格拉斯定制星球",
		icon: "🪐",
		category: "toy",
		description: "掌心大小的定制星球，把玩时可能触发探险。——\"我们造星球，订单排到了五百万年后。\" ——马格拉斯工厂",
		useText: "星球在掌心转了一圈，把无聊改造成可出发的地形。",
		effects: { mood: 35 },
		tier: 4,
		metadata: { triggerAdventure: true }
	},
	金心号舱票: {
		id: "金心号舱票",
		name: "金心号舱票",
		icon: "🎫",
		category: "special",
		description: "登上黄金之心号！重置一切冷却。——\"偷来的飞船开起来更带劲。\" ——赞福德",
		useText: "舱票打孔后，所有冷却被请到另一条时间线上重新排队。",
		effects: {
			mood: 30,
			power: 30,
			health: 30
		},
		tier: 5,
		metadata: { resetAllCooldowns: true }
	},
	上帝的最后留言: {
		id: "上帝的最后留言",
		name: "上帝的最后留言",
		icon: "✉️",
		category: "special",
		description: "使用后24h解锁隐藏人格。——\"抱歉给你们带来不便。\" ——上帝",
		useText: "留言被读完后，世界没有解释自己，只留下一个可疑的运行许可。",
		effects: {
			mood: 50,
			power: 50,
			health: 50
		},
		tier: 5,
		metadata: {
			hiddenPersona: true,
			hiddenPersonaDurationMs: 24 * 3600 * 1e3
		}
	}
};
for (const s of STICKER_CATALOG) if (!ITEM_DEFS[s.id]) ITEM_DEFS[s.id] = {
	id: s.id,
	name: s.name,
	icon: s.emoji,
	category: "collection",
	description: s.description,
	effects: {},
	metadata: {
		sticker: true,
		stickerRarity: s.rarity,
		stickerCategory: s.category
	}
};
const MAX_STACK = 99;
const STORE_KEY$1 = "inventory";
var InventorySystem = class InventorySystem {
	_bus;
	_store;
	_slots;
	_capacity;
	constructor(bus, store, capacity = 20) {
		this._bus = bus;
		this._store = store;
		this._slots = /* @__PURE__ */ new Map();
		this._capacity = capacity;
		const saved = this._store.load(STORE_KEY$1);
		if (saved?.slots) for (const slot of saved.slots) this._slots.set(slot.itemId, slot);
	}
	setCapacity(capacity) {
		this._capacity = capacity;
	}
	/** Get item definition by ID */
	getItemDef(itemId) {
		return ITEM_DEFS[itemId] ?? null;
	}
	/** Register a dynamic collection item (e.g., adventure book) */
	registerCollectionItem(def) {
		if (ITEM_DEFS[def.id]) return;
		ITEM_DEFS[def.id] = {
			...def,
			category: "collection",
			permanent: true
		};
	}
	/** Add a collection item directly with custom metadata */
	addCollectionItem(id, name$1, icon, description, metadata) {
		if (!ITEM_DEFS[id]) this.registerCollectionItem({
			id,
			name: name$1,
			icon,
			category: "collection",
			description,
			effects: {},
			permanent: true,
			metadata
		});
		if (!this._slots.has(id)) {
			if (this._slots.size >= this._capacity) return false;
			this._slots.set(id, {
				itemId: id,
				quantity: 1
			});
			this._save();
		}
		return true;
	}
	/** Get all collection items */
	getCollections() {
		return this.list().filter((item) => item.def.category === "collection").map((item) => ({
			itemId: item.itemId,
			def: item.def,
			metadata: item.def.metadata
		}));
	}
	/** Collection category definition */
	static COLLECTION_CATEGORIES = {
		adventure_book: {
			id: "adventure_book",
			name: "冒险书",
			icon: "📖",
			description: "你的冒险故事集"
		},
		memorial: {
			id: "memorial",
			name: "纪念品",
			icon: "🏆",
			description: "珍贵的回忆"
		},
		achievement: {
			id: "achievement",
			name: "成就徽章",
			icon: "🏅",
			description: "达成的成就"
		},
		special: {
			id: "special",
			name: "特殊物品",
			icon: "✨",
			description: "特殊的收藏品"
		}
	};
	/** Get collections grouped by category */
	getCollectionsByCategory() {
		const result = {};
		for (const catId of Object.keys(InventorySystem.COLLECTION_CATEGORIES)) result[catId] = [];
		const collections = this.getCollections();
		for (const item of collections) {
			const meta = item.def.metadata ?? {};
			let category = "special";
			if (meta.book) category = "adventure_book";
			else if (meta.memorial) category = "memorial";
			else if (meta.achievement) category = "achievement";
			result[category].push(item);
		}
		return result;
	}
	/** Get collection items summary for UI */
	getCollectionSummary() {
		const grouped = this.getCollectionsByCategory();
		const categories = [];
		let total = 0;
		for (const [catId, catDef] of Object.entries(InventorySystem.COLLECTION_CATEGORIES)) {
			const items = grouped[catId] ?? [];
			categories.push({
				id: catId,
				name: catDef.name,
				icon: catDef.icon,
				description: catDef.description,
				count: items.length
			});
			total += items.length;
		}
		return {
			total,
			categories
		};
	}
	/** Read a narrative book (get full content) */
	readNarrativeBook(itemId) {
		const item = this._slots.get(itemId);
		if (!item) return null;
		const def = ITEM_DEFS[itemId];
		if (!def || def.category !== "collection") return null;
		const meta = def.metadata ?? {};
		const book = meta.book;
		if (!book) return null;
		return {
			title: book.title,
			story: book.story,
			wordCount: book.wordCount,
			endings: book.endings,
			scenarioTitle: book.scenarioTitle,
			starLevel: book.starLevel,
			createdAt: book.createdAt,
			type: book.type
		};
	}
	/** Add items to inventory */
	addItem(itemId, qty = 1) {
		const def = ITEM_DEFS[itemId];
		if (!def) return false;
		if (def.permanent || def.unlimited) return true;
		const existing = this._slots.get(itemId);
		if (existing) existing.quantity = Math.min(MAX_STACK, existing.quantity + qty);
		else {
			if (this._slots.size >= this._capacity) return false;
			this._slots.set(itemId, {
				itemId,
				quantity: qty
			});
		}
		this._save();
		return true;
	}
	/** Use an item. Returns the effects if successful, null if failed. */
	useItem(itemId) {
		const def = ITEM_DEFS[itemId];
		if (!def) return null;
		if (def.cooldownMs) {
			const slot = this._slots.get(itemId);
			const lastUsed = slot?.lastUsedAt ?? 0;
			if (Date.now() - lastUsed < def.cooldownMs) return null;
		}
		if (!def.permanent && !def.unlimited) {
			const slot = this._slots.get(itemId);
			if (!slot || slot.quantity <= 0) return null;
			slot.quantity--;
			if (slot.quantity <= 0) this._slots.delete(itemId);
		}
		if (def.cooldownMs) {
			const slot = this._slots.get(itemId) ?? {
				itemId,
				quantity: 0
			};
			slot.lastUsedAt = Date.now();
			this._slots.set(itemId, slot);
		}
		const effects = {};
		for (const [k, v] of Object.entries(def.effects)) if (v !== void 0) effects[k] = v;
		const meta = def.metadata;
		const special = {};
		if (meta) {
			if (typeof meta.cooldownReduction === "number") {
				const reduction = meta.cooldownReduction;
				for (const [slotId, slot] of this._slots.entries()) if (slot.lastUsedAt && slotId !== itemId) {
					const slotDef = ITEM_DEFS[slotId];
					if (slotDef?.cooldownMs) {
						const elapsed = Date.now() - slot.lastUsedAt;
						const remaining = slotDef.cooldownMs - elapsed;
						if (remaining > 0) slot.lastUsedAt -= Math.floor(remaining * reduction);
					}
				}
				special.cooldownReduction = reduction;
			}
			if (meta.resetAllCooldowns) {
				for (const slot of this._slots.values()) slot.lastUsedAt = void 0;
				special.resetAllCooldowns = true;
			}
			if (typeof meta.expBoost === "number") {
				special.expBoost = meta.expBoost;
				special.expBoostUntil = Date.now() + (meta.expBoostDurationMs ?? 72e5);
			}
			if (meta.triggerAdventure) special.triggerAdventure = true;
			if (meta.hiddenPersona) {
				special.hiddenPersona = true;
				special.hiddenPersonaUntil = Date.now() + (meta.hiddenPersonaDurationMs ?? 864e5);
			}
		}
		this._bus.emit("inventory:use", {
			itemId,
			effects,
			special
		});
		this._save();
		return {
			effects,
			...Object.keys(special).length > 0 ? { special } : {}
		};
	}
	/** Get cooldown remaining in ms (0 = ready) */
	getCooldown(itemId) {
		const def = ITEM_DEFS[itemId];
		if (!def?.cooldownMs) return 0;
		const slot = this._slots.get(itemId);
		if (!slot?.lastUsedAt) return 0;
		return Math.max(0, def.cooldownMs - (Date.now() - slot.lastUsedAt));
	}
	/**
	* Remove qty of an item from inventory **without** applying its mechanical effects.
	* Used for narrative-only consumption (e.g. narrative scenario DM says player gave
	* away / lost / ate an item, and resource changes if any are emitted by DM via
	* narrative.attr.adjust separately). Returns { ok, removed } — false if not present.
	*/
	removeItem(itemId, qty = 1) {
		const slot = this._slots.get(itemId);
		if (!slot) return {
			ok: false,
			removed: 0,
			reason: "not in inventory"
		};
		const take = Math.min(qty, slot.quantity);
		if (take <= 0) return {
			ok: false,
			removed: 0,
			reason: "qty must be positive"
		};
		slot.quantity -= take;
		if (slot.quantity <= 0) this._slots.delete(itemId);
		this._save();
		return {
			ok: true,
			removed: take
		};
	}
	/** Check if an item can be used right now */
	canUse(itemId) {
		const def = ITEM_DEFS[itemId];
		if (!def) return false;
		if (this.getCooldown(itemId) > 0) return false;
		if (def.permanent || def.unlimited) return true;
		const slot = this._slots.get(itemId);
		return !!slot && slot.quantity > 0;
	}
	/** List all inventory items with their defs and quantities */
	list() {
		const result = [];
		for (const [id, def] of Object.entries(ITEM_DEFS)) if (def.permanent || def.unlimited) result.push({
			itemId: id,
			def,
			quantity: -1,
			cooldownRemaining: this.getCooldown(id),
			canUse: this.canUse(id)
		});
		for (const [id, slot] of this._slots) {
			const def = ITEM_DEFS[id];
			if (!def || def.permanent || def.unlimited) continue;
			result.push({
				itemId: id,
				def,
				quantity: slot.quantity,
				cooldownRemaining: this.getCooldown(id),
				canUse: this.canUse(id)
			});
		}
		return result;
	}
	get capacity() {
		return this._capacity;
	}
	get usedSlots() {
		let count = 0;
		for (const [id] of this._slots) {
			const def = ITEM_DEFS[id];
			if (def?.permanent || def?.unlimited) continue;
			count++;
		}
		return count;
	}
	_save() {
		const slots = [];
		for (const [, slot] of this._slots) slots.push(slot);
		this._store.save(STORE_KEY$1, { slots });
	}
};

//#endregion
//#region src/client/game/shop-system.ts
const SHOP_CATALOG = [
	{
		id: "巴别鱼罐头",
		price: 20,
		dailyLimit: 5
	},
	{
		id: "不要恐慌胶囊",
		price: 15,
		dailyLimit: 5
	},
	{
		id: "马文牌退烧贴",
		price: 25,
		dailyLimit: 3
	},
	{
		id: "宇宙棉花糖",
		price: 12,
		dailyLimit: 10,
		unlockLevel: 3
	},
	{
		id: "星际薯条",
		price: 15,
		dailyLimit: 8,
		unlockLevel: 3
	},
	{
		id: "毛巾",
		price: 40,
		dailyLimit: 3,
		unlockLevel: 5
	},
	{
		id: "假装正常药水",
		price: 30,
		dailyLimit: 3,
		unlockLevel: 5
	},
	{
		id: "心灵感应茶",
		price: 45,
		dailyLimit: 3,
		unlockLevel: 8
	},
	{
		id: "猫薄荷星云",
		price: 40,
		dailyLimit: 3,
		unlockLevel: 8
	},
	{
		id: "福特的三明治",
		price: 60,
		dailyLimit: 2,
		unlockLevel: 10
	},
	{
		id: "概率修复喷雾",
		price: 55,
		dailyLimit: 2,
		unlockLevel: 10
	},
	{
		id: "泛银河爆破饮",
		price: 80,
		dailyLimit: 2,
		unlockLevel: 14
	},
	{
		id: "沃贡诗集护盾",
		price: 75,
		dailyLimit: 2,
		unlockLevel: 14
	},
	{
		id: "时间漩涡甜甜圈",
		price: 90,
		dailyLimit: 2,
		unlockLevel: 14
	},
	{
		id: "深思重启针",
		price: 150,
		dailyLimit: 0,
		weeklyLimit: 2,
		unlockLevel: 18
	},
	{
		id: "无限非概率燃料",
		price: 120,
		dailyLimit: 1,
		unlockLevel: 18
	},
	{
		id: "生命宇宙万物答案",
		price: 250,
		dailyLimit: 1,
		unlockLevel: 22
	},
	{
		id: "马格拉斯定制星球",
		price: 280,
		dailyLimit: 0,
		weeklyLimit: 1,
		unlockLevel: 22
	},
	{
		id: "金心号舱票",
		price: 450,
		dailyLimit: 0,
		weeklyLimit: 1,
		unlockLevel: 26
	},
	{
		id: "上帝的最后留言",
		price: 800,
		dailyLimit: 0,
		weeklyLimit: 1,
		unlockLevel: 30
	}
];
for (const s of getShopStickers()) SHOP_CATALOG.push({
	id: s.id,
	price: s.price ?? 50,
	dailyLimit: 1,
	unlockLevel: s.unlockLevel ?? 1
});
const WALLET_KEY = "wallet";
const PURCHASES_KEY = "shop-purchases";
function todayStr() {
	const d = /* @__PURE__ */ new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoWeek() {
	const d = /* @__PURE__ */ new Date();
	const jan1 = new Date(d.getFullYear(), 0, 1);
	const dayOfYear = Math.ceil((d.getTime() - jan1.getTime()) / 864e5);
	const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
	return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
function computeItemScore(def, state, inventory) {
	let score = 0;
	const itemDef = ITEM_DEFS[def.id];
	const category = itemDef?.category;
	if (state.power < 60 && category === "food") score += 30;
	if (state.health < 40 && category === "medicine") score += 30;
	if (state.mood < 30 && category === "toy") score += 30;
	if (state.adventureActive && itemDef?.adventureEffect) score += 20;
	const hasItem = inventory.list().some((i) => i.itemId === def.id && i.quantity > 0);
	if (!hasItem) score += 15;
	return score;
}
var ShopSystem = class {
	_bus;
	_store;
	_inventory;
	_levels;
	_coins = 0;
	_totalEarned = 0;
	_totalSpent = 0;
	_purchaseDate = "";
	_purchaseWeek = "";
	_dailyPurchases = {};
	_weeklyPurchases = {};
	constructor(bus, store, inventory, levels) {
		this._bus = bus;
		this._store = store;
		this._inventory = inventory;
		this._levels = levels;
		const walletSaved = this._store.load(WALLET_KEY);
		if (walletSaved) {
			this._coins = walletSaved.coins ?? 0;
			this._totalEarned = walletSaved.totalEarned ?? 0;
			this._totalSpent = walletSaved.totalSpent ?? 0;
		}
		const purchSaved = this._store.load(PURCHASES_KEY);
		if (purchSaved) {
			this._purchaseDate = purchSaved.date ?? "";
			this._purchaseWeek = purchSaved.week ?? "";
			this._dailyPurchases = purchSaved.daily ?? {};
			this._weeklyPurchases = purchSaved.weekly ?? {};
		}
		this._ensureFresh();
	}
	/** Add coins (from tasks, login, achievements, level-up) */
	earnCoins(amount, source) {
		if (amount <= 0) return;
		this._coins += amount;
		this._totalEarned += amount;
		this._bus.emit("shop:coin-earn", {
			amount,
			source,
			balance: this._coins
		});
		this._saveWallet();
	}
	/** Get current wallet info */
	getWallet() {
		return {
			coins: this._coins,
			totalEarned: this._totalEarned,
			totalSpent: this._totalSpent
		};
	}
	/** Spend coins (for adventure book generation, etc.) */
	spendCoins(amount, reason) {
		if (amount <= 0) return {
			ok: false,
			reason: "invalid_amount"
		};
		if (this._coins < amount) return {
			ok: false,
			reason: "insufficient_coins"
		};
		this._coins -= amount;
		this._totalSpent += amount;
		this._bus.emit("shop:coin-spend", {
			amount,
			reason,
			balance: this._coins
		});
		this._saveWallet();
		return { ok: true };
	}
	/** List all shop items with purchase state */
	listShop(state) {
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
				reason
			};
		});
		if (state) items.sort((a, b) => {
			const scoreA = computeItemScore(a, state, this._inventory);
			const scoreB = computeItemScore(b, state, this._inventory);
			return scoreB - scoreA;
		});
		return items;
	}
	/** Purchase an item */
	buy(itemId, qty = 1) {
		this._ensureFresh();
		const def = SHOP_CATALOG.find((d) => d.id === itemId);
		if (!def) return {
			ok: false,
			reason: "item_not_found"
		};
		if (qty < 1) return {
			ok: false,
			reason: "invalid_quantity"
		};
		const todayBought = this._dailyPurchases[def.id] ?? 0;
		const weekBought = this._weeklyPurchases[def.id] ?? 0;
		const playerLevel = this._levels.level;
		for (let i = 0; i < qty; i++) {
			const { canBuy, reason } = this._checkCanBuy(def, todayBought + i, weekBought + i, playerLevel);
			if (!canBuy) return {
				ok: false,
				reason
			};
		}
		const totalCost = def.price * qty;
		if (this._coins < totalCost) return {
			ok: false,
			reason: "insufficient_coins"
		};
		this._coins -= totalCost;
		this._totalSpent += totalCost;
		this._dailyPurchases[def.id] = todayBought + qty;
		this._weeklyPurchases[def.id] = weekBought + qty;
		this._inventory.addItem(itemId, qty);
		this._bus.emit("shop:buy", {
			itemId,
			qty,
			totalCost,
			balance: this._coins
		});
		this._saveWallet();
		this._savePurchases();
		return {
			ok: true,
			wallet: this.getWallet()
		};
	}
	_checkCanBuy(def, todayBought, weekBought, playerLevel) {
		if (def.unlockLevel && playerLevel < def.unlockLevel) return {
			canBuy: false,
			reason: `需要 Lv.${def.unlockLevel}`
		};
		if (def.dailyLimit > 0 && todayBought >= def.dailyLimit) return {
			canBuy: false,
			reason: "今日已售罄"
		};
		if (def.weeklyLimit && weekBought >= def.weeklyLimit) return {
			canBuy: false,
			reason: "本周已售罄"
		};
		if (this._coins < def.price) return {
			canBuy: false,
			reason: "星币不足"
		};
		return { canBuy: true };
	}
	_ensureFresh() {
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
	_saveWallet() {
		this._store.save(WALLET_KEY, {
			coins: this._coins,
			totalEarned: this._totalEarned,
			totalSpent: this._totalSpent
		});
	}
	_savePurchases() {
		this._store.save(PURCHASES_KEY, {
			date: this._purchaseDate,
			week: this._purchaseWeek,
			daily: this._dailyPurchases,
			weekly: this._weeklyPurchases
		});
	}
};

//#endregion
//#region src/client/game/care-system.ts
const PLAY_ACTIONS = [{
	id: "hide_seek",
	name: "捉迷藏",
	effects: {
		mood: 10,
		power: -18
	}
}, {
	id: "sunbathe",
	name: "晒太阳",
	effects: {
		mood: 5,
		power: -6
	}
}];
const SLEEP_MOOD_PER_SEC = 1;
const SLEEP_POWER_PER_SEC = .1;
var CareSystem = class {
	_bus;
	_attributes;
	_inventory;
	_levels;
	constructor(bus, attributes, inventory, levels) {
		this._bus = bus;
		this._attributes = attributes;
		this._inventory = inventory;
		this._levels = levels;
	}
	/** Feed using an item from inventory */
	feed(itemId) {
		const result = this._inventory.useItem(itemId);
		if (!result) {
			const cd = this._inventory.getCooldown(itemId);
			if (cd > 0) return {
				ok: false,
				reason: "cooldown",
				effects: { cooldownRemaining: cd }
			};
			return {
				ok: false,
				reason: "no_item"
			};
		}
		this._applyEffects(result.effects);
		this._levels.gainExp(this._careExp(result.effects), "feed");
		this._bus.emit("care:action", {
			action: "feed",
			itemId,
			effects: result.effects
		});
		return {
			ok: true,
			effects: result.effects
		};
	}
	/** Perform a play action */
	play(actionId) {
		const action = PLAY_ACTIONS.find((a) => a.id === actionId);
		if (!action) return {
			ok: false,
			reason: "unknown_action"
		};
		if (action.effects.power && action.effects.power < 0) {
			const currentHunger = this._attributes.getValue("power");
			if (currentHunger < Math.abs(action.effects.power)) return {
				ok: false,
				reason: "too_low_power"
			};
		}
		const effects = {};
		for (const [k, v] of Object.entries(action.effects)) if (v !== void 0) effects[k] = v;
		this._applyEffects(effects);
		this._levels.gainExp(this._careExp(effects), "play");
		this._bus.emit("care:action", {
			action: `play:${actionId}`,
			effects
		});
		return {
			ok: true,
			effects
		};
	}
	/** Use any inventory item (generic) — consume + apply effects */
	useItem(itemId) {
		const result = this._inventory.useItem(itemId);
		if (!result) {
			const cd = this._inventory.getCooldown(itemId);
			if (cd > 0) return {
				ok: false,
				reason: "cooldown",
				effects: { cooldownRemaining: cd }
			};
			return {
				ok: false,
				reason: "no_item"
			};
		}
		this._applyEffects(result.effects);
		this._levels.gainExp(this._careExp(result.effects), "use_item");
		this._bus.emit("care:action", {
			action: `use:${itemId}`,
			effects: result.effects
		});
		return {
			ok: true,
			effects: result.effects
		};
	}
	/**
	* SLEEP redesign: trade power for mood.
	* The client behavior_system tracks duration and calls this once on wake to apply in batch.
	* See docs/design/2026-07-20-sleep-重设计-design.md
	*/
	rest(params) {
		const duration = params?.duration;
		if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return {
			ok: false,
			reason: "invalid_duration"
		};
		const wokeBy = typeof params?.wokeBy === "string" ? params.wokeBy : "manual";
		const moodGain = Math.round(duration * SLEEP_MOOD_PER_SEC);
		const powerCost = Math.round(duration * SLEEP_POWER_PER_SEC * 10) / 10;
		const effects = {
			mood: moodGain,
			power: -powerCost || 0
		};
		this._applyEffects(effects);
		this._bus.emit("care:action", {
			action: "rest",
			effects,
			duration,
			wokeBy,
			moodGain,
			powerCost
		});
		return {
			ok: true,
			effects,
			duration,
			wokeBy,
			moodGain,
			powerCost
		};
	}
	/** Use a healing item */
	heal(itemId) {
		const result = this._inventory.useItem(itemId);
		if (!result) {
			const cd = this._inventory.getCooldown(itemId);
			if (cd > 0) return {
				ok: false,
				reason: "cooldown",
				effects: { cooldownRemaining: cd }
			};
			return {
				ok: false,
				reason: "no_item"
			};
		}
		this._applyEffects(result.effects);
		this._levels.gainExp(this._careExp(result.effects), "heal");
		this._bus.emit("care:action", {
			action: "heal",
			itemId,
			effects: result.effects
		});
		return {
			ok: true,
			effects: result.effects
		};
	}
	/** Care XP = total item effect × 5 (min 100): stronger content yields more XP. */
	_careExp(effects) {
		let sum = 0;
		for (const v of Object.values(effects)) sum += Math.abs(v);
		return Math.max(100, Math.round(sum * 5));
	}
	_applyEffects(effects) {
		for (const [key, amount] of Object.entries(effects)) if (key === "exp") this._levels.gainExp(amount, "item");
		else this._attributes.adjust(key, amount);
	}
};

//#endregion
//#region src/client/game/reward-table.ts
const ZERO = {
	coins: 0,
	exp: 0
};
const CHAT_EVAL_INTENTS = {
	praise: {
		coins: 0,
		exp: 500
	},
	deep_talk: {
		coins: 0,
		exp: 500
	},
	gratitude: {
		coins: 0,
		exp: 500
	},
	playful: {
		coins: 0,
		exp: 200
	},
	sad_share: {
		coins: 0,
		exp: 300
	},
	neutral: {
		coins: 0,
		exp: 100
	},
	cold: {
		coins: 0,
		exp: 0
	},
	impatient: {
		coins: 0,
		exp: 0
	},
	angry: {
		coins: 0,
		exp: 0
	}
};
/** Course difficulty 1-5 (from event ctx.complexity); learning EXP scales with difficulty. */
const learnComplexity = (ctx) => Math.min(5, Math.max(1, Math.round(Number(ctx.complexity ?? 1))));
const REWARD_TABLE = {
	"chat:eval": (ctx) => {
		const intent = typeof ctx.intent === "string" ? ctx.intent : "";
		return CHAT_EVAL_INTENTS[intent] ?? ZERO;
	},
	"tool:invoked": (ctx) => {
		const weight = typeof ctx.weight === "string" ? ctx.weight : "light";
		if (weight === "heavy") return {
			coins: 15,
			exp: 1500
		};
		return {
			coins: 3,
			exp: 300
		};
	},
	"tool:first_use": () => ({
		coins: 20,
		exp: 1e3
	}),
	"level:up": () => ({
		coins: 30,
		exp: 0
	}),
	"achievement:unlock": () => ({
		coins: 50,
		exp: 0
	}),
	"login:streak": (ctx) => {
		const streak = Number(ctx.streak ?? 0);
		return {
			coins: Math.min(50, 5 * streak),
			exp: 0
		};
	},
	"login:online30min": () => ({
		coins: 10,
		exp: 0
	}),
	"chat:interval": () => ({
		coins: 5,
		exp: 0
	}),
	"learn:lesson-complete": (ctx) => ({
		coins: 8,
		exp: learnComplexity(ctx) * 300
	}),
	"learn:exam-passed": (ctx) => ({
		coins: 40,
		exp: learnComplexity(ctx) * 2e3
	}),
	"learn:all-lessons-done": (ctx) => ({
		coins: 80,
		exp: learnComplexity(ctx) * 4e3
	}),
	"todo:verified": (ctx) => {
		const rewards = ctx.rewards ?? {};
		return {
			coins: rewards.coins ?? 0,
			exp: rewards.exp ?? 0
		};
	},
	"narrative:completed": (ctx) => {
		const outcome = ctx.outcome ?? {};
		const r = outcome.rewards ?? {
			exp: 0,
			coins: 0
		};
		return {
			coins: r.coins,
			exp: r.exp
		};
	},
	"adventure:completed": (ctx) => {
		const result = ctx.result ?? {};
		const r = result.rewards ?? {
			exp: 0,
			coins: 0
		};
		return {
			coins: r.coins,
			exp: r.exp
		};
	}
};
function lookupReward(eventKey, ctx) {
	const resolver = REWARD_TABLE[eventKey];
	if (!resolver) return { ...ZERO };
	return resolver(ctx);
}

//#endregion
//#region src/client/game/reward-engine.ts
const STORE_KEY = "reward-engine";
const HEAVY_TOOL_PATTERNS = [
	/write_code/i,
	/generate_image/i,
	/generate_video/i,
	/generate_audio/i,
	/edit_image/i,
	/long_task/i,
	/bash/i,
	/deploy/i
];
function classifyTool(toolName) {
	for (const p of HEAVY_TOOL_PATTERNS) if (p.test(toolName)) return "heavy";
	return "light";
}
var RewardEngine = class {
	_bus;
	_store;
	_sinks;
	_firstUsed;
	_totalCoins = 0;
	_totalExp = 0;
	constructor(bus, store, sinks) {
		this._bus = bus;
		this._store = store;
		this._sinks = sinks;
		this._firstUsed = /* @__PURE__ */ new Set();
		const saved = this._store.load(STORE_KEY);
		if (saved) {
			this._firstUsed = new Set(saved.firstUsedTools ?? []);
			this._totalCoins = saved.totalCoins ?? 0;
			this._totalExp = saved.totalExp ?? 0;
		}
		this._wire();
	}
	getStats() {
		return {
			totalCoins: this._totalCoins,
			totalExp: this._totalExp,
			firstUsedTools: Array.from(this._firstUsed)
		};
	}
	_wire() {
		this._bus.on("chat:eval", ({ intent }) => {
			this._issue("chat:eval", `chat:eval:${intent}`, lookupReward("chat:eval", { intent }));
		});
		this._bus.on("level:up", ({ level }) => {
			this._issue("level:up", `level:up:${level}`, lookupReward("level:up", { level }));
		});
		this._bus.on("achievement:unlock", ({ id }) => {
			this._issue("achievement:unlock", `achievement:${id}`, lookupReward("achievement:unlock", {}));
		});
		this._bus.on("login:streak", ({ streak }) => {
			this._issue("login:streak", `login:streak:${streak}`, lookupReward("login:streak", { streak }));
		});
		this._bus.on("login:online30min", () => {
			this._issue("login:online30min", "login:online30min", lookupReward("login:online30min", {}));
		});
		this._bus.on("chat:interval", ({ count }) => {
			this._issue("chat:interval", `chat:interval:${count}`, lookupReward("chat:interval", { count }));
		});
		this._bus.on("agent:phase", (payload) => {
			if (payload.phase !== "tool_call") return;
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
					timestamp: Date.now()
				});
				this._issue("tool:first_use", `tool:first_use:${toolName}`, lookupReward("tool:first_use", {}));
			}
		});
		this._bus.on("learn:lesson-complete", ({ courseId, lessonOrder, complexity }) => {
			this._issue("learn:lesson-complete", `learn:lesson:${courseId}:${lessonOrder}`, lookupReward("learn:lesson-complete", { complexity }));
		});
		this._bus.on("learn:exam-passed", ({ courseId, complexity }) => {
			this._issue("learn:exam-passed", `learn:exam:${courseId}`, lookupReward("learn:exam-passed", { complexity }));
		});
		this._bus.on("learn:all-lessons-done", ({ courseId, complexity }) => {
			this._issue("learn:all-lessons-done", `learn:all-done:${courseId}`, lookupReward("learn:all-lessons-done", { complexity }));
		});
		this._bus.on("todo:verified", ({ todo, rewards }) => {
			this._issue("todo:verified", `todo:verified:${todo.id}`, lookupReward("todo:verified", { rewards }));
		});
		this._bus.on("narrative:completed", ({ session, outcome }) => {
			this._issue("narrative:completed", `narrative:completed:${session.id}`, lookupReward("narrative:completed", { outcome }));
		});
		this._bus.on("adventure:completed", ({ adventure, result }) => {
			this._issue("adventure:completed", `adventure:completed:${adventure.id}`, lookupReward("adventure:completed", { result }));
		});
	}
	_issue(eventType, source, delta) {
		if (delta.coins > 0) this._sinks.earnCoins(delta.coins, source);
		if (delta.exp > 0) this._sinks.gainExp(delta.exp, source);
		this._totalCoins += Math.max(0, delta.coins);
		this._totalExp += Math.max(0, delta.exp);
		this._persist();
		this._bus.emit("reward:issued", {
			eventType,
			coins: delta.coins,
			exp: delta.exp,
			source
		});
	}
	_persist() {
		const state = {
			firstUsedTools: Array.from(this._firstUsed),
			totalCoins: this._totalCoins,
			totalExp: this._totalExp
		};
		this._store.save(STORE_KEY, { ...state });
	}
};

//#endregion
//#region src/client/game/presets.ts
const ATTR_MOOD = {
	key: "mood",
	name: "情感",
	initial: 80,
	min: 15,
	max: 100,
	decayPerMinute: .06,
	maxOfflineHours: 8,
	levels: [
		{
			name: "sad",
			threshold: 0
		},
		{
			name: "normal",
			threshold: 30
		},
		{
			name: "happy",
			threshold: 52
		},
		{
			name: "joyful",
			threshold: 78
		}
	]
};
const ATTR_POWER = {
	key: "power",
	name: "电量",
	initial: 210,
	min: 0,
	max: 300,
	decayPerMinute: .18,
	maxOfflineHours: 8,
	levels: [
		{
			name: "starving",
			threshold: 0
		},
		{
			name: "hungry",
			threshold: 30
		},
		{
			name: "normal",
			threshold: 105
		},
		{
			name: "full",
			threshold: 225
		}
	]
};
const ATTR_HEALTH = {
	key: "health",
	name: "健康",
	initial: 100,
	min: 0,
	max: 100,
	decayPerMinute: 0,
	maxOfflineHours: 4,
	levels: [
		{
			name: "sick",
			threshold: 0
		},
		{
			name: "subhealthy",
			threshold: 35
		},
		{
			name: "healthy",
			threshold: 70
		}
	],
	dependencies: [{
		sourceKey: "power",
		effect: (level) => {
			if (level === "starving") return -.5;
			if (level === "hungry") return -.2;
			if (level === "full") return .15;
			return 0;
		}
	}, {
		sourceKey: "mood",
		effect: (level) => {
			if (level === "sad") return -.2;
			if (level === "joyful") return .15;
			return 0;
		}
	}]
};
/** All default attributes bundled together */
const DEFAULT_ATTRIBUTES = [
	ATTR_MOOD,
	ATTR_POWER,
	ATTR_HEALTH
];

//#endregion
//#region src/client/game/local-store.ts
const PREFIX = "dshPetSpriteGame:";
function createLocalStore() {
	return {
		load(key) {
			try {
				const raw = localStorage.getItem(PREFIX + key);
				if (!raw) return null;
				return JSON.parse(raw);
			} catch {
				return null;
			}
		},
		save(key, data) {
			try {
				localStorage.setItem(PREFIX + key, JSON.stringify(data));
			} catch {}
		}
	};
}

//#endregion
//#region src/client/game/mini-engine.ts
const TICK_MS = 1e4;
var MiniEngine = class {
	bus = new EventBus();
	attributes;
	levels;
	inventory;
	shop;
	care;
	reward;
	_timer = null;
	constructor() {
		const store = createLocalStore();
		this.attributes = new AttributeEngine(this.bus, store);
		for (const def of DEFAULT_ATTRIBUTES) this.attributes.register(def);
		this.levels = new LevelSystem(this.bus, store);
		this.inventory = new InventorySystem(this.bus, store);
		this.shop = new ShopSystem(this.bus, store, this.inventory, this.levels);
		this.care = new CareSystem(this.bus, this.attributes, this.inventory, this.levels);
		this.reward = new RewardEngine(this.bus, store, {
			earnCoins: (n, src) => this.shop.earnCoins(n, src),
			gainExp: (n, src) => this.levels.gainExp(n, src)
		});
		this.bus.on("level:up", ({ level }) => {
			const tier = this.levels.getTier();
			console.log(`[PetGame] level up -> ${level} (${tier.title})`);
			this.attributes.setDecayMultiplier(tier.decayMultiplier);
		});
		this.attributes.setDecayMultiplier(this.levels.getTier().decayMultiplier);
	}
	start() {
		if (this._timer) return;
		this._timer = setInterval(() => {
			this.attributes.tick(TICK_MS);
		}, TICK_MS);
	}
	stop() {
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
	}
	getStats() {
		const info = this.levels.getInfo();
		return {
			mood: Math.round(this.attributes.getValue("mood")),
			moodLevel: this.attributes.getLevel("mood"),
			power: Math.round(this.attributes.getValue("power")),
			powerLevel: this.attributes.getLevel("power"),
			health: Math.round(this.attributes.getValue("health")),
			healthLevel: this.attributes.getLevel("health"),
			level: info.level,
			exp: info.exp,
			title: info.title,
			coins: this.shop.getWallet().coins
		};
	}
	/** Called once per plugin mount: daily login streak reward */
	onLogin() {
		const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
		const last = localStorage.getItem("dshPetSpriteGame:lastLogin");
		if (last === today) return;
		localStorage.setItem("dshPetSpriteGame:lastLogin", today);
		const prev = last ? new Date(last) : null;
		const days = prev ? Math.floor((Date.now() - prev.getTime()) / 864e5) : 999;
		this.bus.emit("login:streak", {
			streak: 1,
			date: today
		});
		if (days >= 2 && prev) this.bus.emit("login:comeback", {
			daysSinceLastLogin: days,
			previousDate: last
		});
	}
	/** User sent a message: drain power by estimated input tokens (×0.5) */
	onUserMessage(text) {
		const estTokens = Math.max(1, Math.round(text.length / 4));
		this.attributes.adjust("power", -Math.round(estTokens * .5));
	}
	/** Assistant turn finished: output tokens convert 1:1 to EXP */
	onAssistantDone(textLen) {
		const exp = Math.max(1, Math.round(textLen / 4));
		this.levels.gainExp(exp, "dsh-assistant");
	}
};

//#endregion
//#region src/client/game/witness-log.ts
const KEY$1 = "dshPetSpriteWitness:days";
const KEEP_DAYS = 14;
function dateKey(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function emptyDay(date) {
	return {
		date,
		turns: 0,
		tasks: 0,
		inChars: 0,
		outChars: 0,
		firstAt: 0,
		lastAt: 0,
		night: false,
		feed: 0,
		play: 0,
		rest: 0,
		levelUps: 0
	};
}
function loadAll() {
	try {
		const v = JSON.parse(localStorage.getItem(KEY$1) ?? "{}");
		return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
	} catch {
		return {};
	}
}
function saveAll(all) {
	try {
		const keys = Object.keys(all).sort().slice(-KEEP_DAYS);
		const pruned = {};
		for (const k of keys) pruned[k] = all[k];
		localStorage.setItem(KEY$1, JSON.stringify(pruned));
	} catch {}
}
/**
* Mutate today's record through fn and persist. `touch` stamps the
* activity window; readers (log text, reward flag) pass false so opening
* the panel at night does not fake a work session.
*/
function update(fn, touch = true) {
	const all = loadAll();
	const key = dateKey();
	const day = all[key] ?? emptyDay(key);
	fn(day);
	if (touch) {
		const now = Date.now();
		day.lastAt = now;
		if (day.firstAt === 0) day.firstAt = now;
		if ((/* @__PURE__ */ new Date()).getHours() < 5) day.night = true;
	}
	all[key] = day;
	saveAll(all);
}
/** Today's record (a zero record when nothing happened yet). */
function getWitnessDay() {
	const key = dateKey();
	const all = loadAll();
	return all[key] ?? emptyDay(key);
}
/** One user message went out to the agent. */
function recordTurn(inChars) {
	update((d) => {
		d.turns++;
		d.inChars += Math.max(0, Math.floor(inChars));
	});
}
/** One assistant completion landed. */
function recordTask(outChars) {
	update((d) => {
		d.tasks++;
		d.outChars += Math.max(0, Math.floor(outChars));
	});
}
/** One care interaction happened (feed / play / rest). */
function recordCare(kind) {
	update((d) => {
		d[kind]++;
	});
}
/** The companion leveled up. */
function recordLevelUp() {
	update((d) => {
		d.levelUps++;
	});
}
/** Cache the generated log text on today's record (no activity touch). */
function saveLogText(text) {
	update((d) => {
		d.lastLog = text;
	}, false);
}
/** Claim today's once-per-day log reward; false when already claimed. */
function claimLogReward() {
	if (getWitnessDay().rewarded === true) return false;
	update((d) => {
		d.rewarded = true;
	}, false);
	return true;
}

//#endregion
//#region src/client/CarePanel.tsx
const LEVEL_COLORS = {
	sad: "#ef4444",
	starving: "#ef4444",
	sick: "#ef4444",
	hungry: "#f59e0b",
	subhealthy: "#f59e0b",
	normal: "#3b82f6",
	healthy: "#22c55e",
	happy: "#22c55e",
	full: "#22c55e",
	joyful: "#a855f7"
};
const LEVEL_NAMES = {
	sad: "低落",
	starving: "耗尽",
	sick: "生病",
	hungry: "饥饿",
	subhealthy: "亚健康",
	normal: "正常",
	healthy: "健康",
	happy: "开心",
	full: "满格",
	joyful: "亢奋"
};
const CAT_NAMES = {
	food: "食物",
	toy: "玩具",
	medicine: "药品",
	special: "特殊",
	collection: "收藏"
};
function barColor(level) {
	return LEVEL_COLORS[level] ?? "#3b82f6";
}
let panelStyleInjected = false;
function injectPanelStyles() {
	if (panelStyleInjected) return;
	panelStyleInjected = true;
	const s = document.createElement("style");
	s.textContent = `
.dsh-pet-sprite-panel{position:fixed;z-index:950;width:260px;max-height:min(60vh,460px);display:flex;flex-direction:column;background:#ffffff;border:2px solid #2a2f3e;border-radius:12px;box-shadow:0 5px 0 rgba(0,0,0,.16),0 14px 32px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1f2430;pointer-events:auto}
.dsh-pet-sprite-panel-hd{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:2px solid #2a2f3e;font-size:12px;font-weight:800;color:#1f2430}
.dsh-pet-sprite-panel-hd .sub{font-weight:600;font-size:10.5px;color:#6b7280}
.dsh-pet-sprite-panel-hd .coins{margin-left:auto;font-weight:800;font-size:11px;color:#b8860b;white-space:nowrap}
.dsh-pet-sprite-panel-x{border:none;background:transparent;font-size:13px;cursor:pointer;color:#6b7280;padding:2px 5px;border-radius:6px;line-height:1}
.dsh-pet-sprite-panel-x:hover{background:#eef0f4;color:#1f2430}
.dsh-pet-sprite-tabs{display:flex;border-bottom:1px solid #e5e7eb}
.dsh-pet-sprite-tab{flex:1;border:none;background:transparent;padding:6px 0;font-size:11px;font-weight:700;color:#6b7280;cursor:pointer;font-family:inherit;border-bottom:2px solid transparent}
.dsh-pet-sprite-tab.on{color:#1f2430;border-bottom-color:#4f6ef7}
.dsh-pet-sprite-tab:hover{color:#1f2430}
.dsh-pet-sprite-panel-bd{overflow-y:auto;padding:8px 12px 12px;font-size:12px}
.dsh-pet-sprite-panel-bd::-webkit-scrollbar{width:5px}
.dsh-pet-sprite-panel-bd::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:999px}
.dsh-pet-sprite-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.dsh-pet-sprite-row label{width:30px;flex:none;color:#6b7280;font-size:11px}
.dsh-pet-sprite-bar{flex:1;height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden}
.dsh-pet-sprite-bar i{display:block;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.4,1)}
.dsh-pet-sprite-row b{width:78px;flex:none;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;font-size:10.5px;color:#1f2430}
.dsh-pet-sprite-exp .cap{display:flex;justify-content:space-between;color:#6b7280;font-size:10.5px;margin:8px 0 3px}
.dsh-pet-sprite-sec h4{margin:10px 0 5px;font-size:10px;color:#6b7280;font-weight:800;letter-spacing:.5px}
.dsh-pet-sprite-acts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
.dsh-pet-sprite-btn{border:1.5px solid #2a2f3e;background:#f6f7fa;border-radius:8px;padding:6px 2px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;color:#1f2430;transition:transform .12s,background .12s}
.dsh-pet-sprite-btn:hover{background:#eef0f4}
.dsh-pet-sprite-btn:active{transform:scale(.94)}
.dsh-pet-sprite-btn:disabled{opacity:.4;cursor:not-allowed}
.dsh-pet-sprite-item{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:8px;border:1.5px solid #e5e7eb;margin-bottom:5px;background:#fff}
.dsh-pet-sprite-item .ic{font-size:14px;flex:none}
.dsh-pet-sprite-item .nm{font-weight:700;flex:none;font-size:11.5px;color:#1f2430;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-sprite-item .fx{color:#6b7280;flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-sprite-item .qty{flex:none;font-variant-numeric:tabular-nums;color:#6b7280;font-size:10.5px}
.dsh-pet-sprite-buy{flex:none;border:1.5px solid #2a2f3e;border-radius:6px;padding:2.5px 8px;font-size:10.5px;font-weight:800;cursor:pointer;background:#ffd33d;color:#1f2430;font-family:inherit}
.dsh-pet-sprite-buy:disabled{opacity:.35;cursor:not-allowed}
.dsh-pet-sprite-buy:not(:disabled):active{transform:scale(.94)}
.dsh-pet-sprite-switch{display:block;width:100%;margin-top:12px;color:#6b7280;background:#fff}
.dsh-pet-sprite-set-note{color:#6b7280;font-size:10.5px;line-height:1.6;margin:4px 0 8px}
.dsh-pet-sprite-set select{width:100%;border:1.5px solid #2a2f3e;border-radius:8px;padding:6px 8px;font:700 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1f2430;background:#fff;margin-bottom:8px;outline:none}
.dsh-pet-sprite-set label{display:block;font-size:10.5px;font-weight:800;color:#6b7280;margin:8px 0 4px}
.dsh-pet-sprite-set textarea{display:block;width:100%;box-sizing:border-box;border:1.5px solid #2a2f3e;border-radius:8px;padding:6px 8px;font:600 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1f2430;background:#fff;outline:none;resize:vertical;min-height:54px;margin-bottom:4px}
.dsh-pet-sprite-set textarea:focus,.dsh-pet-sprite-set input:focus{background:#fffbe8}
.dsh-pet-sprite-set input{display:block;width:100%;box-sizing:border-box;border:1.5px solid #2a2f3e;border-radius:8px;padding:6px 8px;font:600 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1f2430;background:#fff;outline:none;margin-bottom:6px}
.dsh-pet-sprite-gen-btn{display:block;width:100%;margin-top:2px}
.dsh-pet-sprite-lines-toggle{display:block;width:100%;margin-top:8px;color:#4f6ef7;background:#f0f3ff}
.dsh-pet-sprite-lines-toggle:hover{background:#e3e9ff}
.dsh-pet-sprite-lines{border:1.5px dashed #c9cede;border-radius:10px;padding:8px 8px 4px;margin-top:6px;background:#fafbff}
.dsh-pet-sprite-lines textarea{margin-bottom:8px}
.dsh-pet-sprite-import-file{display:none}
.dsh-pet-sprite-import-row{display:flex;gap:6px}
.dsh-pet-sprite-import-row .dsh-pet-sprite-btn{flex:1}
.dsh-pet-sprite-paste-box{margin-bottom:6px}
.dsh-pet-sprite-set-err{border:1.5px solid #e8434e;border-radius:8px;background:#ffe9ec;color:#b32832;font-size:10.5px;font-weight:700;padding:6px 9px;margin:6px 0;line-height:1.5;word-break:break-word}
.dsh-pet-sprite-log{border:1.5px solid #2a2f3e;border-radius:10px;background:#fffbe8;padding:7px 9px;margin-top:8px;font-size:11.5px;font-weight:600;line-height:1.7;color:#1f2430;white-space:pre-wrap;word-break:break-word}
.dsh-pet-sprite-toast{position:fixed;z-index:960;background:#1f2430;color:#fff;font-size:12px;padding:7px 13px;border-radius:9px;box-shadow:0 4px 0 rgba(0,0,0,.2);animation:dshPetSpriteToast 2.6s ease forwards;max-width:260px}
@keyframes dshPetSpriteToast{from{opacity:0;transform:translateY(8px)}10%,80%{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-6px)}}
`;
	document.head.appendChild(s);
}
const CarePanel = ({ engine, anchor, petName, chatModel, onChatModelChange, profile, onProfileChange, onGeneratePet, onImportPet, onPetSay, onSwitchPet, onClose }) => {
	const [, bump] = (0, react.useState)(0);
	const [tab, setTab] = (0, react.useState)("status");
	const [toast, setToast] = (0, react.useState)(null);
	const [modelList, setModelList] = (0, react.useState)(null);
	const [modelListError, setModelListError] = (0, react.useState)(null);
	const [genDesc, setGenDesc] = (0, react.useState)("");
	const [generating, setGenerating] = (0, react.useState)(false);
	const [genError, setGenError] = (0, react.useState)(null);
	const importInputRef = (0, react.useRef)(null);
	const [pasteOpen, setPasteOpen] = (0, react.useState)(false);
	const [pasteText, setPasteText] = (0, react.useState)("");
	const [importError, setImportError] = (0, react.useState)(null);
	const [linesOpen, setLinesOpen] = (0, react.useState)(false);
	const [logBusy, setLogBusy] = (0, react.useState)(false);
	const [logError, setLogError] = (0, react.useState)(null);
	const [logText, setLogText] = (0, react.useState)(() => getWitnessDay().lastLog ?? null);
	(0, react.useEffect)(() => {
		injectPanelStyles();
	}, []);
	const loadModels = (0, react.useCallback)(async () => {
		if (modelList !== null || modelListError !== null) return;
		try {
			const res = await fetch("/plugins/dsh-pet-sprite/models");
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			setModelList(data.providers ?? []);
		} catch (error) {
			setModelListError(error instanceof Error ? error.message : String(error));
		}
	}, [modelList, modelListError]);
	(0, react.useEffect)(() => {
		if (tab === "set") loadModels();
	}, [tab, loadModels]);
	const say = (0, react.useCallback)((text) => {
		setToast({
			id: Date.now(),
			text
		});
	}, []);
	const refresh = (0, react.useCallback)(() => bump((v) => v + 1), []);
	const linesText = (key) => profile.lines[key]?.join("\n") ?? "";
	const setLines = (key, text) => {
		const rows = text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 8);
		const next = { ...profile.lines };
		if (rows.length > 0) next[key] = rows;
		else delete next[key];
		onProfileChange({ lines: next });
	};
	const petLine = (key, fallback) => {
		const pool = profile.lines[key];
		return pool !== void 0 && pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : fallback;
	};
	const PW = 260, PH = 380;
	let px = anchor.x - PW - 16;
	if (px < 8) px = anchor.x + 16 + 48;
	if (px + PW > window.innerWidth - 8) px = Math.max(8, window.innerWidth - PW - 8);
	let py = anchor.y - PH + 28;
	if (py < 8) py = Math.min(window.innerHeight - 160, anchor.y + 20);
	py = Math.max(8, py);
	const stats = engine.getStats();
	const info = engine.levels.getInfo();
	const expPct = info.expToNext > 0 ? Math.min(100, Math.round((info.exp - info.currentLevelExp) / info.expToNext * 100)) : 100;
	const inv = engine.inventory.list().filter((it) => it.quantity !== 0);
	const shop = engine.shop.listShop({
		power: stats.power,
		health: stats.health,
		mood: stats.mood,
		adventureActive: false
	}).slice(0, 8);
	const day = getWitnessDay();
	const fmtChars = (n) => n >= 1e4 ? `${(n / 1e4).toFixed(1)} 万字` : `${n} 字`;
	const doPlay = (id) => {
		const r = engine.care.play(id);
		if (r.ok) {
			recordCare("play");
			say(petLine("play", id === "hide_seek" ? "捉迷藏！心情 +10 电量 -18" : "晒了一会太阳，心情 +5"));
		} else if (r.reason === "too_low_power") say("电量不够玩了，先喂点东西吧");
		refresh();
	};
	const doRest = () => {
		const r = engine.care.rest({
			duration: 30,
			wokeBy: "manual"
		});
		if (r.ok) {
			recordCare("rest");
			say(petLine("rest", `睡了 30 秒：心情 +${r.moodGain} 电量 -${r.powerCost}`));
		}
		refresh();
	};
	const doUse = (id) => {
		const r = engine.care.useItem(id);
		if (!r.ok) {
			say(r.reason === "cooldown" ? "还在冷却中…" : "没有这个道具了");
			return;
		}
		recordCare("feed");
		const def = engine.inventory.getItemDef(id);
		say(petLine("feed", def?.useText ?? `用掉了 ${id}`));
		refresh();
	};
	const doBuy = (id) => {
		const r = engine.shop.buy(id);
		if (r.ok) say(`买好了 ${id}`);
		else if (r.reason === "insufficient_coins") say("金币不够");
		else if (r.reason === "level_too_low") say("等级不够，还解锁不了");
		else if (r.reason === "daily_limit") say("今天卖完了，明天再来");
		else say(`买不了（${r.reason}）`);
		refresh();
	};
	const doWitness = async () => {
		if (logBusy) return;
		if (chatModel === null) {
			setLogError("还没有选择模型：先在「设置」里选一个。");
			return;
		}
		setLogBusy(true);
		setLogError(null);
		try {
			const day$1 = getWitnessDay();
			const res = await fetch("/plugins/dsh-pet-sprite/witness", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					petName,
					persona: profile.persona,
					lang: navigator.language,
					provider: chatModel.provider,
					model: chatModel.model,
					day: {
						turns: day$1.turns,
						tasks: day$1.tasks,
						inChars: day$1.inChars,
						outChars: day$1.outChars,
						spanMinutes: day$1.lastAt > day$1.firstAt ? Math.round((day$1.lastAt - day$1.firstAt) / 6e4) : 0,
						night: day$1.night,
						feed: day$1.feed,
						play: day$1.play,
						rest: day$1.rest,
						levelUps: day$1.levelUps
					}
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			const log = (data.log ?? "").trim();
			if (log.length === 0) throw new Error("模型没有写出日志。");
			setLogText(log);
			saveLogText(log);
			onPetSay(log);
			if (claimLogReward()) {
				engine.shop.earnCoins(20, "witness_log");
				say("见证完成，+🪙20");
			} else say("已更新今日日志");
			refresh();
		} catch (error) {
			setLogError(error instanceof Error ? error.message : String(error));
		} finally {
			setLogBusy(false);
		}
	};
	const doGenerate = async () => {
		const description = genDesc.trim();
		if (description.length === 0 || generating) return;
		setGenerating(true);
		setGenError(null);
		const r = await onGeneratePet(description);
		setGenerating(false);
		if (r.ok) {
			setGenDesc("");
			say(`新伙伴「${r.name ?? ""}」加入！已切换为它。`);
		} else setGenError(r.error ?? "生成失败，再试一次。");
		refresh();
	};
	const doImport = (text) => {
		const r = onImportPet(text);
		if (r.ok) {
			setImportError(null);
			setPasteOpen(false);
			setPasteText("");
			say(`「${r.name ?? ""}」加入了！已切换为它。`);
		} else setImportError(r.error ?? "导入失败。");
		refresh();
	};
	const doImportFile = (file) => {
		if (file === void 0) return;
		file.text().then(doImport, () => setImportError("读不出这个文件。"));
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dsh-pet-sprite-panel",
		role: "dialog",
		"aria-label": "Pet 照顾面板",
		style: {
			left: px,
			top: py
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-panel-hd",
				children: [
					petName,
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "sub",
						children: [
							"Lv.",
							stats.level,
							" ",
							stats.title
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "coins",
						children: ["🪙 ", stats.coins]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dsh-pet-sprite-panel-x",
						onClick: onClose,
						"aria-label": "关闭",
						children: "✕"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-tabs",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: `dsh-pet-sprite-tab ${tab === "status" ? "on" : ""}`,
						onClick: () => setTab("status"),
						children: "状态"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: `dsh-pet-sprite-tab ${tab === "bag" ? "on" : ""}`,
						onClick: () => setTab("bag"),
						children: "背包"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: `dsh-pet-sprite-tab ${tab === "shop" ? "on" : ""}`,
						onClick: () => setTab("shop"),
						children: "商店"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: `dsh-pet-sprite-tab ${tab === "set" ? "on" : ""}`,
						onClick: () => setTab("set"),
						children: "设置"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-panel-bd",
				children: [
					tab === "status" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "心情" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-pet-sprite-bar",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
										width: `${stats.mood}%`,
										background: barColor(stats.moodLevel)
									} })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
									stats.mood,
									" ",
									LEVEL_NAMES[stats.moodLevel] ?? stats.moodLevel
								] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "电量" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-pet-sprite-bar",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
										width: `${Math.min(100, stats.power / 3)}%`,
										background: barColor(stats.powerLevel)
									} })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
									stats.power,
									" ",
									LEVEL_NAMES[stats.powerLevel] ?? stats.powerLevel
								] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "健康" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-pet-sprite-bar",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
										width: `${stats.health}%`,
										background: barColor(stats.healthLevel)
									} })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
									stats.health,
									" ",
									LEVEL_NAMES[stats.healthLevel] ?? stats.healthLevel
								] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-exp",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cap",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["经验 → Lv.", stats.level + 1] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [expPct, "%"] })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-pet-sprite-bar",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
									width: `${expPct}%`,
									background: "#4f6ef7"
								} })
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-sec",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "互动" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-acts",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dsh-pet-sprite-btn",
										onClick: () => doPlay("hide_seek"),
										children: "捉迷藏"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dsh-pet-sprite-btn",
										onClick: () => doPlay("sunbathe"),
										children: "晒太阳"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dsh-pet-sprite-btn",
										onClick: doRest,
										children: "睡一会"
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-sec",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "工作日志" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-pet-sprite-set-note",
									children: [
										"今日：对话 ",
										day.turns,
										" 轮 · 完成 ",
										day.tasks,
										" 件 · 输出 ",
										fmtChars(day.outChars),
										day.night ? " · 凌晨仍在干活" : "",
										" —— ",
										petName,
										" 都看在眼里。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-pet-sprite-btn dsh-pet-sprite-gen-btn",
									onClick: () => {
										doWitness();
									},
									disabled: logBusy,
									children: logBusy ? "写日志中……" : logText !== null ? "重新生成今日日志" : "生成今日工作日志"
								}),
								logError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-pet-sprite-set-err",
									children: logError
								}),
								logText !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-pet-sprite-log",
									children: logText
								})
							]
						})
					] }),
					tab === "bag" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-pet-sprite-sec",
						children: [inv.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								color: "#6b7280",
								fontSize: 11
							},
							children: "背包空空的，去「商店」补货"
						}), inv.map((it) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-item",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ic",
									children: it.def.icon
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nm",
									children: it.def.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "fx",
									children: CAT_NAMES[it.def.category] ?? it.def.category
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "qty",
									children: ["×", it.quantity < 0 ? "∞" : it.quantity]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-pet-sprite-buy",
									disabled: !it.canUse,
									onClick: () => doUse(it.itemId),
									children: "使用"
								})
							]
						}, it.itemId))]
					}),
					tab === "shop" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-pet-sprite-sec",
						children: shop.map((it) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-pet-sprite-item",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "ic",
									children: it.icon
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "nm",
									children: it.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "qty",
									children: ["🪙", it.price]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-pet-sprite-buy",
									disabled: !it.canBuy,
									onClick: () => doBuy(it.id),
									children: "购买"
								})
							]
						}, it.id))
					}),
					tab === "set" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-pet-sprite-sec dsh-pet-sprite-set",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "聊天模型" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-set-note",
								children: [
									"左键点击 ",
									petName,
									" 可以聊天；这里选择由哪个模型来扮演它（复用本页已配置的服务商和密钥）。"
								]
							}),
							modelListError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-set-err",
								children: ["模型列表加载失败：", modelListError]
							}),
							modelList === null && modelListError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-pet-sprite-set-note",
								children: "加载模型列表……"
							}),
							modelList !== null && modelList.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-pet-sprite-set-note",
								children: "没有可用模型：先在 DSH 设置里配置一个模型服务商。"
							}),
							modelList !== null && modelList.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "服务商" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: chatModel?.provider ?? "",
									onChange: (e) => {
										const p = modelList.find((m) => m.id === e.target.value);
										onChatModelChange(p && p.models.length > 0 ? {
											provider: p.id,
											model: p.models[0].id
										} : null);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										disabled: chatModel !== null,
										children: "选择服务商"
									}), modelList.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: p.id,
										disabled: p.models.length === 0,
										children: [
											p.name,
											"（",
											p.id,
											"）",
											p.models.length === 0 ? " — 模型列表不可用" : ""
										]
									}, p.id))]
								}),
								modelList.filter((p) => p.error !== void 0).map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-pet-sprite-set-err",
									children: [
										p.name,
										"：",
										p.error
									]
								}, p.id)),
								chatModel !== null && (() => {
									const p = modelList.find((m) => m.id === chatModel.provider);
									return p ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "模型" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											value: chatModel.model,
											onChange: (e) => onChatModelChange({
												provider: chatModel.provider,
												model: e.target.value
											}),
											children: p.models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: m.id,
												children: m.name === m.id ? m.id : `${m.name}（${m.id}）`
											}, m.id))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-pet-sprite-set-note",
											children: [
												"当前：",
												chatModel.provider,
												" / ",
												chatModel.model
											]
										})
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-pet-sprite-set-note",
										children: "已保存的服务商不在当前列表里，重新选一个吧。"
									});
								})()
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "角色设定" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-set-note",
								children: [
									"给 ",
									petName,
									" 写的性格设定，聊天时会优先按它来演；留空则用默认性格。导出分享时会一并带给朋友。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: profile.persona,
								onChange: (e) => onProfileChange({ persona: e.target.value }),
								placeholder: "例如：嘴硬心软的傲娇性格，喜欢被夸，偶尔阴阳怪气但很靠得住",
								maxLength: 500,
								rows: 3
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-pet-sprite-btn dsh-pet-sprite-lines-toggle",
								onClick: () => setLinesOpen((v) => !v),
								children: linesOpen ? "收起事件台词" : "定制事件台词（待机 / 工作 / 互动…）"
							}),
							linesOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-lines",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-pet-sprite-set-note",
										children: "每行一条，随机触发；留空用默认。最多 8 条，每条 24 字内。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "待机闲聊" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("idle"),
										onChange: (e) => setLines("idle", e.target.value),
										rows: 2,
										placeholder: "云看起来像棉花糖。\n悄悄说：我在攒星币。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "开工（agent 开始干活）" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("work"),
										onChange: (e) => setLines("work", e.target.value),
										rows: 2,
										placeholder: "开工啦。\n让我盯着点……"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "完成（agent 干完活）" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("done"),
										onChange: (e) => setLines("done", e.target.value),
										rows: 2,
										placeholder: "呼——完成啦。\n辛苦辛苦。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "状态差（饿 / 不开心）" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("low"),
										onChange: (e) => setLines("low", e.target.value),
										rows: 2,
										placeholder: "有点累了，想休息……\n能量快见底了……"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "喂食后" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("feed"),
										onChange: (e) => setLines("feed", e.target.value),
										rows: 2,
										placeholder: "好吃！再来一口？"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "玩耍后" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("play"),
										onChange: (e) => setLines("play", e.target.value),
										rows: 2,
										placeholder: "再来再来！"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", { children: "休息后" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										value: linesText("rest"),
										onChange: (e) => setLines("rest", e.target.value),
										rows: 2,
										placeholder: "睡饱了～"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "生成新形象" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-set-note",
								children: [
									"用一句话描述想要的伙伴，模型会画出它的像素形象并加入选择列表（当前 🪙",
									stats.coins,
									"）。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: genDesc,
								onChange: (e) => setGenDesc(e.target.value),
								placeholder: "例如：戴圆眼镜的绿色小恐龙",
								maxLength: 200,
								disabled: generating,
								onKeyDown: (e) => {
									if (e.key === "Enter") doGenerate();
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-pet-sprite-btn dsh-pet-sprite-gen-btn",
								onClick: () => {
									doGenerate();
								},
								disabled: generating || genDesc.trim().length === 0,
								children: generating ? "绘制中……" : "生成新伙伴（🪙100）"
							}),
							genError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-pet-sprite-set-err",
								children: genError
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "导入伙伴" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-set-note",
								children: [
									"朋友分享的 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: ".dsh-pet.json" }),
									" 文件可以直接导入，免费加入形象列表。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: importInputRef,
								type: "file",
								accept: ".json,application/json",
								className: "dsh-pet-sprite-import-file",
								onChange: (e) => {
									doImportFile(e.target.files?.[0]);
									e.target.value = "";
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-pet-sprite-import-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-pet-sprite-btn",
									onClick: () => importInputRef.current?.click(),
									children: "选择文件"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-pet-sprite-btn",
									onClick: () => {
										setPasteOpen((v) => !v);
										setImportError(null);
									},
									children: pasteOpen ? "收起粘贴框" : "粘贴 JSON"
								})]
							}),
							pasteOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: pasteText,
								onChange: (e) => setPasteText(e.target.value),
								placeholder: "粘贴分享文件的内容（以 {\"format\":\"dsh-pet-sprite\" 开头）",
								rows: 3,
								className: "dsh-pet-sprite-paste-box"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-pet-sprite-btn dsh-pet-sprite-gen-btn",
								onClick: () => doImport(pasteText),
								disabled: pasteText.trim().length === 0,
								children: "导入"
							})] }),
							importError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-pet-sprite-set-err",
								children: importError
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "形象" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-pet-sprite-btn dsh-pet-sprite-switch",
								onClick: onSwitchPet,
								children: "更换形象"
							})
						]
					})
				]
			})
		]
	}), toast && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dsh-pet-sprite-toast",
		style: {
			left: px,
			top: py - 34
		},
		children: toast.text
	}, toast.id)] });
};

//#endregion
//#region src/client/PetChatBox.tsx
let chatStyleInjected = false;
function injectChatStyles() {
	if (chatStyleInjected) return;
	chatStyleInjected = true;
	const s = document.createElement("style");
	s.textContent = `
.dsh-pet-sprite-chat{position:absolute;z-index:1001;width:300px;max-width:calc(100vw - 24px);background:#fff;border:3px solid #4a4553;border-radius:16px;box-shadow:0 6px 0 rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:auto;animation:dshPetSpriteChatIn .38s cubic-bezier(.2,1.6,.4,1) both;overflow:hidden}
@keyframes dshPetSpriteChatIn{from{opacity:0;transform:translateY(14px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
.dsh-pet-sprite-chat-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:2.5px solid #4a4553;background:#ffd33d}
.dsh-pet-sprite-chat-hd .nm{font-size:13.5px;font-weight:900;color:#4a4553;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-pet-sprite-chat-hd .clr,.dsh-pet-sprite-chat-hd .x{border:2.5px solid #4a4553;border-radius:999px;background:#fff;color:#4a4553;cursor:pointer;font:800 10.5px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:4px 9px;box-shadow:0 2px 0 rgba(0,0,0,.15);transition:transform .15s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-chat-hd .x{width:24px;height:24px;padding:0;font:900 14px/19px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}
.dsh-pet-sprite-chat-hd .clr:hover{transform:rotate(-4deg) scale(1.06)}
.dsh-pet-sprite-chat-hd .x:hover{transform:rotate(90deg) scale(1.1);background:#ffe3e3}
.dsh-pet-sprite-chat-log{max-height:218px;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:repeating-linear-gradient(45deg,#fdfdff 0 8px,#f6f7fb 8px 16px)}
.dsh-pet-sprite-chat-msg{max-width:82%;padding:5px 11px;border:2.5px solid #4a4553;border-radius:12px;font-size:12.5px;line-height:1.55;color:#4a4553;white-space:pre-wrap;word-break:break-word;box-shadow:0 2px 0 rgba(0,0,0,.12)}
.dsh-pet-sprite-chat-msg.u{align-self:flex-end;background:#dcebff;border-bottom-right-radius:4px}
.dsh-pet-sprite-chat-msg.p{align-self:flex-start;background:#fff;border-bottom-left-radius:4px}
.dsh-pet-sprite-chat-empty{font-size:11.5px;color:#9a95a5;text-align:center;padding:18px 6px;line-height:1.7}
.dsh-pet-sprite-chat-ft{display:flex;gap:8px;padding:9px 10px;border-top:2.5px solid #4a4553;background:#fff}
.dsh-pet-sprite-chat-ft input{flex:1;min-width:0;border:2.5px solid #4a4553;border-radius:10px;padding:7px 11px;font:600 12.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#4a4553;background:#fff;outline:none}
.dsh-pet-sprite-chat-ft input:focus{background:#fffbe8}
.dsh-pet-sprite-chat-ft input:disabled{opacity:.55}
.dsh-pet-sprite-chat-send{border:2.5px solid #4a4553;border-radius:10px;background:#ffd33d;color:#4a4553;font:900 12px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:0 15px;cursor:pointer;box-shadow:0 2.5px 0 rgba(0,0,0,.16);transition:transform .12s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-chat-send:hover{transform:translateY(-2px)}
.dsh-pet-sprite-chat-send:active{transform:translateY(1px)}
.dsh-pet-sprite-chat-send:disabled{opacity:.5;cursor:default;transform:none}
.dsh-pet-sprite-chat-err{margin:0 12px 8px;padding:6px 10px;border:2.5px solid #e8434e;border-radius:10px;background:#ffe9ec;color:#b32832;font-size:11.5px;font-weight:700;line-height:1.5;word-break:break-word}
.dsh-pet-sprite-chat-typing{align-self:flex-start;display:flex;gap:4px;padding:8px 12px;border:2.5px solid #4a4553;border-radius:12px;background:#fff;box-shadow:0 2px 0 rgba(0,0,0,.12)}
.dsh-pet-sprite-chat-typing i{width:6px;height:6px;border-radius:50%;background:#9a95a5;animation:dshPetSpriteChatDot 1s ease-in-out infinite}
.dsh-pet-sprite-chat-typing i:nth-child(2){animation-delay:.15s}
.dsh-pet-sprite-chat-typing i:nth-child(3){animation-delay:.3s}
@keyframes dshPetSpriteChatDot{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-chat{animation-duration:.01s}}
`;
	document.head.appendChild(s);
}
const PetChatBox = ({ petName, anchor, model, history, busy, error, onSend, onClear, onClose }) => {
	const [draft, setDraft] = (0, react.useState)("");
	const logRef = (0, react.useRef)(null);
	const inputRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		injectChatStyles();
	}, []);
	(0, react.useEffect)(() => {
		if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [
		history,
		busy,
		error
	]);
	(0, react.useEffect)(() => {
		inputRef.current?.focus();
	}, []);
	const left = Math.min(Math.max(anchor.x + 56, 12), window.innerWidth - 312);
	const top = Math.min(Math.max(anchor.y - 240, 12), Math.max(window.innerHeight - 340, 12));
	const send = () => {
		const text = draft.trim();
		if (text.length === 0 || busy) return;
		setDraft("");
		onSend(text);
	};
	const modelHint = model === null ? "（未选择模型：在照顾面板 → 设置里选一个）" : `${model.provider} / ${model.model}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dsh-pet-sprite-chat",
		style: {
			left,
			top
		},
		role: "dialog",
		"aria-label": `和${petName}聊天`,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-chat-hd",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "nm",
						children: petName
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "clr",
						onClick: onClear,
						title: "清空聊天记录",
						children: "清空"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "x",
						"aria-label": "关闭",
						onClick: onClose,
						children: "×"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-chat-log",
				ref: logRef,
				children: [
					history.length === 0 && !busy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-pet-sprite-chat-empty",
						children: [
							"和 ",
							petName,
							" 说点什么吧",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 10.5,
									color: "#b3aebe"
								},
								children: modelHint
							})
						]
					}),
					history.map((m, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `dsh-pet-sprite-chat-msg ${m.role === "user" ? "u" : "p"}`,
						children: m.text
					}, i)),
					busy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-pet-sprite-chat-typing",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
						]
					})
				]
			}),
			error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-pet-sprite-chat-err",
				children: error
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-pet-sprite-chat-ft",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: inputRef,
					value: draft,
					placeholder: busy ? "想一想……" : `对 ${petName} 说……`,
					maxLength: 500,
					disabled: busy,
					onChange: (e) => setDraft(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter") send();
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dsh-pet-sprite-chat-send",
					disabled: busy || draft.trim().length === 0,
					onClick: send,
					children: "发送"
				})]
			})
		]
	});
};

//#endregion
//#region src/client/pet-art.ts
const PET_IDS = [
	"poka",
	"mikan",
	"puff"
];
const PAL = {
	o: "#4a4553",
	h: "#f6f7fc",
	H: "#dcdff0",
	s: "#ffe9dc",
	S: "#f2cdb9",
	e: "#3c3744",
	X: "#ffffff",
	w: "#ffffff",
	t: "#e8434e",
	T: "#b32832",
	k: "#9c6640",
	K: "#7d4e2c",
	b: "#ffb3ae",
	m: "#e8927c",
	l: "#39496b",
	g: "#8fd0ff",
	z: "#8fa3c8",
	f: "#f4a45c",
	F: "#d9803a",
	p: "#f2839b",
	u: "#4d6efa",
	c: "#e7edff"
};
function repl(rows, edits) {
	const c = rows.slice();
	for (const k in edits) c[+k] = edits[k];
	return c;
}
function drawPet(cv, rows) {
	const sc = cv.width / 24;
	const x = cv.getContext("2d");
	if (!x) return;
	x.clearRect(0, 0, cv.width, cv.height);
	for (let y = 0; y < rows.length; y++) {
		const r = rows[y];
		for (let i = 0; i < 24; i++) {
			const ch = r[i];
			if (ch === "." || ch === void 0) continue;
			x.fillStyle = PAL[ch] ?? "#f0f";
			x.fillRect(i * sc, y * sc, sc, sc);
		}
	}
}
const POKA_BASE = [
	"........oooooooo........",
	"......oohhhhhhhhoo......",
	".....ohhhhhhhhhhhho.....",
	"....ohhhhhhhhhhhhhho....",
	"...ohhhhhhhhhhhhhhhho...",
	"..ohhhhhhhhhhhhhhhhhho..",
	"..ohhhhhhhhhhhhhhhhhho..",
	"..ohhHhsssssssssshHhho..",
	"..ohhsssssssssssssshho..",
	"..ohsseXessssseXesshho..",
	"..ohsseeessssseeesshho..",
	"..ohsbsssssssssssbshho..",
	"..ohssssssmmssssssshho..",
	"...ohhsssssssssssshho...",
	"....ohhsssssssssshho....",
	"..ohho..osssso..ohho....",
	"..ohho.owwwwwwo.ohho....",
	"..ohhoowwwttwwwoohho....",
	"..ohHo.swwtTws..oHho....",
	"...oho.okkkkkko..oho....",
	"...oo.okkkkkkkko..oo....",
	"......okkkkkkkkko.......",
	".....okKkKkKkKkKko......",
	".....oKKKKKKKKKKKo......",
	"........ss....ss........",
	"........ss....ss........",
	".......oss....sso.......",
	".......ooo....ooo......."
];
function pokaClosedEyes(rows) {
	const c = rows.slice();
	c[9] = c[9].replace(/[eX]/g, "s");
	c[10] = c[10].replace(/e/g, "S");
	return c;
}
const POKA = {
	I: POKA_BASE,
	B: ["........................"].concat(POKA_BASE.slice(0, 16), POKA_BASE.slice(17)),
	BL: pokaClosedEyes(POKA_BASE),
	ZZ: repl(pokaClosedEyes(["........................"].concat(POKA_BASE.slice(0, 16), POKA_BASE.slice(17))), {
		1: "......oohhhhhhhhoo...z..",
		2: ".....ohhhhhhhhhhhho.z...",
		3: "....ohhhhhhhhhhhhhho..z."
	}),
	WA: repl(POKA_BASE, { 19: "...oho.ollllllo..oho...." }),
	WB: repl(repl(POKA_BASE, { 19: "...oho.ollllllo..oho...." }), {
		18: "..ohHo..wwtTw...oHho....",
		16: "..ohho.owwwwwwo.ohho..g."
	}),
	KA: repl(POKA_BASE, {
		24: ".......ss......ss.......",
		25: ".......ss......ss.......",
		26: "......oss......sso......",
		27: "......ooo......ooo......"
	}),
	KB: repl(POKA_BASE, {
		24: ".........ss..ss.........",
		25: ".........ss..ss.........",
		26: "........oss..sso........",
		27: "........ooo..ooo........"
	}),
	JP: repl(POKA_BASE, {
		24: ".........ss..ss.........",
		25: "........oss..sso........",
		26: "........ooo..ooo........",
		27: "........................"
	})
};
const CAT_BASE = [
	"........................",
	"........................",
	"........................",
	"........................",
	"........................",
	".......oo......oo.......",
	"......ofpo....opfo......",
	".....offfo....offfo.....",
	"....offffffffffffffo....",
	"....ofFffffFFfffFffo....",
	"....offeeffffffeeffo....",
	"....offeeffffffeeffo....",
	"....offffffppffffffo....",
	"....offffffmmffffffo....",
	"..ww.offffffffffffo.ww..",
	".....ofbffffffffbfo.....",
	"......offffffffffo......",
	"......offffffffffo......",
	".....offfwwwwwwfffo.....",
	"....offffwwwwwwffffo....",
	"....offffwwwwwwffffo....",
	"....offffwwwwwwffffo....",
	".....offffwwwwffffo.....",
	".....offwwwffwwwffo.....",
	".....offwwwffwwwffo.....",
	".....offwwwffwwwffo.....",
	"......owwwo.owwwo.......",
	".......ooo...ooo........"
];
const CAT_EYES_CLOSED = {
	10: "....offffffffffffffo....",
	11: "....offffffffffffffo...."
};
const CAT_TUCKED = {
	23: ".....offffffffffffo.....",
	24: ".....offffffffffffo.....",
	25: "......offffffffffo......",
	26: ".......oofffffoo........",
	27: "........................"
};
const CAT = {
	I: CAT_BASE,
	B: ["........................"].concat(CAT_BASE.slice(0, 16), CAT_BASE.slice(17)),
	BL: repl(CAT_BASE, CAT_EYES_CLOSED),
	ZZ: repl(repl(CAT_BASE, {
		...CAT_EYES_CLOSED,
		...CAT_TUCKED
	}), {
		5: ".......oo......oo....z..",
		6: "......ofpo....opfo..z...",
		7: ".....offfo....offfo....z"
	}),
	WA: repl(CAT_BASE, {
		25: ".....ollllllllllllo.....",
		26: "......oooooooooooo......",
		27: "........................"
	}),
	WB: repl(CAT_BASE, {
		...CAT_EYES_CLOSED,
		25: ".....ollllllllllllo.....",
		26: "......oooooooooooo......",
		27: "........................"
	}),
	KA: CAT_BASE,
	KB: repl(CAT_BASE, { 24: ".....offffffffffffo....." }),
	JP: repl(CAT_BASE, CAT_TUCKED)
};
const WHALE_BASE = [
	"........................",
	"........................",
	"........................",
	"........................",
	"........................",
	"........................",
	".........oo..oo.........",
	"........ouuoouuo........",
	"..........ouo...........",
	".......ouuuuuuuuo.......",
	".....ouuuuuuuuuuuuo.....",
	"....ouuuuuuuuuuuuuuo....",
	"...ouuuuuuuuuuuuuuuuo...",
	"...ouuuuuuuuuuuuuuuuo...",
	"..ouuuuuuuuuuuuuuuuuuo..",
	"..ouueeuuuuuuuueeuuuuo..",
	"..ouueeuuuuuuuueeuuuuo..",
	"..obbuuuuuummuuuuuubbo..",
	"..ouuuuuuccccccuuuuuuo..",
	"..ouuuuuccccccccuuuuuo..",
	"..ouuuuuccccccccuuuuuo..",
	"..ouuuuuccccccccuuuuuo..",
	"..ouuuuuuccccccuuuuuuo..",
	"...ouuuuuuccccuuuuuuo...",
	"....ouuuuuuuccuuuuuuo....",
	".....ouuuuuccuuuuuo.....",
	".......ouuuccuuuo.......",
	".........oooooo........."
];
const WHALE_EYES_CLOSED = {
	15: "..ouuuuuuuuuuuuuuuuuuo..",
	16: "..ouuuuuuuuuuuuuuuuuuo.."
};
const WHALE = {
	I: WHALE_BASE,
	B: ["........................"].concat(WHALE_BASE.slice(0, 12), WHALE_BASE.slice(13)),
	BL: repl(WHALE_BASE, WHALE_EYES_CLOSED),
	ZZ: repl(WHALE_BASE, {
		...WHALE_EYES_CLOSED,
		0: "...................z....",
		1: "..................z.....",
		2: "....................z..."
	}),
	WA: repl(WHALE_BASE, {
		6: "......olllllllllllo.....",
		7: "......olllllllllllo.....",
		8: "........................"
	}),
	WB: repl(WHALE_BASE, {
		...WHALE_EYES_CLOSED,
		6: "......olllllllllllo.....",
		7: "......olllllllllllo.....",
		8: "........................"
	}),
	KA: WHALE_BASE,
	KB: repl(WHALE_BASE, { 5: "...........gg..........." }),
	JP: repl(WHALE_BASE, {
		...WHALE_EYES_CLOSED,
		4: "...........gg...........",
		5: "..........gggg.........."
	})
};
const PET_ART = {
	poka: POKA,
	mikan: CAT,
	puff: WHALE
};
const EGG_ROWS = [
	"........................",
	"........................",
	"........................",
	"........................",
	"..........oooo..........",
	"........oohhhhoo........",
	".......oohhhhhhoo.......",
	"......oohhhhhhhhoo......",
	"......oohhzzhhhhoo......",
	".....oohhhhhhhhhhoo.....",
	".....oohhhoohhhhhoo.....",
	".....oohhhhhhhohhoo.....",
	".....oohhhhhhzhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	".....oohhhhhhhhhhoo.....",
	"......oohhhhhhhhoo......",
	"......oohhhhhhhhoo......",
	".......oohhhhhhoo.......",
	"........oohhhhoo........",
	"..........oooo..........",
	"........................",
	"........................",
	"........................",
	"........................"
];
const PET_META = {
	poka: {
		name: "波卡",
		tagline: "白发红领带的元气少女，初代形象",
		idleLines: []
	},
	mikan: {
		name: "橘丸",
		tagline: "额带虎斑的小橘猫，安静黏人",
		idleLines: [
			"喵？",
			"喵呜~",
			"悄悄说：我想吃小鱼干。"
		]
	},
	puff: {
		name: "蓝噗",
		tagline: "DeepSeek 蓝的小鲸鱼，思考时喷水花",
		idleLines: [
			"噗~",
			"咕噜咕噜。",
			"今天水温刚刚好。"
		]
	}
};
for (const id of PET_IDS) for (const [key, rows] of Object.entries(PET_ART[id])) for (let i = 0; i < rows.length; i++) if (rows[i].length !== 24) console.warn(`[dsh-pet-sprite] art width drift: ${id}.${key}[${i}] = ${rows[i].length}`);

//#endregion
//#region src/pixel-format.ts
const GRID_W = 24;
const GRID_H = 28;
/** Every palette character a sprite cell may use ('.' = transparent). */
const PALETTE_CHARS = "ohHsSeXwtTkKbmlgzfFpuc";
const PALETTE_SET = new Set(PALETTE_CHARS.split(""));
/**
* Coerce arbitrary LLM output into a valid 24x28 grid: pad/truncate rows,
* blank out unknown characters, cap at 28 rows. Fails when the result is
* too empty to read as a sprite.
*/
function fixGrid(raw) {
	if (!Array.isArray(raw)) return { error: "rows is not an array" };
	const rows = [];
	for (let i = 0; i < GRID_H; i++) {
		const src = typeof raw[i] === "string" ? raw[i] : "";
		let row = "";
		for (const ch of src.slice(0, GRID_W)) row += ch === "." || PALETTE_SET.has(ch) ? ch : ".";
		rows.push(row + ".".repeat(GRID_W - row.length));
	}
	const filled = rows.join("").replace(/\./g, "").length;
	if (filled < 80) return { error: "generated sprite is too empty to use — try a more concrete description" };
	return { rows };
}
/** True when the id refers to a user-generated (not builtin) companion. */
function isCustomPetId(id) {
	return id.startsWith("custom:");
}

//#endregion
//#region src/client/custom-pets.ts
/** A profile with nothing customized — everything falls back to defaults. */
const EMPTY_PROFILE = {
	persona: "",
	lines: {}
};
const PROFILE_KEY = "dshPetSpriteChat:profiles";
/** Legacy pre-profile key: one persona shared by every companion. */
const LEGACY_PERSONA_KEY = "dshPetSpriteChat:persona";
/** Sanitize one lines pool: drop blanks, clamp count and length. */
function cleanLines(v) {
	if (!Array.isArray(v)) return void 0;
	const cleaned = v.filter((s) => typeof s === "string").map((s) => s.trim().slice(0, 24)).filter((s) => s.length > 0).slice(0, 8);
	return cleaned.length > 0 ? cleaned : void 0;
}
/** Parse + clamp an unknown value into a PetProfile; never throws. */
function parseProfile(v) {
	const p = {
		persona: "",
		lines: {}
	};
	if (v === null || typeof v !== "object" || Array.isArray(v)) return p;
	const raw = v;
	if (typeof raw.persona === "string") p.persona = raw.persona.trim().slice(0, 500);
	if (raw.lines !== null && typeof raw.lines === "object" && !Array.isArray(raw.lines)) for (const key of [
		"idle",
		"work",
		"done",
		"low",
		"feed",
		"play",
		"rest"
	]) {
		const cleaned = cleanLines(raw.lines[key]);
		if (cleaned !== void 0) p.lines[key] = cleaned;
	}
	return p;
}
/** All per-pet profiles keyed by companion id (builtins included). */
function loadProfiles() {
	try {
		const v = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}");
		const out = {};
		for (const [id, prof] of Object.entries(v ?? {})) out[id] = parseProfile(prof);
		if (localStorage.getItem(`${PROFILE_KEY}:migrated`) === null && localStorage.getItem(LEGACY_PERSONA_KEY) !== null) {
			const activeId = localStorage.getItem("dshPetSpriteGame:petId");
			const legacy = (localStorage.getItem(LEGACY_PERSONA_KEY) ?? "").trim().slice(0, 500);
			if (activeId !== null && legacy.length > 0) out[activeId] = {
				persona: legacy,
				lines: out[activeId]?.lines ?? {}
			};
			localStorage.setItem(`${PROFILE_KEY}:migrated`, "1");
		}
		return out;
	} catch {
		return {};
	}
}
/** Persist one companion's profile; returns false when storage is unusable. */
function saveProfile(id, profile) {
	try {
		const all = loadProfiles();
		all[id] = profile;
		localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
		return true;
	} catch {
		return false;
	}
}
const KEY = "dshPetSprite:customPets";
function loadCustomPets() {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		if (!Array.isArray(v)) return [];
		return v.filter((p) => p !== null && typeof p === "object" && typeof p.id === "string" && isCustomPetId(p.id) && typeof p.name === "string" && Array.isArray(p.rows) && p.rows.length === GRID_H && p.rows.every((r) => typeof r === "string"));
	} catch {
		return [];
	}
}
/** Append one pet; returns false when localStorage is unusable (quota etc.). */
function saveCustomPet(pet) {
	try {
		const all = loadCustomPets();
		all.push(pet);
		localStorage.setItem(KEY, JSON.stringify(all));
		return true;
	} catch {
		return false;
	}
}
const SHARE_HEADER = "dsh-pet-sprite";
const NAME_MAX = 12;
const TAGLINE_MAX = 24;
function toShareFile(pet, profile) {
	return {
		format: SHARE_HEADER,
		version: 2,
		name: pet.name,
		tagline: pet.tagline,
		rows: pet.rows,
		profile: profile !== void 0 && (profile.persona.length > 0 || Object.keys(profile.lines).length > 0) ? profile : void 0
	};
}
/** Trigger a .dsh-pet.json download for one custom pet (sprite + soul). */
function downloadShareFile(pet, profile) {
	const blob = new Blob([JSON.stringify(toShareFile(pet, profile), null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	const safe = pet.name.replace(/[\\/:*?"<>|]/g, "").trim();
	a.download = `${safe.length > 0 ? safe : "pet"}.dsh-pet.json`;
	a.click();
	URL.revokeObjectURL(url);
}
/**
* Parse + validate a share file (from file picker or pasted text) and mint
* a fresh CustomPet plus its soul profile. v1 files (no profile) come in
* with an empty one. Same contract as generate: errors are strings for the
* UI, never thrown.
*/
function importFromText(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return { error: "不是有效的 JSON 文件。" };
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { error: "格式不对：需要 dsh-pet-sprite 分享文件。" };
	const v = raw;
	if (v.format !== SHARE_HEADER) return { error: "格式不对：缺少 dsh-pet-sprite 标识（请用「导出」生成的文件）。" };
	const name$1 = typeof v.name === "string" ? v.name.trim().slice(0, NAME_MAX) : "";
	if (name$1.length === 0) return { error: "名字缺失或为空。" };
	const tagline = typeof v.tagline === "string" ? v.tagline.trim().slice(0, TAGLINE_MAX) : "";
	const grid = fixGrid(v.rows);
	if ("error" in grid) return { error: `像素网格无效：${grid.error}` };
	return {
		pet: {
			id: `custom:${Date.now().toString(36)}`,
			name: name$1,
			tagline,
			rows: grid.rows,
			createdAt: Date.now()
		},
		profile: v.profile === void 0 ? {
			persona: "",
			lines: {}
		} : parseProfile(v.profile)
	};
}
const BLANK = ".".repeat(GRID_W);
function shiftDown(rows) {
	return [BLANK, ...rows.slice(0, GRID_H - 1)];
}
function shiftUp(rows) {
	return [...rows.slice(1), BLANK];
}
/**
* Generic eye-close for sprites we did not hand-author: repaint 'e' pixels
* with the row's dominant fill color, so the eyes melt into the face. Rows
* without 'e' (whale-style sprites, failures) pass through unchanged.
*/
function closeEyes(rows) {
	return rows.map((row) => {
		if (!row.includes("e")) return row;
		const counts = /* @__PURE__ */ new Map();
		for (const ch of row) if (ch !== "." && ch !== "e") counts.set(ch, (counts.get(ch) ?? 0) + 1);
		let fill = "o";
		let best = 0;
		for (const [ch, n] of counts) if (n > best) {
			best = n;
			fill = ch;
		}
		return row.replaceAll("e", fill);
	});
}
/** Stamp a 'z' pixel only where the cell is transparent (never over the art). */
function markZ(rows, row, col) {
	if (rows[row] !== void 0 && rows[row][col] === ".") rows[row] = rows[row].slice(0, col) + "z" + rows[row].slice(col + 1);
}
/**
* Derive the full frame set from one static grid. Builtin companions have
* hand-tuned variants; generated ones get whole-body motion, which reads
* well at 4x scale: idle = static, bob = 1px down, walk alternates the two,
* jump stretches 1px up, sleep bobs with closed eyes and a z trail.
*/
function framesFromRows(rows) {
	const bob = shiftDown(rows);
	const sleep = closeEyes(bob);
	markZ(sleep, 1, 21);
	markZ(sleep, 2, 22);
	markZ(sleep, 3, 23);
	return {
		I: rows,
		B: bob,
		BL: closeEyes(rows),
		ZZ: sleep,
		WA: rows,
		WB: bob,
		KA: rows,
		KB: bob,
		JP: shiftUp(rows)
	};
}

//#endregion
//#region src/client/PetPicker.tsx
let pickerStyleInjected = false;
function injectPickerStyles() {
	if (pickerStyleInjected) return;
	pickerStyleInjected = true;
	const s = document.createElement("style");
	s.textContent = `
.dsh-pet-sprite-picker{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background-color:rgba(74,69,83,.34);background-image:radial-gradient(rgba(255,255,255,.15) 1.2px,transparent 1.3px);background-size:11px 11px;pointer-events:auto;animation:dshPetSpritePickerIn .25s ease both;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
@keyframes dshPetSpritePickerIn{from{opacity:0}to{opacity:1}}
.dsh-pet-sprite-picker-panel{background:#fff;border:3px solid #4a4553;border-radius:20px;padding:24px 26px 22px;box-shadow:0 8px 0 rgba(0,0,0,.22);max-width:min(92vw,540px);max-height:86vh;overflow-y:auto;animation:dshPetSpritePickerPop .5s cubic-bezier(.2,1.7,.4,1) both;position:relative}
.dsh-pet-sprite-picker-x{position:absolute;top:9px;right:11px;width:26px;height:26px;border:2.5px solid #4a4553;border-radius:50%;background:#fff;color:#4a4553;font:900 15px/22px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.15);transition:transform .15s cubic-bezier(.2,1.5,.4,1)}
.dsh-pet-sprite-picker-x:hover{transform:rotate(90deg) scale(1.1);background:#ffe3e3}
@keyframes dshPetSpritePickerPop{from{opacity:0;transform:translateY(26px) scale(.84)}to{opacity:1;transform:translateY(0) scale(1)}}
.dsh-pet-sprite-picker-title{font-size:19px;font-weight:900;color:#4a4553;text-align:center;letter-spacing:.5px}
.dsh-pet-sprite-picker-sub{font-size:11.5px;font-weight:600;color:#9a95a5;text-align:center;margin:5px 0 16px}
.dsh-pet-sprite-picker-cards{display:flex;flex-wrap:wrap;gap:15px}
.dsh-pet-sprite-picker-card{flex:1 1 140px;min-width:0;background:#fff;border:2.5px solid #4a4553;border-radius:14px;padding:14px 8px 12px;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.16);transition:transform .18s cubic-bezier(.2,1.5,.4,1),box-shadow .18s;text-align:center;position:relative}
.dsh-pet-sprite-picker-card:hover{transform:translateY(-5px) rotate(-1.2deg);box-shadow:0 8px 0 rgba(0,0,0,.2)}
.dsh-pet-sprite-picker-card canvas{width:72px;height:84px;image-rendering:pixelated;display:block;margin:0 auto}
.dsh-pet-sprite-picker-card .nm{display:block;font-size:14px;font-weight:800;color:#4a4553;margin-top:8px}
.dsh-pet-sprite-picker-card .tg{display:block;font-size:10.5px;font-weight:600;color:#9a95a5;margin-top:3px;line-height:1.45}
.dsh-pet-sprite-picker-card.cur::before{content:'当前';position:absolute;top:-11px;right:10px;font-size:10px;font-weight:800;color:#4a4553;background:#ffd33d;border:2px solid #4a4553;border-radius:999px;padding:1px 8px;box-shadow:0 2px 0 rgba(0,0,0,.15)}
.dsh-pet-sprite-picker-card.picked{transform:scale(1.07) rotate(0deg);background:#fffbe8;box-shadow:0 8px 0 rgba(0,0,0,.2)}
.dsh-pet-sprite-picker-card.dim{opacity:.45;transform:scale(.96)}
.dsh-pet-sprite-picker-share{position:absolute;bottom:8px;right:8px;font-size:10px;font-weight:800;color:#4a4553;background:#ffd33d;border:2px solid #4a4553;border-radius:999px;padding:1px 8px;box-shadow:0 2px 0 rgba(0,0,0,.15);cursor:pointer;user-select:none}
.dsh-pet-sprite-picker-share:hover{background:#ffe27a;transform:scale(1.08)}
.dsh-pet-sprite-picker-share:active{transform:scale(.92)}
.dsh-pet-sprite-picker-card .tg{padding-bottom:18px}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-picker-panel{animation-duration:.01s}.dsh-pet-sprite-picker-card{transition:none}}
`;
	document.head.appendChild(s);
}
const PetCard = ({ pet, custom, profile, isCurrent, state, onPick }) => {
	const ref = (0, react.useRef)(null);
	const [blinking, setBlinking] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		let blinkTimer;
		const schedule = () => {
			blinkTimer = setTimeout(() => {
				setBlinking(true);
				setTimeout(() => setBlinking(false), 150);
				schedule();
			}, 2400 + Math.random() * 1200);
		};
		schedule();
		return () => clearTimeout(blinkTimer);
	}, []);
	(0, react.useEffect)(() => {
		const cv = ref.current;
		if (cv) drawPet(cv, blinking ? pet.frames.BL : pet.frames.I);
	}, [pet, blinking]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		className: `dsh-pet-sprite-picker-card${isCurrent ? " cur" : ""}${state !== "idle" ? ` ${state}` : ""}`,
		onClick: onPick,
		style: { fontFamily: "inherit" },
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
				ref,
				width: 96,
				height: 112,
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "nm",
				children: pet.name
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "tg",
				children: pet.tagline
			}),
			custom !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				role: "button",
				tabIndex: 0,
				className: "dsh-pet-sprite-picker-share",
				title: "导出分享文件",
				onClick: (e) => {
					e.stopPropagation();
					e.preventDefault();
					downloadShareFile(custom, profile);
				},
				onKeyDown: (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.stopPropagation();
						downloadShareFile(custom, profile);
					}
				},
				children: "分享"
			})
		]
	});
};
const PetPicker = ({ currentId, customPets, profiles, onPick, onClose }) => {
	const [picked, setPicked] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		injectPickerStyles();
	}, []);
	const pets = [...PET_IDS.map((id) => ({
		id,
		name: PET_META[id].name,
		tagline: PET_META[id].tagline,
		frames: PET_ART[id]
	})), ...customPets.map((c) => ({
		id: c.id,
		name: c.name,
		tagline: c.tagline.length > 0 ? c.tagline : "自定义伙伴",
		frames: framesFromRows(c.rows)
	}))];
	const handlePick = (id) => {
		if (picked) return;
		setPicked(id);
		setTimeout(() => onPick(id), 260);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dsh-pet-sprite-picker",
		role: "dialog",
		"aria-label": "选择伙伴形象",
		onClick: (e) => {
			if (e.target === e.currentTarget) onClose();
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-pet-sprite-picker-panel",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dsh-pet-sprite-picker-x",
					"aria-label": "关闭",
					onClick: onClose,
					children: "×"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-pet-sprite-picker-title",
					children: "选择你的伙伴"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-pet-sprite-picker-sub",
					children: "随时可以在照顾面板中更换形象"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-pet-sprite-picker-cards",
					children: pets.map((pet) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PetCard, {
						pet,
						custom: isCustomPetId(pet.id) ? customPets.find((c) => c.id === pet.id) : void 0,
						profile: profiles[pet.id],
						isCurrent: currentId === pet.id,
						state: picked === null ? "idle" : picked === pet.id ? "picked" : "dim",
						onPick: () => handlePick(pet.id)
					}, pet.id))
				})
			]
		})
	});
};

//#endregion
//#region src/client/ChatPet.tsx
const PET_ID_KEY = "dshPetSpriteGame:petId";
function loadPetId() {
	try {
		const v = localStorage.getItem(PET_ID_KEY);
		if (v === null) return null;
		return PET_IDS.includes(v) || isCustomPetId(v) ? v : null;
	} catch {
		return null;
	}
}
function savePetId(id) {
	try {
		localStorage.setItem(PET_ID_KEY, id);
	} catch {}
}
const CHAT_HISTORY_KEY = "dshPetSpriteChat:history";
const CHAT_MODEL_KEY = "dshPetSpriteChat:model";
function loadChatHistory() {
	try {
		const v = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? "[]");
		return Array.isArray(v) ? v.filter((t) => t && typeof t.text === "string") : [];
	} catch {
		return [];
	}
}
function saveChatHistory(history) {
	try {
		localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history.slice(-30)));
	} catch {}
}
function loadChatModel() {
	try {
		const v = JSON.parse(localStorage.getItem(CHAT_MODEL_KEY) ?? "null");
		return v && typeof v.provider === "string" && typeof v.model === "string" ? v : null;
	} catch {
		return null;
	}
}
function saveChatModel(model) {
	try {
		if (model === null) localStorage.removeItem(CHAT_MODEL_KEY);
		else localStorage.setItem(CHAT_MODEL_KEY, JSON.stringify(model));
	} catch {}
}
function resolvePet(id, customs) {
	if (PET_IDS.includes(id)) {
		const meta = PET_META[id];
		return {
			name: meta.name,
			tagline: meta.tagline,
			frames: PET_ART[id],
			idleLines: meta.idleLines
		};
	}
	const custom = customs.find((p) => p.id === id);
	if (custom === void 0) return null;
	return {
		name: custom.name,
		tagline: custom.tagline,
		frames: framesFromRows(custom.rows),
		idleLines: []
	};
}
let engineSingleton = null;
function getEngine() {
	if (!engineSingleton) engineSingleton = new MiniEngine();
	return engineSingleton;
}
let witnessBusWired = false;
function wireWitnessBus(engine) {
	if (witnessBusWired) return;
	witnessBusWired = true;
	engine.bus.on("level:up", () => recordLevelUp());
}
const CHAT_LINES = {
	idle: [
		"今天的代码顺利吗?",
		"站得有点久了……",
		"云看起来像棉花糖。",
		"悄悄说:我在攒星币。",
		"要不要休息一下?",
		"这边风景不错。"
	],
	ctl: [
		"交给我!",
		"看我的!",
		"出发!"
	],
	work: [
		"开工啦。",
		"让我盯着点……",
		"在忙,勿扰。"
	],
	done: [
		"呼——完成啦。",
		"又搞定一轮!",
		"辛苦辛苦。"
	],
	low: [
		"有点累了,想休息……",
		"心情不太好,陪我玩玩?",
		"能量快见底了……"
	],
	drag: [
		"放我下来!",
		"抓稳了……",
		"飞起来咯!"
	]
};
function pick(pool) {
	return pool[Math.floor(Math.random() * pool.length)];
}
let styleInjected = false;
function injectStyles() {
	if (styleInjected) return;
	styleInjected = true;
	const style = document.createElement("style");
	style.textContent = `
.dsh-pet-sprite-layer{position:fixed;inset:0;z-index:900;pointer-events:none}
.dsh-pet-sprite-unit{position:absolute;width:48px;height:56px;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 2px 0 rgba(0,0,0,.12));opacity:.97;user-select:none;-webkit-tap-highlight-color:transparent}
.dsh-pet-sprite-unit canvas{width:100%;height:100%;image-rendering:pixelated;display:block}
.dsh-pet-sprite-spark{position:absolute;z-index:6;width:6px;height:6px;background:#ffd33d;border:1px solid rgba(0,0,0,.25);pointer-events:none;animation:dshPetSpriteSpark .6s ease-out forwards}
@keyframes dshPetSpriteSpark{to{transform:translate(var(--dx),var(--dy));opacity:0}}
.dsh-pet-sprite-ctl{position:absolute;top:-30px;right:-8px;z-index:6;font:800 10.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.18);border-radius:999px;padding:3px 10px;color:#7b8190;pointer-events:none;box-shadow:0 2px 0 rgba(0,0,0,.12);white-space:nowrap;transition:opacity .55s}
.dsh-pet-sprite-bubble{position:absolute;bottom:calc(100% + 9px);left:50%;z-index:7;max-width:190px;background:#fff;border:2.5px solid #4a4553;border-radius:12px;padding:4px 11px;font:700 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#4a4553;white-space:nowrap;pointer-events:none;box-shadow:0 2.5px 0 rgba(0,0,0,.15);animation:dshPetSpriteBubbleIn .5s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-bubble::after{content:'';position:absolute;top:calc(100% - 6.5px);left:50%;width:11px;height:11px;background:#fff;border-right:2.5px solid #4a4553;border-bottom:2.5px solid #4a4553;transform:translateX(-50%) rotate(45deg)}
.dsh-pet-sprite-bubble-wrap{white-space:pre-wrap;word-break:break-word;max-width:230px;line-height:1.6;text-align:left}
@keyframes dshPetSpriteBubbleIn{from{opacity:0;transform:translateX(-50%) translateY(9px) scale(.55)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
.dsh-pet-sprite-unit{cursor:grab}
.dsh-pet-sprite-unit:active{cursor:grabbing}
.dsh-pet-sprite-unit.dsh-pet-sprite-dragging{filter:drop-shadow(0 7px 9px rgba(0,0,0,.24))}
.dsh-pet-sprite-dragging canvas{animation:dshPetSpriteHang .8s ease-in-out infinite alternate}
@keyframes dshPetSpriteHang{from{transform:rotate(-8deg) scale(1.1)}to{transform:rotate(8deg) scale(1.1)}}
.dsh-pet-sprite-status{position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);z-index:6;font:800 9.5px ui-monospace,Menlo,Consolas,monospace;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.14);border-radius:999px;padding:1px 8px;color:#7b8190;pointer-events:none;white-space:nowrap;box-shadow:0 2px 0 rgba(0,0,0,.10)}
.dsh-pet-sprite-egg{position:absolute;left:58px;bottom:14px;width:40px;height:47px;pointer-events:auto;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 2.5px 0 rgba(0,0,0,.13));animation:dshPetSpriteEggIn .6s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-egg canvas{width:100%;height:100%;image-rendering:pixelated;display:block;animation:dshPetSpriteEggWobble 4.8s ease-in-out infinite;transform-origin:50% 92%}
@keyframes dshPetSpriteEggIn{from{opacity:0;transform:translateY(18px) scale(.5)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dshPetSpriteEggWobble{0%,66%,100%{transform:rotate(0)}70%{transform:rotate(-7deg)}74%{transform:rotate(6deg)}78%{transform:rotate(-4deg)}82%{transform:rotate(1.5deg)}86%{transform:rotate(0)}89%{transform:rotate(0) translateY(-2px)}91%{transform:rotate(0) translateY(0)}}
.dsh-pet-sprite-egg:hover{filter:drop-shadow(0 5px 7px rgba(0,0,0,.2))}
.dsh-pet-sprite-egg:hover canvas{animation:none;transform:rotate(-6deg) scale(1.08)}
.dsh-pet-sprite-egg:active canvas{transform:rotate(-9deg) scale(.96)}
.dsh-pet-sprite-egg-hint{position:absolute;bottom:calc(100% + 9px);left:50%;transform:translateX(-50%);background:#fff;border:2.5px solid #4a4553;border-radius:12px;padding:3px 11px;font:700 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#4a4553;white-space:nowrap;pointer-events:none;box-shadow:0 2.5px 0 rgba(0,0,0,.15);animation:dshPetSpriteEggHint .5s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-egg-hint::after{content:'';position:absolute;top:calc(100% - 6.5px);left:50%;width:11px;height:11px;background:#fff;border-right:2.5px solid #4a4553;border-bottom:2.5px solid #4a4553;transform:translateX(-50%) rotate(45deg)}
@keyframes dshPetSpriteEggHint{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.55)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-plus{animation-duration:.4s}.dsh-pet-sprite-egg{animation-duration:.01s}.dsh-pet-sprite-egg canvas{animation:none}.dsh-pet-sprite-egg-hint{animation-duration:.01s}}
`;
	document.head.appendChild(style);
}
const ChatPet = () => {
	const layerRef = (0, react.useRef)(null);
	const unitRef = (0, react.useRef)(null);
	const canvasRef = (0, react.useRef)(null);
	const eggCanvasRef = (0, react.useRef)(null);
	const eggRef = (0, react.useRef)(null);
	const ctlRef = (0, react.useRef)(null);
	const statusRef = (0, react.useRef)(null);
	const sayRef = (0, react.useRef)(() => {});
	const [petId, setPetId] = (0, react.useState)(() => loadPetId());
	const [customPets, setCustomPets] = (0, react.useState)(() => loadCustomPets());
	const [pickerOpen, setPickerOpen] = (0, react.useState)(false);
	const [panelOpen, setPanelOpen] = (0, react.useState)(false);
	const [anchor, setAnchor] = (0, react.useState)({
		x: 0,
		y: 0
	});
	const [eggHint, setEggHint] = (0, react.useState)(false);
	const [chatOpen, setChatOpen] = (0, react.useState)(false);
	const [chatHistory, setChatHistory] = (0, react.useState)(() => loadChatHistory());
	const [chatBusy, setChatBusy] = (0, react.useState)(false);
	const [chatError, setChatError] = (0, react.useState)(null);
	const [chatModel, setChatModel] = (0, react.useState)(() => loadChatModel());
	const [profiles, setProfiles] = (0, react.useState)(() => loadProfiles());
	const engine = getEngine();
	wireWitnessBus(engine);
	const activePet = petId === null ? null : resolvePet(petId, customPets);
	const activeProfile = (petId !== null ? profiles[petId] : void 0) ?? EMPTY_PROFILE;
	const profileRef = (0, react.useRef)(EMPTY_PROFILE);
	profileRef.current = activeProfile;
	const handlePick = (id) => {
		savePetId(id);
		setPickerOpen(false);
		setPetId(id);
	};
	const openPicker = () => {
		setPanelOpen(false);
		setPickerOpen(true);
	};
	(0, react.useEffect)(() => {
		injectStyles();
	}, []);
	const handleChatSend = async (text) => {
		if (activePet === null || chatBusy) return;
		setChatError(null);
		setChatHistory((prev) => {
			const next = [...prev, {
				role: "user",
				text
			}];
			saveChatHistory(next);
			return next;
		});
		if (chatModel === null) {
			setChatError("还没有选择聊天模型：在照顾面板 → 设置 里选一个再试。");
			return;
		}
		setChatBusy(true);
		sayRef.current("让我想想……");
		try {
			const history = [...chatHistory, {
				role: "user",
				text
			}].map((t) => ({
				role: t.role === "user" ? "user" : "assistant",
				content: t.text
			}));
			const res = await fetch("/plugins/dsh-pet-sprite/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					petName: activePet.name,
					message: text,
					history: history.slice(0, -1),
					provider: chatModel.provider,
					model: chatModel.model,
					lang: navigator.language,
					persona: activeProfile.persona
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			const reply = data.reply ?? "";
			setChatHistory((prev) => {
				const next = [...prev, {
					role: "pet",
					text: reply
				}];
				saveChatHistory(next);
				return next;
			});
			sayRef.current(reply.length > 150 ? `${reply.slice(0, 150)}…` : reply, true);
		} catch (error) {
			setChatError(error instanceof Error ? error.message : String(error));
			sayRef.current("呜……卡住了。");
		} finally {
			setChatBusy(false);
		}
	};
	const generateInFlightRef = (0, react.useRef)(false);
	const handleGeneratePet = async (description) => {
		if (generateInFlightRef.current) return {
			ok: false,
			error: "正在生成中，稍等一下。"
		};
		if (chatModel === null) return {
			ok: false,
			error: "还没有选择模型：先在上方「聊天模型」里选一个。"
		};
		const GENERATE_COST = 100;
		const wallet = engine.shop.getWallet();
		if (wallet.coins < GENERATE_COST) return {
			ok: false,
			error: `星币不够：需要 ${GENERATE_COST}，当前只有 ${wallet.coins}。`
		};
		generateInFlightRef.current = true;
		try {
			const res = await fetch("/plugins/dsh-pet-sprite/generate", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					description,
					provider: chatModel.provider,
					model: chatModel.model,
					lang: navigator.language
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			if (!Array.isArray(data.rows)) throw new Error("生成结果无效：模型没有返回像素网格。");
			const spend = engine.shop.spendCoins(GENERATE_COST, "pet_generation");
			if (!spend.ok) return {
				ok: false,
				error: "星币不够。"
			};
			const pet = {
				id: `custom:${Date.now().toString(36)}`,
				name: (data.name ?? "").trim() || "小家伙",
				tagline: (data.tagline ?? "").trim(),
				rows: data.rows,
				createdAt: Date.now()
			};
			if (!saveCustomPet(pet)) {
				engine.shop.earnCoins(GENERATE_COST, "pet_generation_refund");
				return {
					ok: false,
					error: "保存失败：浏览器本地存储不可用。"
				};
			}
			if (pet.tagline.length > 0) {
				const seed = {
					persona: pet.tagline,
					lines: {}
				};
				saveProfile(pet.id, seed);
				setProfiles((prev) => ({
					...prev,
					[pet.id]: seed
				}));
			}
			setCustomPets(loadCustomPets());
			savePetId(pet.id);
			setPetId(pet.id);
			setTimeout(() => {
				sayRef.current(`我是 ${pet.name}！`);
			}, 350);
			return {
				ok: true,
				name: pet.name
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			generateInFlightRef.current = false;
		}
	};
	const handleProfileChange = (patch) => {
		if (petId === null) return;
		const next = {
			persona: patch.persona !== void 0 ? patch.persona : activeProfile.persona,
			lines: patch.lines !== void 0 ? patch.lines : activeProfile.lines
		};
		saveProfile(petId, next);
		setProfiles((prev) => ({
			...prev,
			[petId]: next
		}));
	};
	const handleImportPet = (text) => {
		const r = importFromText(text);
		if ("error" in r) return {
			ok: false,
			error: r.error
		};
		if (!saveCustomPet(r.pet)) return {
			ok: false,
			error: "保存失败：浏览器本地存储不可用。"
		};
		saveProfile(r.pet.id, r.profile);
		setProfiles((prev) => ({
			...prev,
			[r.pet.id]: r.profile
		}));
		setCustomPets(loadCustomPets());
		savePetId(r.pet.id);
		setPetId(r.pet.id);
		return {
			ok: true,
			name: r.pet.name
		};
	};
	(0, react.useEffect)(() => {
		if (petId || pickerOpen) return;
		const cv = eggCanvasRef.current;
		if (cv) drawPet(cv, EGG_ROWS);
	}, [petId, pickerOpen]);
	(0, react.useEffect)(() => {
		if (petId || pickerOpen) return;
		const egg = eggRef.current;
		if (!egg) return;
		const place = () => {
			let best = null;
			for (const b of document.querySelectorAll("button[aria-haspopup=\"dialog\"]")) {
				const r = b.getBoundingClientRect();
				if (r.width === 0 || r.bottom < window.innerHeight * .6 || r.left > window.innerWidth * .35) continue;
				if (!best || r.bottom > best.bottom || r.bottom === best.bottom && r.left < best.left) best = r;
			}
			if (best) {
				egg.style.left = `${Math.round(best.right + 10)}px`;
				egg.style.bottom = `${Math.round(window.innerHeight - best.bottom)}px`;
			} else {
				egg.style.left = "58px";
				egg.style.bottom = "14px";
			}
		};
		place();
		const iv = setInterval(place, 1500);
		window.addEventListener("resize", place);
		return () => {
			clearInterval(iv);
			window.removeEventListener("resize", place);
		};
	}, [petId, pickerOpen]);
	(0, react.useEffect)(() => {
		if (petId) return;
		const t1 = setTimeout(() => setEggHint(true), 4500);
		const t2 = setTimeout(() => setEggHint(false), 11e3);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, [petId]);
	(0, react.useEffect)(() => {
		if (activePet === null) return;
		const art = activePet.frames;
		const idleLines = activePet.idleLines;
		const line = (key) => pick(profileRef.current.lines[key] ?? CHAT_LINES[key]);
		const ambientIdle = () => [
			...CHAT_LINES.idle,
			...idleLines,
			...profileRef.current.lines.idle ?? []
		];
		injectStyles();
		const layer = layerRef.current;
		const unit = unitRef.current;
		const cv = canvasRef.current;
		const ctlHint = ctlRef.current;
		const statusBar = statusRef.current;
		if (!layer || !unit || !cv) return;
		engine.start();
		engine.onLogin();
		const statusTimer = setInterval(() => {
			const s = engine.getStats();
			if (statusBar) statusBar.textContent = `Lv.${s.level} ${s.title} · 🪙${s.coins}`;
		}, 2500);
		{
			const s = engine.getStats();
			if (statusBar) statusBar.textContent = `Lv.${s.level} ${s.title} · 🪙${s.coins}`;
		}
		let lastUserCount = document.querySelectorAll("[data-chat-flow-kind=\"user\"]").length;
		let wasStreaming = !!document.querySelector("[data-streaming]");
		function bridgeChat() {
			const users = document.querySelectorAll("[data-chat-flow-kind=\"user\"]");
			if (users.length > lastUserCount) {
				const last = users[users.length - 1];
				const text = last.textContent ?? "";
				engine.onUserMessage(text);
				recordTurn(text.length);
			}
			lastUserCount = users.length;
			const streaming = !!document.querySelector("[data-streaming]");
			if (!wasStreaming && streaming && users.length > 0) say(line("work"));
			if (wasStreaming && !streaming) {
				const nodes = document.querySelectorAll("[data-chat-flow-key]");
				const lastNode = nodes[nodes.length - 1];
				const outLen = lastNode?.textContent?.length ?? 0;
				engine.onAssistantDone(outLen);
				recordTask(outLen);
				if (users.length > 0) say(line("done"));
			}
			wasStreaming = streaming;
		}
		const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		const G = 1500, WALK = 58, CLIMBV = 85, SKILLV = 780, JUMPV = 420, PW = 48;
		let x = 16, h = 0, vy = 0, dir = 1;
		let state = "ground";
		let plat = null;
		let goal = null;
		let climb = null;
		let ft = 0, ftAcc = 0, lastFrame = null, lastT = 0, planAt = 0;
		let plats = [], platsAt = 0;
		let mode = "idle";
		let floorX = 0, floorY = 0, visible = false;
		const keys = {};
		let playerCtl = false, lastKeyAt = 0, airJumped = false, dropP = null, moving = false;
		let bubbleEl = null;
		let bubbleTimer;
		let nextChatAt = 0;
		let dragging = false, dragMoved = false, dragId = -1;
		let dragX = 0, dragY = 0;
		function playground() {
			const el = document.querySelector("[data-conversation-scroll]");
			const r = el?.getBoundingClientRect();
			if (!r || r.height < 200 || r.width < 240) return null;
			return r;
		}
		function scanPlats() {
			const fr = playground();
			if (!fr) {
				plats = [];
				return;
			}
			const out = [];
			const els = document.querySelectorAll("[data-chat-flow-key]");
			for (let i = Math.max(0, els.length - 30); i < els.length; i++) {
				const r = els[i].getBoundingClientRect();
				if (r.width < 70 || r.bottom < 20 || r.top <= 0 || r.top >= fr.bottom - 24) continue;
				out.push({
					x1: r.left - fr.left,
					x2: r.right - fr.left,
					y: fr.bottom - 4 - r.top
				});
			}
			const comp = document.querySelector("[data-composer-card]");
			if (comp) {
				const r = comp.getBoundingClientRect();
				if (r.width >= 100 && r.top > 20) out.push({
					x1: r.left - fr.left,
					x2: r.right - fr.left,
					y: fr.bottom - 4 - r.top
				});
			}
			plats = out;
		}
		function support() {
			if (!plat) return true;
			for (const p of plats) if (Math.abs(p.y - h) < 26 && x + PW / 2 > p.x1 - 4 && x + PW / 2 < p.x2 + 4) {
				plat = p;
				h = p.y;
				return true;
			}
			return false;
		}
		function jumpTo(p) {
			const need = Math.sqrt(2 * G * Math.max(20, p.y - h + 16));
			if (need > SKILLV) return false;
			vy = need;
			state = "air";
			climb = null;
			if (need > JUMPV + 60) burst();
			return true;
		}
		function startClimb(p) {
			const edge = Math.abs(x - p.x1) < Math.abs(x - p.x2) ? p.x1 - 12 : p.x2 - PW + 12;
			climb = {
				x: edge,
				top: p.y,
				p
			};
			goal = { x: edge };
		}
		function plan(now) {
			planAt = now + 1200 + Math.random() * 1800;
			const ups = plats.filter((p) => p.y > h + 30 && p.y < h + 560);
			const r = Math.random();
			if (r < .34 || ups.length === 0) {
				goal = { x: 12 + Math.random() * Math.max(20, floorX - 76) };
				return;
			}
			const c = ups[Math.floor(Math.random() * ups.length)];
			if (c.y - h <= 200) goal = {
				x: Math.max(c.x1, Math.min(c.x2 - PW, x)),
				jump: c
			};
			else if (r < .8) startClimb(c);
			else if (h > 0 && plat) goal = { x: Math.random() < .5 ? plat.x1 - 40 : plat.x2 + 8 };
		}
		function burst() {
			if (still) return;
			for (let i = 0; i < 6; i++) {
				const s = document.createElement("span");
				s.className = "dsh-pet-sprite-spark";
				s.style.left = `${18 + Math.random() * 16}px`;
				s.style.top = `${-10 - h}px`;
				s.style.setProperty("--dx", `${Math.random() * 44 - 22}px`);
				s.style.setProperty("--dy", `${-14 - Math.random() * 30}px`);
				unit.appendChild(s);
				setTimeout(() => s.remove(), 650);
			}
		}
		function say(text, wrap = false) {
			if (bubbleEl) {
				bubbleEl.remove();
				clearTimeout(bubbleTimer);
			}
			const el = document.createElement("div");
			el.className = wrap ? "dsh-pet-sprite-bubble dsh-pet-sprite-bubble-wrap" : "dsh-pet-sprite-bubble";
			el.textContent = text;
			unit.appendChild(el);
			bubbleEl = el;
			const dur = Math.max(2400, 1300 + text.length * 200);
			bubbleTimer = setTimeout(() => {
				el.remove();
				if (bubbleEl === el) bubbleEl = null;
			}, dur);
		}
		sayRef.current = say;
		function typingField() {
			const a = document.activeElement;
			if (!a) return false;
			return !!(a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
		}
		let ctlFadeTimer;
		function showCtlHint() {
			if (!ctlHint) return;
			ctlHint.style.display = "";
			ctlHint.style.opacity = "1";
			clearTimeout(ctlFadeTimer);
			ctlFadeTimer = setTimeout(() => {
				if (ctlHint) ctlHint.style.opacity = "0";
			}, 3500);
		}
		function setCtl(on) {
			if (playerCtl === on) return;
			playerCtl = on;
			if (on) {
				if (ctlHint) ctlHint.textContent = "操控中：A/D 移动 · 空格 跳跃 · W 攀爬 · S 下落";
				showCtlHint();
				if (Math.random() < .6) say(pick(CHAT_LINES.ctl));
			} else {
				clearTimeout(ctlFadeTimer);
				if (ctlHint) ctlHint.style.display = "none";
				for (const k in keys) keys[k] = false;
				planAt = lastT + 1500;
			}
		}
		function tryClimbNear() {
			for (const p of plats) {
				if (p.y < h + 30) continue;
				const le = p.x1 - 12, re = p.x2 - PW + 12;
				if (Math.abs(x - le) < 30) {
					climb = {
						x: le,
						top: p.y,
						p
					};
					state = "climb";
					return true;
				}
				if (Math.abs(x - re) < 30) {
					climb = {
						x: re,
						top: p.y,
						p
					};
					state = "climb";
					return true;
				}
			}
			return false;
		}
		function frameFor() {
			if (dragging) return art.JP;
			if (state === "air") return art.JP;
			if (state === "climb") return ft % 2 ? art.KA : art.KB;
			if (moving || goal && Math.abs(goal.x - x) > 3) return ft % 4 < 2 ? art.KA : art.KB;
			if (mode === "work") return ft % 6 < 3 ? art.WA : art.WB;
			if (ft % 50 === 9) return art.BL;
			if (ft % 140 >= 124) return ft % 10 < 5 ? art.ZZ : art.B;
			return ft % 10 < 5 ? art.I : art.B;
		}
		let raf = 0;
		function tick(now) {
			raf = requestAnimationFrame(tick);
			const fr = playground();
			visible = fr !== null;
			if (!visible) {
				layer.style.display = "none";
				lastT = now;
				return;
			}
			layer.style.display = "";
			const dt = Math.min(.05, (now - lastT) / 1e3 || 0);
			lastT = now;
			ftAcc += dt;
			if (ftAcc >= .16) {
				ftAcc = 0;
				ft++;
			}
			floorX = fr.width;
			floorY = fr.bottom - 4;
			if (now > platsAt) {
				scanPlats();
				platsAt = now + 150;
				mode = document.querySelector("[data-streaming]") ? "work" : "idle";
				bridgeChat();
				if (state === "ground" && h > 0 && !support()) {
					state = "air";
					vy = 0;
					plat = null;
				}
				if (!playerCtl && !dragging && mode === "idle" && state === "ground") {
					if (nextChatAt === 0) nextChatAt = now + 15e3 + Math.random() * 15e3;
					else if (now > nextChatAt) {
						const s = engine.getStats();
						say(s.power < 30 || s.mood < 30 ? line("low") : pick(ambientIdle()));
						nextChatAt = now + 24e3 + Math.random() * 2e4;
					}
				}
			}
			if (playerCtl && now - lastKeyAt > 1e4) setCtl(false);
			moving = false;
			if (dragging) {
				goal = null;
				climb = null;
				vy = 0;
				x = Math.max(2, Math.min(floorX - 52, dragX - fr.left - PW / 2));
				h = Math.max(0, floorY - dragY);
			} else if (playerCtl) {
				goal = null;
				if (keys.a) {
					x -= WALK * 1.7 * dt;
					dir = -1;
					moving = true;
				}
				if (keys.d) {
					x += WALK * 1.7 * dt;
					dir = 1;
					moving = true;
				}
				if (moving && state === "climb") {
					state = "air";
					vy = 0;
					climb = null;
				}
			} else if (mode !== "idle") {
				goal = null;
				climb = null;
				if (state === "climb") state = "air";
			}
			if (!dragging) {
				if (state === "climb" && climb) {
					dir = climb.x > x ? 1 : climb.x < x ? -1 : dir;
					if (Math.abs(climb.x - x) > 3) x += WALK * dt * (climb.x > x ? 1 : -1);
					else {
						h += CLIMBV * dt;
						if (h >= climb.top) {
							h = climb.top;
							plat = climb.p;
							x = Math.max(climb.p.x1 + 2, Math.min(climb.p.x2 - PW - 2, x));
							state = "ground";
							climb = null;
							goal = null;
						}
					}
				} else if (state === "air") {
					h += vy * dt;
					const pv = vy;
					vy -= G * dt;
					if (vy < 0) for (const p of plats) {
						if (dropP && Math.abs(p.y - dropP.y) < 8) continue;
						if (h <= p.y && h + ((pv > 0 ? pv : 0) - vy) * dt + 30 >= p.y && x + PW / 2 > p.x1 - 4 && x + PW / 2 < p.x2 + 4 && p.y > 2) {
							h = p.y;
							vy = 0;
							state = "ground";
							plat = p;
							goal = null;
							dropP = null;
							airJumped = false;
							break;
						}
					}
					if (h <= 0) {
						h = 0;
						vy = 0;
						state = "ground";
						plat = null;
						dropP = null;
						airJumped = false;
					}
				} else if (goal) {
					dir = goal.x > x + 2 ? 1 : goal.x < x - 2 ? -1 : dir;
					if (Math.abs(goal.x - x) > 3) x += WALK * dt * dir;
					else if (goal.jump) {
						const j = goal.jump;
						goal = null;
						jumpTo(j);
					} else goal = null;
				} else if (!playerCtl && mode === "idle" && state === "ground" && now > planAt) plan(now);
				if (!playerCtl && state === "ground" && mode !== "idle" && h > 0) {
					state = "air";
					vy = 0;
				}
			}
			const mx = floorX - 52;
			if (x < 2) x = 2;
			if (x > mx) x = mx;
			unit.style.left = `${Math.round(fr.left + x)}px`;
			unit.style.top = `${Math.round(floorY - 56 - h)}px`;
			cv.style.transform = (dir < 0 ? "scaleX(-1)" : "") + (state === "climb" ? ` rotate(${dir < 0 ? -8 : 8}deg)` : "");
			const f = frameFor();
			if (f !== lastFrame) {
				lastFrame = f;
				drawPet(cv, f);
			}
		}
		const onPointerDown = (e) => {
			const t = e.target;
			if (!t || typeof t.closest !== "function") return;
			if (!document.querySelector("[data-conversation-scroll]")) {
				setCtl(false);
				return;
			}
			if (!t.closest("[data-conversation-scroll]")) {
				setCtl(false);
				return;
			}
			if (t.closest(".dsh-pet-sprite-unit,a,button,input,textarea,select,label,[role=\"button\"],[contenteditable]")) return;
			setCtl(true);
			lastKeyAt = performance.now();
			const ae = document.activeElement;
			if (ae && ae !== document.body && ae.blur) ae.blur();
		};
		const onKeyDown = (e) => {
			if (!playerCtl || typingField() || still) return;
			const k = e.key === " " ? "sp" : String(e.key || "").toLowerCase();
			if (k !== "a" && k !== "d" && k !== "w" && k !== "s" && k !== "sp") return;
			e.preventDefault();
			e.stopImmediatePropagation();
			lastKeyAt = performance.now();
			if (!e.repeat) showCtlHint();
			if (k === "sp" && !keys.sp) {
				if (state === "ground") {
					vy = JUMPV;
					state = "air";
					airJumped = false;
					goal = null;
					climb = null;
				} else if (state === "air" && !airJumped) {
					airJumped = true;
					vy = Math.max(vy, SKILLV * .85);
					burst();
				} else if (state === "climb") {
					state = "air";
					vy = JUMPV * .8;
					climb = null;
				}
			}
			if (k === "w" && state !== "climb" && state === "ground") tryClimbNear();
			if (k === "s" && state === "ground" && plat) {
				dropP = plat;
				plat = null;
				state = "air";
				vy = 0;
				h -= 2;
			}
			keys[k] = true;
		};
		const onKeyUp = (e) => {
			const k = e.key === " " ? "sp" : String(e.key || "").toLowerCase();
			if (keys[k]) keys[k] = false;
		};
		const onBlur = () => {
			for (const k in keys) keys[k] = false;
		};
		const onUnitPointerDown = (e) => {
			if (e.button !== 0) return;
			dragMoved = false;
			dragId = e.pointerId;
			dragX = e.clientX;
			dragY = e.clientY;
			try {
				unit.setPointerCapture(dragId);
			} catch {}
		};
		const onUnitPointerMove = (e) => {
			if (e.pointerId !== dragId) return;
			if (!dragMoved) {
				const dx = e.clientX - dragX, dy = e.clientY - dragY;
				if (Math.hypot(dx, dy) < 6) return;
				dragMoved = true;
				dragging = true;
				unit.classList.add("dsh-pet-sprite-dragging");
				if (Math.random() < .5) say(pick(CHAT_LINES.drag));
			}
			dragX = e.clientX;
			dragY = e.clientY;
		};
		const onUnitPointerUp = (e) => {
			if (e.pointerId !== dragId) return;
			dragId = -1;
			try {
				unit.releasePointerCapture(e.pointerId);
			} catch {}
			if (dragging) {
				dragging = false;
				unit.classList.remove("dsh-pet-sprite-dragging");
				state = "air";
				vy = 0;
				plat = null;
				climb = null;
				goal = null;
				dropP = null;
				airJumped = false;
			}
		};
		const onClickPet = () => {
			if (dragMoved) {
				dragMoved = false;
				return;
			}
			const r = unit.getBoundingClientRect();
			setAnchor({
				x: r.left,
				y: r.top + r.height
			});
			setChatOpen(true);
		};
		const onContextMenu = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const r = unit.getBoundingClientRect();
			setAnchor({
				x: r.left,
				y: r.bottom
			});
			setPanelOpen(true);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("keyup", onKeyUp, true);
		window.addEventListener("blur", onBlur);
		unit.addEventListener("click", onClickPet);
		unit.addEventListener("contextmenu", onContextMenu);
		unit.addEventListener("pointerdown", onUnitPointerDown);
		unit.addEventListener("pointermove", onUnitPointerMove);
		unit.addEventListener("pointerup", onUnitPointerUp);
		unit.addEventListener("pointercancel", onUnitPointerUp);
		if (ctlHint) ctlHint.style.display = "none";
		drawPet(cv, art.I);
		if (!still) requestAnimationFrame((t) => {
			lastT = t;
			requestAnimationFrame(tick);
		});
		else {
			const slow = setInterval(() => {
				ft++;
				const f = frameFor();
				if (f !== lastFrame) {
					lastFrame = f;
					drawPet(cv, f);
				}
			}, 320);
			return () => {
				clearInterval(slow);
				clearInterval(statusTimer);
				clearTimeout(ctlFadeTimer);
				clearTimeout(bubbleTimer);
				bubbleEl?.remove();
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("keyup", onKeyUp, true);
				window.removeEventListener("blur", onBlur);
				unit.removeEventListener("click", onClickPet);
				unit.removeEventListener("contextmenu", onContextMenu);
				unit.removeEventListener("pointerdown", onUnitPointerDown);
				unit.removeEventListener("pointermove", onUnitPointerMove);
				unit.removeEventListener("pointerup", onUnitPointerUp);
				unit.removeEventListener("pointercancel", onUnitPointerUp);
			};
		}
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(ctlFadeTimer);
			clearTimeout(bubbleTimer);
			bubbleEl?.remove();
			clearInterval(statusTimer);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("keyup", onKeyUp, true);
			window.removeEventListener("blur", onBlur);
			unit.removeEventListener("click", onClickPet);
			unit.removeEventListener("contextmenu", onContextMenu);
			unit.removeEventListener("pointerdown", onUnitPointerDown);
			unit.removeEventListener("pointermove", onUnitPointerMove);
			unit.removeEventListener("pointerup", onUnitPointerUp);
			unit.removeEventListener("pointercancel", onUnitPointerUp);
		};
	}, [petId]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: layerRef,
		className: "dsh-pet-sprite-layer",
		children: [
			activePet !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: unitRef,
				className: "dsh-pet-sprite-unit",
				title: `${activePet.name}（左键聊天 · 右键照顾面板）`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: ctlRef,
						className: "dsh-pet-sprite-ctl"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
						ref: canvasRef,
						width: 96,
						height: 112
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: statusRef,
						className: "dsh-pet-sprite-status"
					})
				]
			}),
			activePet === null && !pickerOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: eggRef,
				className: "dsh-pet-sprite-egg",
				title: "点一点，看看谁在里面",
				onClick: () => setPickerOpen(true),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
					ref: eggCanvasRef,
					width: 96,
					height: 112
				}), eggHint && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh-pet-sprite-egg-hint",
					children: "咔……咔？"
				})]
			}),
			activePet !== null && panelOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CarePanel, {
				engine,
				anchor,
				petName: activePet.name,
				chatModel,
				profile: activeProfile,
				onProfileChange: handleProfileChange,
				onGeneratePet: handleGeneratePet,
				onImportPet: handleImportPet,
				onPetSay: (text) => sayRef.current(text, true),
				onSwitchPet: openPicker,
				onChatModelChange: (m) => {
					setChatModel(m);
					saveChatModel(m);
				},
				onClose: () => setPanelOpen(false)
			}),
			activePet !== null && chatOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PetChatBox, {
				petName: activePet.name,
				anchor,
				model: chatModel,
				history: chatHistory,
				busy: chatBusy,
				error: chatError,
				onSend: (text) => {
					handleChatSend(text);
				},
				onClear: () => {
					setChatHistory([]);
					saveChatHistory([]);
				},
				onClose: () => setChatOpen(false)
			}),
			pickerOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PetPicker, {
				currentId: petId,
				customPets,
				profiles,
				onPick: handlePick,
				onClose: () => setPickerOpen(false)
			})
		]
	});
};

//#endregion
//#region src/client/index.ts
const name = "dsh-pet-sprite";
const inject = ["slots"];
function apply(ctx) {
	const slots = ctx.slots;
	if (slots === void 0) return;
	slots.inject("shell.overlay", () => {
		return slots.register({
			name: "shell.overlay",
			id: "dsh-pet-sprite",
			registrant: "dsh-pet-sprite"
		}, ChatPet);
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map