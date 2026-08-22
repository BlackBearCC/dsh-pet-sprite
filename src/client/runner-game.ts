// Mini runner game — the pet's play break. A 60-second side-scroller drawn
// on one fixed overlay canvas: the pet runs, [Space] jumps (double jump),
// message bubbles scroll past as obstacles and coins. Lightweight by
// design: opens from the pet (double-click or the care panel), pauses the
// ambient physics without touching DSH state, pays out shop coins at the
// end, and returns the pet to its corner. Everything is canvas + rAF; no
// assets, no engine coupling beyond the wallet call.

import { drawPet, type Frames } from './pet-art.ts'
import { drawIcon, ICONS } from './pixel-icons.tsx'

export interface RunnerResult {
  score: number
  coins: number
  best: boolean
}

const W = 640
const H = 200
const GROUND_Y = 168
const PET_W = 36
const PET_H = 42
const GAME_SECONDS = 45

interface Obstacle { x: number; w: number; h: number; kind: 'bubble' | 'bug' }
interface Coin { x: number; y: number; taken: boolean; cv: HTMLCanvasElement }

/**
 * Run one game. Returns a promise resolving with the score when the player
 * finishes (time out, or esc). `onCoin` receives earned coins (wallet hook,
 * owned by the caller); never throws.
 */
export function runRunnerGame(frames: Frames, onCoin: (n: number) => void): Promise<RunnerResult> {
  return new Promise(resolve => {
    const host = document.createElement('div')
    host.className = 'dsh-pet-sprite-runner'
    const dim = document.createElement('div')
    dim.className = 'dsh-pet-sprite-runner-dim'
    const stage = document.createElement('div')
    stage.className = 'dsh-pet-sprite-runner-stage'
    const cv = document.createElement('canvas')
    cv.width = W * 2
    cv.height = H * 2
    cv.style.width = '100%'
    cv.style.height = 'auto'
    const hint = document.createElement('div')
    hint.className = 'dsh-pet-sprite-runner-hint'
    hint.textContent = '空格跳跃（可二段跳） · ESC 结束'
    stage.appendChild(cv)
    stage.appendChild(hint)
    host.appendChild(dim)
    host.appendChild(stage)
    document.body.appendChild(host)

    const coinCv = document.createElement('canvas')
    coinCv.width = 24; coinCv.height = 24
    drawIcon(coinCv, ICONS.coin)

    const x = cv.getContext('2d')
    if (x === undefined) {
      host.remove()
      resolve({ score: 0, coins: 0, best: false })
      return
    }
    x.scale(2, 2)

    // state
    let py = GROUND_Y - PET_H      // pet top
    let vy = 0
    let jumps = 0
    let t0 = performance.now()
    let speed = 3.2
    let score = 0
    let coins = 0
    let dead = 0                   // hit flash frames
    let raf = 0
    let ended = false
    const obstacles: Obstacle[] = []
    const coinsArr: Coin[] = []
    let nextObAt = 60
    let nextCoinAt = 90
    let groundScroll = 0
    const keys: Record<string, boolean> = {}
    let started = false

    const ground = () => GROUND_Y - PET_H

    const jump = (): void => {
      if (ended) return
      if (!started) { started = true; t0 = performance.now() }
      if (jumps < 2) {
        vy = jumps === 0 ? -7.4 : -6.2
        jumps++
      }
    }

    const finish = (): void => {
      if (ended) return
      ended = true
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      host.remove()
      onCoin(coins)
      resolve({ score, coins, best: false })
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); return }
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!keys.sp) { keys.sp = true; jump() }
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ' || e.key === 'ArrowUp') keys.sp = false
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    host.addEventListener('pointerdown', jump)

    const spawn = (frame: number): void => {
      if (frame > nextObAt) {
        const kind = Math.random() < 0.7 ? 'bubble' : 'bug'
        const h = kind === 'bubble' ? 22 + Math.random() * 16 : 14
        obstacles.push({ x: W + 20, w: kind === 'bubble' ? 30 + Math.random() * 22 : 20, h, kind })
        // ramp density with speed, keep a fair minimum gap
        nextObAt = frame + Math.max(52, 110 - speed * 9) + Math.random() * 40
      }
      if (frame > nextCoinAt) {
        coinsArr.push({ x: W + 20, y: GROUND_Y - 60 - Math.random() * 60, taken: false, cv: coinCv })
        nextCoinAt = frame + 70 + Math.random() * 80
      }
    }

    let lastFrame = -1
    const tick = (now: number): void => {
      if (ended) return
      const elapsed = started ? (now - t0) / 1000 : 0
      if (started && elapsed >= GAME_SECONDS) { finish(); return }
      if (started) speed = Math.min(7.5, 3.2 + elapsed * 0.08)

      // physics
      vy += 0.42
      py += vy
      const g = ground()
      if (py >= g) { py = g; vy = 0; jumps = 0 }
      groundScroll -= speed

      if (started) spawn(lastFrame)

      // move + collide
      const petL = 84, petR = 84 + PET_W, petT = py, petB = py + PET_H
      for (const o of obstacles) {
        o.x -= speed
        if (dead === 0 && o.x < petR && o.x + o.w > petL && petB > GROUND_Y - o.h) {
          // hit: score penalty + brief invulnerable flash
          dead = 45
          score = Math.max(0, score - 3)
        }
      }
      for (const c of coinsArr) {
        c.x -= speed
        if (!c.taken && Math.abs(c.x - (petL + PET_W / 2)) < 20 && Math.abs(c.y - (petT + PET_H / 2)) < 26) {
          c.taken = true
          coins++
          score += 5
        }
      }
      for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].x < -60) obstacles.splice(i, 1)
      for (let i = coinsArr.length - 1; i >= 0; i--) if (coinsArr[i].x < -30 || coinsArr[i].taken) coinsArr.splice(i, 1)
      if (dead > 0) dead--

      // ── draw ──
      x.clearRect(0, 0, W, H)
      // sky bands: follow the DSH theme (dark theme → dusk sky)
      const dark = typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme')
      x.fillStyle = dark ? '#232a38' : '#dceefb'
      x.fillRect(0, 0, W, GROUND_Y)
      x.fillStyle = dark ? '#2c3546' : '#c3d9ef'
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 130 + groundScroll * 0.25) % (W + 120)) - 60
        x.fillRect(cx, 24 + (i % 3) * 26, 46, 10)
      }
      // ground
      x.fillStyle = dark ? '#3d4a3a' : '#9db88f'
      x.fillRect(0, GROUND_Y, W, H - GROUND_Y)
      x.fillStyle = dark ? '#333f31' : '#87a17a'
      for (let gx = groundScroll % 32; gx < W; gx += 32) x.fillRect(gx, GROUND_Y, 16, 6)

      // obstacles
      for (const o of obstacles) {
        if (o.kind === 'bubble') {
          x.fillStyle = '#f3f4f8'
          x.strokeStyle = '#7d8596'
          x.lineWidth = 2
          const bx = o.x, by = GROUND_Y - o.h
          x.beginPath()
          x.roundRect(bx, by, o.w, o.h, 8)
          x.fill(); x.stroke()
          // little tail
          x.beginPath()
          x.moveTo(bx + 6, by + o.h)
          x.lineTo(bx + 12, by + o.h + 5)
          x.lineTo(bx + 16, by + o.h)
          x.fillStyle = '#f3f4f8'
          x.fill()
        } else {
          x.fillStyle = '#e8434e'
          x.fillRect(o.x, GROUND_Y - o.h, o.w, o.h)
          x.fillStyle = '#b32832'
          x.fillRect(o.x, GROUND_Y - o.h, o.w, 4)
        }
      }
      // coins
      for (const c of coinsArr) x.drawImage(c.cv, c.x - 7, c.y - 7, 14, 14)

      // pet (flash while invulnerable)
      if (dead === 0 || Math.floor(now / 60) % 2 === 0) {
        const art = (vy !== 0 || jumps > 0) ? (frames.JP ?? frames.I) : (frames.WA ?? frames.I)
        // drawPet wants a canvas; draw onto a scratch then blit
        tickScratch(art)
        x.drawImage(scratch, 84, py, PET_W, PET_H)
      }

      // HUD
      x.fillStyle = 'rgba(20,26,38,.75)'
      x.fillRect(10, 8, 190, 20)
      x.fillStyle = '#fff'
      x.font = '700 11px ui-monospace,Menlo,Consolas,monospace'
      x.fillText(`分数 ${score}   金币 ${coins}   ${started ? Math.max(0, Math.ceil(GAME_SECONDS - elapsed)) + 's' : '按空格开始'}`, 16, 22)

      lastFrame++
      raf = requestAnimationFrame(tick)
    }

    // scratch canvas for the pet frame (24x28 grid → 96x112 canvas)
    const scratch = document.createElement('canvas')
    scratch.width = 96; scratch.height = 112
    const sctx = scratch.getContext('2d')
    let scratchFrame: string[] | null = null
    function tickScratch(art: string[]): void {
      if (scratchFrame !== art) {
        sctx?.clearRect(0, 0, 96, 112)
        drawPet(scratch, art)
        scratchFrame = art
      }
    }

    raf = requestAnimationFrame(tick)
  })
}
