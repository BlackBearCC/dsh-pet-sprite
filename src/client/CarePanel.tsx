// Care panel for Pet — the pet-raising UI migrated from PetClaw's care chapter.
// Right-click the pet to open near the character. Tabbed layout:
// status+interactions / inventory / shop. Fixed light palette so it reads
// the same under any DSH theme.

import { useCallback, useEffect, useState, type FC } from 'react'
import type { MiniEngine } from './game/mini-engine.ts'

interface Props {
  engine: MiniEngine
  anchor: { x: number; y: number } // pet screen position (panel opens beside it)
  onClose: () => void
}

const LEVEL_COLORS: Record<string, string> = {
  sad: '#ef4444', starving: '#ef4444', sick: '#ef4444',
  hungry: '#f59e0b', subhealthy: '#f59e0b', normal: '#3b82f6',
  healthy: '#22c55e', happy: '#22c55e', full: '#22c55e', joyful: '#a855f7',
}
const LEVEL_NAMES: Record<string, string> = {
  sad: '低落', starving: '耗尽', sick: '生病', hungry: '饥饿', subhealthy: '亚健康',
  normal: '正常', healthy: '健康', happy: '开心', full: '满格', joyful: '亢奋',
}
const CAT_NAMES: Record<string, string> = {
  food: '食物', toy: '玩具', medicine: '药品', special: '特殊', collection: '收藏',
}

function barColor(level: string): string {
  return LEVEL_COLORS[level] ?? '#3b82f6'
}

let panelStyleInjected = false
function injectPanelStyles(): void {
  if (panelStyleInjected) return
  panelStyleInjected = true
  const s = document.createElement('style')
  s.textContent = `
.dsh-pet-panel{position:fixed;z-index:950;width:260px;max-height:min(60vh,460px);display:flex;flex-direction:column;background:#ffffff;border:2px solid #2a2f3e;border-radius:12px;box-shadow:0 5px 0 rgba(0,0,0,.16),0 14px 32px rgba(0,0,0,.18);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1f2430;pointer-events:auto}
.dsh-pet-panel-hd{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:2px solid #2a2f3e;font-size:12px;font-weight:800;color:#1f2430}
.dsh-pet-panel-hd .sub{font-weight:600;font-size:10.5px;color:#6b7280}
.dsh-pet-panel-hd .coins{margin-left:auto;font-weight:800;font-size:11px;color:#b8860b;white-space:nowrap}
.dsh-pet-panel-x{border:none;background:transparent;font-size:13px;cursor:pointer;color:#6b7280;padding:2px 5px;border-radius:6px;line-height:1}
.dsh-pet-panel-x:hover{background:#eef0f4;color:#1f2430}
.dsh-pet-tabs{display:flex;border-bottom:1px solid #e5e7eb}
.dsh-pet-tab{flex:1;border:none;background:transparent;padding:6px 0;font-size:11px;font-weight:700;color:#6b7280;cursor:pointer;font-family:inherit;border-bottom:2px solid transparent}
.dsh-pet-tab.on{color:#1f2430;border-bottom-color:#4f6ef7}
.dsh-pet-tab:hover{color:#1f2430}
.dsh-pet-panel-bd{overflow-y:auto;padding:8px 12px 12px;font-size:12px}
.dsh-pet-panel-bd::-webkit-scrollbar{width:5px}
.dsh-pet-panel-bd::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:999px}
.dsh-pet-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.dsh-pet-row label{width:30px;flex:none;color:#6b7280;font-size:11px}
.dsh-pet-bar{flex:1;height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden}
.dsh-pet-bar i{display:block;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.4,1)}
.dsh-pet-row b{width:78px;flex:none;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;font-size:10.5px;color:#1f2430}
.dsh-pet-exp .cap{display:flex;justify-content:space-between;color:#6b7280;font-size:10.5px;margin:8px 0 3px}
.dsh-pet-sec h4{margin:10px 0 5px;font-size:10px;color:#6b7280;font-weight:800;letter-spacing:.5px}
.dsh-pet-acts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
.dsh-pet-btn{border:1.5px solid #2a2f3e;background:#f6f7fa;border-radius:8px;padding:6px 2px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;color:#1f2430;transition:transform .12s,background .12s}
.dsh-pet-btn:hover{background:#eef0f4}
.dsh-pet-btn:active{transform:scale(.94)}
.dsh-pet-btn:disabled{opacity:.4;cursor:not-allowed}
.dsh-pet-item{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:8px;border:1.5px solid #e5e7eb;margin-bottom:5px;background:#fff}
.dsh-pet-item .ic{font-size:14px;flex:none}
.dsh-pet-item .nm{font-weight:700;flex:none;font-size:11.5px;color:#1f2430;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-item .fx{color:#6b7280;flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-item .qty{flex:none;font-variant-numeric:tabular-nums;color:#6b7280;font-size:10.5px}
.dsh-pet-buy{flex:none;border:1.5px solid #2a2f3e;border-radius:6px;padding:2.5px 8px;font-size:10.5px;font-weight:800;cursor:pointer;background:#ffd33d;color:#1f2430;font-family:inherit}
.dsh-pet-buy:disabled{opacity:.35;cursor:not-allowed}
.dsh-pet-buy:not(:disabled):active{transform:scale(.94)}
.dsh-pet-toast{position:fixed;z-index:960;background:#1f2430;color:#fff;font-size:12px;padding:7px 13px;border-radius:9px;box-shadow:0 4px 0 rgba(0,0,0,.2);animation:dshPetToast 2.6s ease forwards;max-width:260px}
@keyframes dshPetToast{from{opacity:0;transform:translateY(8px)}10%,80%{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-6px)}}
`
  document.head.appendChild(s)
}

export const CarePanel: FC<Props> = ({ engine, anchor, onClose }) => {
  const [, bump] = useState(0)
  const [tab, setTab] = useState<'status' | 'bag' | 'shop'>('status')
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => { injectPanelStyles() }, [])

  const say = useCallback((text: string) => {
    setToast({ id: Date.now(), text })
  }, [])
  const refresh = useCallback(() => bump((v) => v + 1), [])

  // Position: open to the left of the pet, above its base; flip to the
  // right if it would overflow the viewport, clamp vertically.
  const PW = 260, PH = 380
  let px = anchor.x - PW - 16
  if (px < 8) px = anchor.x + 16 + 48 // pet width ~48
  if (px + PW > window.innerWidth - 8) px = Math.max(8, window.innerWidth - PW - 8)
  let py = anchor.y - PH + 28
  if (py < 8) py = Math.min(window.innerHeight - 160, anchor.y + 20)
  py = Math.max(8, py)

  const stats = engine.getStats()
  const info = engine.levels.getInfo()
  const expPct = info.expToNext > 0
    ? Math.min(100, Math.round(((info.exp - info.currentLevelExp) / info.expToNext) * 100))
    : 100

  const inv = engine.inventory.list().filter((it) => it.quantity !== 0)
  const shop = engine.shop.listShop({
    power: stats.power, health: stats.health, mood: stats.mood, adventureActive: false,
  }).slice(0, 8)

  const doPlay = (id: string) => {
    const r = engine.care.play(id)
    if (r.ok) say(id === 'hide_seek' ? '捉迷藏！心情 +10 电量 -18' : '晒了一会太阳，心情 +5')
    else if (r.reason === 'too_low_power') say('电量不够玩了，先喂点东西吧')
    refresh()
  }
  const doRest = () => {
    const r = engine.care.rest({ duration: 30, wokeBy: 'manual' })
    if (r.ok) say(`睡了 30 秒：心情 +${r.moodGain} 电量 -${r.powerCost}`)
    refresh()
  }
  const doUse = (id: string) => {
    const r = engine.care.useItem(id)
    if (!r.ok) {
      say(r.reason === 'cooldown' ? '还在冷却中…' : '没有这个道具了')
      return
    }
    const def = engine.inventory.getItemDef(id)
    say(def?.useText ?? `用掉了 ${id}`)
    refresh()
  }
  const doBuy = (id: string) => {
    const r = engine.shop.buy(id)
    if (r.ok) say(`买好了 ${id}`)
    else if (r.reason === 'insufficient_coins') say('金币不够')
    else if (r.reason === 'level_too_low') say('等级不够，还解锁不了')
    else if (r.reason === 'daily_limit') say('今天卖完了，明天再来')
    else say(`买不了（${r.reason}）`)
    refresh()
  }

  return (
    <>
      <div className="dsh-pet-panel" role="dialog" aria-label="Pet 照顾面板" style={{ left: px, top: py }}>
        <div className="dsh-pet-panel-hd">
          Pet <span className="sub">Lv.{stats.level} {stats.title}</span>
          <span className="coins">🪙 {stats.coins}</span>
          <button className="dsh-pet-panel-x" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="dsh-pet-tabs">
          <button className={`dsh-pet-tab ${tab === 'status' ? 'on' : ''}`} onClick={() => setTab('status')}>状态</button>
          <button className={`dsh-pet-tab ${tab === 'bag' ? 'on' : ''}`} onClick={() => setTab('bag')}>背包</button>
          <button className={`dsh-pet-tab ${tab === 'shop' ? 'on' : ''}`} onClick={() => setTab('shop')}>商店</button>
        </div>
        <div className="dsh-pet-panel-bd">
          {tab === 'status' && (
            <>
              <div className="dsh-pet-row">
                <label>心情</label>
                <div className="dsh-pet-bar"><i style={{ width: `${stats.mood}%`, background: barColor(stats.moodLevel) }} /></div>
                <b>{stats.mood} {LEVEL_NAMES[stats.moodLevel] ?? stats.moodLevel}</b>
              </div>
              <div className="dsh-pet-row">
                <label>电量</label>
                <div className="dsh-pet-bar"><i style={{ width: `${Math.min(100, stats.power / 3)}%`, background: barColor(stats.powerLevel) }} /></div>
                <b>{stats.power} {LEVEL_NAMES[stats.powerLevel] ?? stats.powerLevel}</b>
              </div>
              <div className="dsh-pet-row">
                <label>健康</label>
                <div className="dsh-pet-bar"><i style={{ width: `${stats.health}%`, background: barColor(stats.healthLevel) }} /></div>
                <b>{stats.health} {LEVEL_NAMES[stats.healthLevel] ?? stats.healthLevel}</b>
              </div>
              <div className="dsh-pet-exp">
                <div className="cap"><span>经验 → Lv.{stats.level + 1}</span><span>{expPct}%</span></div>
                <div className="dsh-pet-bar"><i style={{ width: `${expPct}%`, background: '#4f6ef7' }} /></div>
              </div>
              <div className="dsh-pet-sec">
                <h4>互动</h4>
                <div className="dsh-pet-acts">
                  <button className="dsh-pet-btn" onClick={() => doPlay('hide_seek')}>捉迷藏</button>
                  <button className="dsh-pet-btn" onClick={() => doPlay('sunbathe')}>晒太阳</button>
                  <button className="dsh-pet-btn" onClick={doRest}>睡一会</button>
                </div>
              </div>
            </>
          )}
          {tab === 'bag' && (
            <div className="dsh-pet-sec">
              {inv.length === 0 && <div style={{ color: '#6b7280', fontSize: 11 }}>背包空空的，去「商店」补货</div>}
              {inv.map((it) => (
                <div key={it.itemId} className="dsh-pet-item">
                  <span className="ic">{it.def.icon}</span>
                  <span className="nm">{it.def.name}</span>
                  <span className="fx">{CAT_NAMES[it.def.category] ?? it.def.category}</span>
                  <span className="qty">×{it.quantity < 0 ? '∞' : it.quantity}</span>
                  <button className="dsh-pet-buy" disabled={!it.canUse} onClick={() => doUse(it.itemId)}>使用</button>
                </div>
              ))}
            </div>
          )}
          {tab === 'shop' && (
            <div className="dsh-pet-sec">
              {shop.map((it) => (
                <div key={it.id} className="dsh-pet-item">
                  <span className="ic">{it.icon}</span>
                  <span className="nm">{it.name}</span>
                  <span className="qty">🪙{it.price}</span>
                  <button className="dsh-pet-buy" disabled={!it.canBuy} onClick={() => doBuy(it.id)}>购买</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div
          key={toast.id}
          className="dsh-pet-toast"
          style={{ left: px, top: py - 34 }}
        >
          {toast.text}
        </div>
      )}
    </>
  )
}
