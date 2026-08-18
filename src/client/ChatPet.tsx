import { useEffect, useRef, useState, type FC } from 'react'
import { MiniEngine } from './game/mini-engine.ts'
import { CarePanel } from './CarePanel.tsx'

// Pet pixel companion, ported from the terminal-web project.
// A 24x28 hand-written pixel character (white long hair / sleepy eyes /
// white shirt + red tie / brown pleated skirt) drawn on canvas, no images.
// The conversation's message nodes are platforms: the pet wanders, jumps
// and climbs them on its own; clicking the chat background hands over
// WASD/space control for 10s. Clicking the pet = +1 combo with a skill
// jump and gold particle burst. Right-click the pet opens the care panel
// (PetClaw gameplay systems: attributes / level / care / shop / rewards).

// Engine singleton: gameplay state lives in localStorage, one instance
// survives React StrictMode remounts.
let engineSingleton: MiniEngine | null = null
function getEngine(): MiniEngine {
  if (!engineSingleton) engineSingleton = new MiniEngine()
  return engineSingleton
}

type PetMode = 'idle' | 'work'

interface Platform { x1: number; x2: number; y: number }

// ── pixel art (verbatim from terminal-web) ──────────────────────────────────
const PAL: Record<string, string> = {
  o: '#4a4553', h: '#f6f7fc', H: '#dcdff0', s: '#ffe9dc', S: '#f2cdb9',
  e: '#3c3744', X: '#ffffff', w: '#ffffff', t: '#e8434e', T: '#b32832',
  k: '#9c6640', K: '#7d4e2c', b: '#ffb3ae', m: '#e8927c', l: '#39496b',
  g: '#8fd0ff', z: '#8fa3c8',
}
const BASE = [
  '........oooooooo........',
  '......oohhhhhhhhoo......',
  '.....ohhhhhhhhhhhho.....',
  '....ohhhhhhhhhhhhhho....',
  '...ohhhhhhhhhhhhhhhho...',
  '..ohhhhhhhhhhhhhhhhhho..',
  '..ohhhhhhhhhhhhhhhhhho..',
  '..ohhHhsssssssssshHhho..',
  '..ohhsssssssssssssshho..',
  '..ohsseXessssseXesshho..',
  '..ohsseeessssseeesshho..',
  '..ohsbsssssssssssbshho..',
  '..ohssssssmmssssssshho..',
  '...ohhsssssssssssshho...',
  '....ohhsssssssssshho....',
  '..ohho..osssso..ohho....',
  '..ohho.owwwwwwo.ohho....',
  '..ohhoowwwttwwwoohho....',
  '..ohHo.swwtTws..oHho....',
  '...oho.okkkkkko..oho....',
  '...oo.okkkkkkkko..oo....',
  '......okkkkkkkkko.......',
  '.....okKkKkKkKkKko......',
  '.....oKKKKKKKKKKKo......',
  '........ss....ss........',
  '........ss....ss........',
  '.......oss....sso.......',
  '.......ooo....ooo.......',
]
function repl(rows: string[], edits: Record<number, string>): string[] {
  const c = rows.slice()
  for (const k in edits) c[+k] = edits[k]
  return c
}
function closedEyes(rows: string[]): string[] {
  const c = rows.slice()
  c[9] = c[9].replace(/[eX]/g, 's')
  c[10] = c[10].replace(/e/g, 'S')
  return c
}
const F = {
  I: BASE,
  B: ['........................'].concat(BASE.slice(0, 16), BASE.slice(17)),
  BL: closedEyes(BASE),
  ZZ: repl(closedEyes(['........................'].concat(BASE.slice(0, 16), BASE.slice(17))), {
    1: '......oohhhhhhhhoo...z..',
    2: '.....ohhhhhhhhhhhho.z...',
    3: '....ohhhhhhhhhhhhhho..z.',
  }),
  WA: repl(BASE, { 19: '...oho.ollllllo..oho....' }),
  WB: repl(repl(BASE, { 19: '...oho.ollllllo..oho....' }), {
    18: '..ohHo..wwtTw...oHho....',
    16: '..ohho.owwwwwwo.ohho..g.',
  }),
  KA: repl(BASE, {
    24: '.......ss......ss.......', 25: '.......ss......ss.......',
    26: '......oss......sso......', 27: '......ooo......ooo......',
  }),
  KB: repl(BASE, {
    24: '.........ss..ss.........', 25: '.........ss..ss.........',
    26: '........oss..sso........', 27: '........ooo..ooo........',
  }),
  JP: repl(BASE, {
    24: '.........ss..ss.........', 25: '........oss..sso........',
    26: '........ooo..ooo........', 27: '........................',
  }),
}
function drawPet(cv: HTMLCanvasElement, rows: string[]): void {
  const sc = cv.width / 24
  const x = cv.getContext('2d')
  if (!x) return
  x.clearRect(0, 0, cv.width, cv.height)
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    for (let i = 0; i < 24; i++) {
      const ch = r[i]
      if (ch === '.' || ch === undefined) continue
      x.fillStyle = PAL[ch] ?? '#f0f'
      x.fillRect(i * sc, y * sc, sc, sc)
    }
  }
}

// ── styles ───────────────────────────────────────────────────────────────────
let styleInjected = false
function injectStyles(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.dsh-pet-layer{position:fixed;inset:0;z-index:900;pointer-events:none}
.dsh-pet-unit{position:absolute;width:48px;height:56px;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 2px 0 rgba(0,0,0,.12));opacity:.97;user-select:none;-webkit-tap-highlight-color:transparent}
.dsh-pet-unit canvas{width:100%;height:100%;image-rendering:pixelated;display:block}
.dsh-pet-plus{position:absolute;left:50%;top:-15px;transform:translateX(-50%);z-index:6;font:900 16px ui-monospace,Menlo,Consolas,monospace;color:#ffd33d;pointer-events:none;animation:dshPetPlus .9s cubic-bezier(.2,.8,.4,1) forwards;letter-spacing:-1px;text-shadow:1.5px 0 0 #4a4553,-1.5px 0 0 #4a4553,0 1.5px 0 #4a4553,0 -1.5px 0 #4a4553,1.5px 1.5px 0 #4a4553,-1.5px 1.5px 0 #4a4553,1.5px -1.5px 0 #4a4553,-1.5px -1.5px 0 #4a4553}
@keyframes dshPetPlus{from{opacity:0;transform:translateX(-50%) translateY(4px) scale(.5)}25%{opacity:1;transform:translateX(-50%) translateY(-10px) scale(1.35)}to{opacity:0;transform:translateX(-50%) translateY(-34px) scale(1)}}
.dsh-pet-count{position:absolute;top:-30px;left:-6px;z-index:6;font:900 11px ui-monospace,Menlo,Consolas,monospace;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.18);border-radius:999px;padding:2px 9px;color:inherit;pointer-events:none;opacity:0;transition:opacity .25s;box-shadow:0 2px 0 rgba(0,0,0,.12)}
.dsh-pet-count.on{opacity:1}
.dsh-pet-spark{position:absolute;z-index:6;width:6px;height:6px;background:#ffd33d;border:1px solid rgba(0,0,0,.25);pointer-events:none;animation:dshPetSpark .6s ease-out forwards}
@keyframes dshPetSpark{to{transform:translate(var(--dx),var(--dy));opacity:0}}
.dsh-pet-ctl{position:absolute;top:-30px;right:-8px;z-index:6;font:800 10.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.18);border-radius:999px;padding:3px 10px;color:#7b8190;pointer-events:none;box-shadow:0 2px 0 rgba(0,0,0,.12);white-space:nowrap}
.dsh-pet-status{position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);z-index:6;font:800 9.5px ui-monospace,Menlo,Consolas,monospace;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.14);border-radius:999px;padding:1px 8px;color:#7b8190;pointer-events:none;white-space:nowrap;box-shadow:0 2px 0 rgba(0,0,0,.10)}
@media (prefers-reduced-motion:reduce){.dsh-pet-plus{animation-duration:.4s}}
`
  document.head.appendChild(style)
}

export const ChatPet: FC = () => {
  const layerRef = useRef<HTMLDivElement>(null)
  const unitRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const ctlRef = useRef<HTMLSpanElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const engine = getEngine()

  useEffect(() => {
    injectStyles()
    const layer = layerRef.current
    const unit = unitRef.current
    const cv = canvasRef.current
    const badge = countRef.current
    const ctlHint = ctlRef.current
    const statusBar = statusRef.current
    if (!layer || !unit || !cv) return

    // gameplay engine: ticks attribute decay, bridges DSH chat events
    engine.start()
    engine.onLogin()
    const statusTimer = setInterval(() => {
      const s = engine.getStats()
      if (statusBar) statusBar.textContent = `Lv.${s.level} ${s.title} · 🪙${s.coins}`
    }, 2500)
    { const s = engine.getStats(); if (statusBar) statusBar.textContent = `Lv.${s.level} ${s.title} · 🪙${s.coins}` }

    // DSH bridges: user message → power drain; assistant done → EXP
    let lastUserCount = document.querySelectorAll('[data-chat-flow-kind="user"]').length
    let wasStreaming = !!document.querySelector('[data-streaming]')
    function bridgeChat(): void {
      const users = document.querySelectorAll('[data-chat-flow-kind="user"]')
      if (users.length > lastUserCount) {
        const last = users[users.length - 1]
        engine.onUserMessage(last.textContent ?? '')
      }
      lastUserCount = users.length
      const streaming = !!document.querySelector('[data-streaming]')
      if (wasStreaming && !streaming) {
        const nodes = document.querySelectorAll('[data-chat-flow-key]')
        const lastNode = nodes[nodes.length - 1]
        engine.onAssistantDone(lastNode?.textContent?.length ?? 0)
      }
      wasStreaming = streaming
    }

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let count = 0
    try { count = parseInt(localStorage.getItem('dshPetClicks') ?? '0', 10) || 0 } catch { count = 0 }
    let badgeTimer: ReturnType<typeof setTimeout> | undefined

    // physics constants, kept identical to the original game
    const G = 1500, WALK = 58, CLIMBV = 85, SKILLV = 780, JUMPV = 420, PW = 48
    let x = 16, h = 0, vy = 0, dir = 1
    let state: 'ground' | 'air' | 'climb' = 'ground'
    let plat: Platform | null = null
    let goal: { x: number; jump?: Platform } | null = null
    let climb: { x: number; top: number; p: Platform } | null = null
    let ft = 0, ftAcc = 0, lastFrame: string[] | null = null, lastT = 0, planAt = 0
    let plats: Platform[] = [], platsAt = 0
    let mode: PetMode = 'idle'
    let floorX = 0, floorY = 0, visible = false

    // player control: click chat background to take over, 10s idle hands back
    const keys: Record<string, boolean> = {}
    let playerCtl = false, lastKeyAt = 0, airJumped = false, dropP: Platform | null = null, moving = false

    function playground(): DOMRect | null {
      const el = document.querySelector('[data-conversation-scroll]')
      const r = el?.getBoundingClientRect()
      if (!r || r.height < 200 || r.width < 240) return null
      return r
    }
    function scanPlats(): void {
      const fr = playground()
      if (!fr) { plats = []; return }
      const out: Platform[] = []
      const els = document.querySelectorAll('[data-chat-flow-key]')
      for (let i = Math.max(0, els.length - 30); i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (r.width < 70 || r.bottom < 20 || r.top <= 0 || r.top >= fr.bottom - 24) continue
        out.push({ x1: r.left - fr.left, x2: r.right - fr.left, y: fr.bottom - 4 - r.top })
      }
      plats = out
    }
    function support(): boolean {
      if (!plat) return true
      for (const p of plats) {
        if (Math.abs(p.y - h) < 26 && x + PW / 2 > p.x1 - 4 && x + PW / 2 < p.x2 + 4) { plat = p; h = p.y; return true }
      }
      return false
    }
    function jumpTo(p: Platform): boolean {
      const need = Math.sqrt(2 * G * Math.max(20, p.y - h + 16))
      if (need > SKILLV) return false
      vy = need; state = 'air'; climb = null
      if (need > JUMPV + 60) burst()
      return true
    }
    function startClimb(p: Platform): void {
      const edge = Math.abs(x - p.x1) < Math.abs(x - p.x2) ? p.x1 - 12 : p.x2 - PW + 12
      climb = { x: edge, top: p.y, p }
      goal = { x: edge }
    }
    function plan(now: number): void {
      planAt = now + 1200 + Math.random() * 1800
      const ups = plats.filter(p => p.y > h + 30 && p.y < h + 560)
      const r = Math.random()
      if (r < .34 || ups.length === 0) { goal = { x: 12 + Math.random() * Math.max(20, floorX - 76) }; return }
      const c = ups[Math.floor(Math.random() * ups.length)]
      if (c.y - h <= 200) { goal = { x: Math.max(c.x1, Math.min(c.x2 - PW, x)), jump: c } }
      else if (r < .8) startClimb(c)
      else if (h > 0 && plat) goal = { x: Math.random() < .5 ? plat.x1 - 40 : plat.x2 + 8 }
    }
    function burst(): void {
      if (still) return
      for (let i = 0; i < 6; i++) {
        const s = document.createElement('span')
        s.className = 'dsh-pet-spark'
        s.style.left = `${18 + Math.random() * 16}px`
        s.style.top = `${-10 - h}px`
        s.style.setProperty('--dx', `${Math.random() * 44 - 22}px`)
        s.style.setProperty('--dy', `${-14 - Math.random() * 30}px`)
        unit.appendChild(s)
        setTimeout(() => s.remove(), 650)
      }
    }
    function typingField(): boolean {
      const a = document.activeElement
      if (!a) return false
      return !!(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable)
    }
    function setCtl(on: boolean): void {
      if (playerCtl === on) return
      playerCtl = on
      if (ctlHint) ctlHint.style.display = on ? '' : 'none'
      if (on && ctlHint) ctlHint.textContent = '操控中：A/D 移动 · 空格 跳跃 · W 攀爬 · S 下落'
      if (!on) { for (const k in keys) keys[k] = false; planAt = lastT + 1500 }
    }
    function tryClimbNear(): boolean {
      for (const p of plats) {
        if (p.y < h + 30) continue
        const le = p.x1 - 12, re = p.x2 - PW + 12
        if (Math.abs(x - le) < 30) { climb = { x: le, top: p.y, p }; state = 'climb'; return true }
        if (Math.abs(x - re) < 30) { climb = { x: re, top: p.y, p }; state = 'climb'; return true }
      }
      return false
    }

    function frameFor(): string[] {
      if (state === 'air') return F.JP
      if (state === 'climb') return ft % 2 ? F.KA : F.KB
      if (moving || (goal && Math.abs(goal.x - x) > 3)) return ft % 4 < 2 ? F.KA : F.KB
      if (mode === 'work') return ft % 6 < 3 ? F.WA : F.WB
      if (ft % 50 === 9) return F.BL
      if (ft % 140 >= 124) return ft % 10 < 5 ? F.ZZ : F.B
      return ft % 10 < 5 ? F.I : F.B
    }

    let raf = 0
    function tick(now: number): void {
      raf = requestAnimationFrame(tick)
      const fr = playground()
      visible = fr !== null
      if (!visible) { layer.style.display = 'none'; lastT = now; return }
      layer.style.display = ''
      const dt = Math.min(.05, (now - lastT) / 1000 || 0)
      lastT = now
      ftAcc += dt
      if (ftAcc >= .16) { ftAcc = 0; ft++ }
      floorX = fr.width
      floorY = fr.bottom - 4
      if (now > platsAt) {
        scanPlats()
        platsAt = now + 150
        mode = document.querySelector('[data-streaming]') ? 'work' : 'idle'
        bridgeChat()
        if (state === 'ground' && h > 0 && !support()) { state = 'air'; vy = 0; plat = null }
      }
      if (playerCtl && now - lastKeyAt > 10000) setCtl(false)
      moving = false
      if (playerCtl) {
        goal = null
        if (keys.a) { x -= WALK * 1.7 * dt; dir = -1; moving = true }
        if (keys.d) { x += WALK * 1.7 * dt; dir = 1; moving = true }
        if (moving && state === 'climb') { state = 'air'; vy = 0; climb = null }
      } else if (mode !== 'idle') {
        goal = null; climb = null
        if (state === 'climb') state = 'air'
      }
      if (state === 'climb' && climb) {
        dir = climb.x > x ? 1 : (climb.x < x ? -1 : dir)
        if (Math.abs(climb.x - x) > 3) x += WALK * dt * (climb.x > x ? 1 : -1)
        else {
          h += CLIMBV * dt
          if (h >= climb.top) {
            h = climb.top; plat = climb.p
            x = Math.max(climb.p.x1 + 2, Math.min(climb.p.x2 - PW - 2, x))
            state = 'ground'; climb = null; goal = null
          }
        }
      } else if (state === 'air') {
        h += vy * dt
        const pv = vy
        vy -= G * dt
        if (vy < 0) {
          for (const p of plats) {
            if (dropP && Math.abs(p.y - dropP.y) < 8) continue
            if (h <= p.y && h + ((pv > 0 ? pv : 0) - vy) * dt + 30 >= p.y && x + PW / 2 > p.x1 - 4 && x + PW / 2 < p.x2 + 4 && p.y > 2) {
              h = p.y; vy = 0; state = 'ground'; plat = p; goal = null; dropP = null; airJumped = false
              break
            }
          }
        }
        if (h <= 0) { h = 0; vy = 0; state = 'ground'; plat = null; dropP = null; airJumped = false }
      } else if (goal) {
        dir = goal.x > x + 2 ? 1 : (goal.x < x - 2 ? -1 : dir)
        if (Math.abs(goal.x - x) > 3) x += WALK * dt * dir
        else if (goal.jump) { const j = goal.jump; goal = null; jumpTo(j) }
        else goal = null
      } else if (!playerCtl && mode === 'idle' && state === 'ground' && now > planAt) plan(now)
      if (!playerCtl && state === 'ground' && mode !== 'idle' && h > 0) { state = 'air'; vy = 0 }
      const mx = floorX - 52
      if (x < 2) x = 2
      if (x > mx) x = mx
      unit.style.left = `${Math.round(fr.left + x)}px`
      unit.style.top = `${Math.round(floorY - 56 - h)}px`
      cv.style.transform = (dir < 0 ? 'scaleX(-1)' : '') + (state === 'climb' ? ` rotate(${dir < 0 ? -8 : 8}deg)` : '')
      const f = frameFor()
      if (f !== lastFrame) { lastFrame = f; drawPet(cv, f) }
    }

    // click the chat background (not its interactive bits) to enter control
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target
      if (!t || typeof (t as Element).closest !== 'function') return
      if (!document.querySelector('[data-conversation-scroll]')) { setCtl(false); return }
      if (!(t as Element).closest('[data-conversation-scroll]')) { setCtl(false); return }
      if ((t as Element).closest('.dsh-pet-unit,a,button,input,textarea,select,label,[role="button"],[contenteditable]')) return
      setCtl(true)
      lastKeyAt = performance.now()
      const ae = document.activeElement as HTMLElement | null
      if (ae && ae !== document.body && ae.blur) ae.blur()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!playerCtl || typingField() || still) return
      const k = e.key === ' ' ? 'sp' : String(e.key || '').toLowerCase()
      if (k !== 'a' && k !== 'd' && k !== 'w' && k !== 's' && k !== 'sp') return
      e.preventDefault()
      e.stopImmediatePropagation()
      lastKeyAt = performance.now()
      if (k === 'sp' && !keys.sp) {
        if (state === 'ground') { vy = JUMPV; state = 'air'; airJumped = false; goal = null; climb = null }
        else if (state === 'air' && !airJumped) { airJumped = true; vy = Math.max(vy, SKILLV * .85); burst() }
        else if (state === 'climb') { state = 'air'; vy = JUMPV * .8; climb = null }
      }
      if (k === 'w' && state !== 'climb' && state === 'ground') tryClimbNear()
      if (k === 's' && state === 'ground' && plat) { dropP = plat; plat = null; state = 'air'; vy = 0; h -= 2 }
      keys[k] = true
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const k = e.key === ' ' ? 'sp' : String(e.key || '').toLowerCase()
      if (keys[k]) keys[k] = false
    }
    const onBlur = (): void => { for (const k in keys) keys[k] = false }

    const onClickPet = (): void => {
      count++
      try { localStorage.setItem('dshPetClicks', String(count)) } catch { /* ignore */ }
      if (!still) {
        burst()
        if (state !== 'climb') { vy = Math.max(vy, SKILLV * .9); state = 'air' }
      }
      const fl = document.createElement('span')
      fl.className = 'dsh-pet-plus'
      fl.textContent = '+1'
      fl.style.marginLeft = `${Math.round(Math.random() * 14 - 7)}px`
      unit.appendChild(fl)
      setTimeout(() => fl.remove(), 950)
      if (badge) {
        badge.textContent = `×${count}`
        badge.classList.add('on')
        clearTimeout(badgeTimer)
        badgeTimer = setTimeout(() => badge.classList.remove('on'), 1600)
      }
    }

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      // open the panel beside the pet's current on-screen position
      const r = unit.getBoundingClientRect()
      setAnchor({ x: r.left, y: r.bottom })
      setPanelOpen(true)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    unit.addEventListener('click', onClickPet)
    unit.addEventListener('contextmenu', onContextMenu)
    if (ctlHint) ctlHint.style.display = 'none'

    drawPet(cv, F.I)
    if (!still) requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(tick) })
    else {
      // reduced motion: still draw frames slowly, no physics takeover
      const slow = setInterval(() => { ft++; const f = frameFor(); if (f !== lastFrame) { lastFrame = f; drawPet(cv, f) } }, 320)
      return () => {
        clearInterval(slow)
        clearInterval(statusTimer)
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('keyup', onKeyUp, true)
        window.removeEventListener('blur', onBlur)
        unit.removeEventListener('click', onClickPet)
        unit.removeEventListener('contextmenu', onContextMenu)
      }
    }
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(badgeTimer)
      clearInterval(statusTimer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      unit.removeEventListener('click', onClickPet)
      unit.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  return (
    <div ref={layerRef} className="dsh-pet-layer">
      <div ref={unitRef} className="dsh-pet-unit" title="Pet（右键打开照顾面板）">
        <span ref={countRef} className="dsh-pet-count" />
        <span ref={ctlRef} className="dsh-pet-ctl" />
        <canvas ref={canvasRef} width={96} height={112} />
        <span ref={statusRef} className="dsh-pet-status" />
      </div>
      {panelOpen && <CarePanel engine={engine} anchor={anchor} onClose={() => setPanelOpen(false)} />}
    </div>
  )
}
