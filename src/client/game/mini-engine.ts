// Mini Character Engine — browser composition of PetClaw's gameplay systems.
// Wires: EventBus + AttributeEngine + LevelSystem + InventorySystem +
// ShopSystem + CareSystem + RewardEngine on a localStorage store.
// DSH chat events are bridged in from ChatPet (see bridge section at bottom).

import { EventBus } from './event-bus.ts'
import { AttributeEngine } from './attribute-engine.ts'
import { LevelSystem } from './level-system.ts'
import { InventorySystem } from './inventory-system.ts'
import { ShopSystem } from './shop-system.ts'
import { CareSystem } from './care-system.ts'
import { RewardEngine } from './reward-engine.ts'
import { DEFAULT_ATTRIBUTES } from './presets.ts'
import { createLocalStore } from './local-store.ts'

const TICK_MS = 10_000

export interface PokeStats {
  mood: number; moodLevel: string
  power: number; powerLevel: string
  health: number; healthLevel: string
  level: number; exp: number; title: string
  coins: number
}

export class MiniEngine {
  readonly bus = new EventBus()
  readonly attributes: AttributeEngine
  readonly levels: LevelSystem
  readonly inventory: InventorySystem
  readonly shop: ShopSystem
  readonly care: CareSystem
  readonly reward: RewardEngine

  private _timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    const store = createLocalStore()
    this.attributes = new AttributeEngine(this.bus, store)
    for (const def of DEFAULT_ATTRIBUTES) {
      this.attributes.register(def)
    }
    this.levels = new LevelSystem(this.bus, store)
    this.inventory = new InventorySystem(this.bus, store)
    this.shop = new ShopSystem(this.bus, store, this.inventory, this.levels)
    this.care = new CareSystem(this.bus, this.attributes, this.inventory, this.levels)
    this.reward = new RewardEngine(this.bus, store, {
      earnCoins: (n: number, src: string) => this.shop.earnCoins(n, src),
      gainExp: (n: number, src: string) => this.levels.gainExp(n, src),
    })

    // Higher tiers slow attribute decay (same rule as PetClaw character-engine)
    this.bus.on('level:up', ({ level }) => {
      const tier = this.levels.getTier()
      console.log(`[PetGame] level up -> ${level} (${tier.title})`)
      this.attributes.setDecayMultiplier(tier.decayMultiplier)
    })
    this.attributes.setDecayMultiplier(this.levels.getTier().decayMultiplier)
  }

  start(): void {
    if (this._timer) return
    this._timer = setInterval(() => {
      this.attributes.tick(TICK_MS)
    }, TICK_MS)
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  }

  getStats(): PokeStats {
    const info = this.levels.getInfo()
    return {
      mood: Math.round(this.attributes.getValue('mood')),
      moodLevel: this.attributes.getLevel('mood'),
      power: Math.round(this.attributes.getValue('power')),
      powerLevel: this.attributes.getLevel('power'),
      health: Math.round(this.attributes.getValue('health')),
      healthLevel: this.attributes.getLevel('health'),
      level: info.level,
      exp: info.exp,
      title: info.title,
      coins: this.shop.getWallet().coins,
    }
  }

  // ─── DSH bridges ─────────────────────────────────────────────

  /** Called once per plugin mount: daily login streak reward */
  onLogin(): void {
    const today = new Date().toISOString().slice(0, 10)
    const last = localStorage.getItem('dshPetGame:lastLogin')
    if (last === today) return
    localStorage.setItem('dshPetGame:lastLogin', today)
    const prev = last ? new Date(last) : null
    const days = prev ? Math.floor((Date.now() - prev.getTime()) / 86_400_000) : 999
    this.bus.emit('login:streak', { streak: 1, date: today })
    if (days >= 2 && prev) {
      this.bus.emit('login:comeback', { daysSinceLastLogin: days, previousDate: last })
    }
  }

  /** User sent a message: drain power by estimated input tokens (×0.5) */
  onUserMessage(text: string): void {
    const estTokens = Math.max(1, Math.round(text.length / 4))
    this.attributes.adjust('power', -Math.round(estTokens * 0.5))
  }

  /** Assistant turn finished: output tokens convert 1:1 to EXP */
  onAssistantDone(textLen: number): void {
    const exp = Math.max(1, Math.round(textLen / 4))
    this.levels.gainExp(exp, 'dsh-assistant')
  }
}
