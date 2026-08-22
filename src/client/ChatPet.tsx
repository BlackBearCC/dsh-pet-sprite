import { useEffect, useRef, useState, type FC } from 'react'
import { MiniEngine } from './game/mini-engine.ts'
import { CarePanel } from './CarePanel.tsx'
import { PetChatBox, type ChatModel, type ChatTurn } from './PetChatBox.tsx'
import { PetPicker } from './PetPicker.tsx'
import { runRunnerGame } from './runner-game.ts'
import {
  DEFAULT_LINES, EMPTY_PROFILE, framesFromRows, importFromText, loadCustomPets,
  loadProfiles, parseProfile, pickLine, saveCustomPet, saveProfile, speakLine,
  type CustomPet, type LineKey, type PetProfile,
} from './custom-pets.ts'
import { drawPet, EGG_ROWS, PET_ART, PET_IDS, PET_META, type Frames, type PetId } from './pet-art.ts'
import { drawIcon, ICONS } from './pixel-icons.tsx'
import { isCustomPetId } from '../pixel-format.ts'
import { recordLevelUp, recordTask, recordTurn } from './game/witness-log.ts'
import { trackWorkspace, type WorkspaceView } from './workspace.ts'
import { isSyncReady, whenSyncReady } from './sync-gate.ts'
import { schedulePush } from './sync.ts'
import {
  addMemories, autoExtractEnabled, bumpTaskCounter, loadMemories,
  memoryTexts, removeMemory, setAutoExtract, takeExtractSlot, type PetMemory,
} from './memory.ts'

// Pet pixel companion, ported from the terminal-web project.
// Three selectable companions (see pet-art.ts): Poka the original girl,
// Mikan the tabby cat, Puff the baby whale — each a 24x28 hand-written
// sprite drawn on canvas, no images. On top of those, users can generate
// custom companions from a text description (settings tab → 100 star
// coins): the node route asks an LLM for a pixel grid, which lives in
// localStorage and animates via derived frames (see custom-pets.ts).
// The conversation's message nodes are platforms: the pet wanders, jumps
// and climbs them on its own; clicking the chat background hands over
// WASD/space control for 10s. Left-click the pet opens a side chat box
// (LLM replies via the plugin's node-side /plugins/dsh-pet-sprite/chat
// route, model + persona pickable in the care panel's settings tab).
// Right-click opens the care panel (PetClaw gameplay systems) and the
// companion picker.

const PET_ID_KEY = 'dshPetSpriteGame:petId'
function loadPetId(): string | null {
  try {
    const v = localStorage.getItem(PET_ID_KEY)
    if (v === null) return null
    return PET_IDS.includes(v as PetId) || isCustomPetId(v) ? v : null
  } catch { return null }
}
function savePetId(id: string): void {
  try { localStorage.setItem(PET_ID_KEY, id) } catch { /* ignore */ }
  schedulePush()
}

// ── one-time teasers: shown exactly once, ever (persisted in localStorage) ──
// The status pill and the WASD control hint are onboarding devices — once
// the user has seen each of them, they never come back, even across page
// reloads or companion switches. Storage failure degrades to once per
// page load, never to "never shown at all".
const TEASER_SEEN_KEY = 'dshPetSpriteGame:teasersSeen'
// vine-climb toggle (default OFF: the vine is a decorative overlay that can
// cover conversation text, so it only appears for users who opt in)
const VINE_KEY = 'dshPetSpriteGame:vineClimb'
function vineEnabled(): boolean {
  try { return localStorage.getItem(VINE_KEY) === '1' } catch { return false }
}
function setVineEnabled(on: boolean): void {
  try { localStorage.setItem(VINE_KEY, on ? '1' : '0') } catch { /* best-effort */ }
  schedulePush()
}
function loadTeasersSeen(): { status?: boolean; ctl?: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(TEASER_SEEN_KEY) ?? '{}') as { status?: boolean; ctl?: boolean }
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
function markTeaserSeen(kind: 'status' | 'ctl'): void {
  try {
    const next = { ...loadTeasersSeen(), [kind]: true }
    localStorage.setItem(TEASER_SEEN_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
  schedulePush()
}

// ── companion chat: history + model choice persist in localStorage ──────────
const CHAT_HISTORY_KEY = 'dshPetSpriteChat:history'
const CHAT_MODEL_KEY = 'dshPetSpriteChat:model'
function loadChatHistory(): ChatTurn[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]') as ChatTurn[]
    return Array.isArray(v) ? v.filter(t => t && typeof t.text === 'string') : []
  } catch { return [] }
}
function saveChatHistory(history: ChatTurn[]): void {
  try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history.slice(-30))) } catch { /* ignore */ }
  schedulePush()
}
function loadChatModel(): ChatModel | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAT_MODEL_KEY) ?? 'null') as ChatModel | null
    return v && typeof v.provider === 'string' && typeof v.model === 'string' ? v : null
  } catch { return null }
}
function saveChatModel(model: ChatModel | null): void {
  try {
    if (model === null) localStorage.removeItem(CHAT_MODEL_KEY)
    else localStorage.setItem(CHAT_MODEL_KEY, JSON.stringify(model))
  } catch { /* ignore */ }
  schedulePush()
}

// module-level cache of the persisted ctl flag: re-reading localStorage on
// every takeover is pointless — once taught (per browser profile, persisted
// in localStorage), the WASD hint never comes back
let ctlHintShown = loadTeasersSeen().ctl === true

// ── per-pet profiles: persona + event lines (storage in custom-pets.ts) ─────

/** Everything the render loop and UI need for one companion, builtin or custom. */
interface ResolvedPet {
  name: string
  tagline: string
  frames: Frames
  idleLines: readonly string[]
}
function resolvePet(id: string, customs: CustomPet[]): ResolvedPet | null {
  if (PET_IDS.includes(id as PetId)) {
    const meta = PET_META[id as PetId]
    return { name: meta.name, tagline: meta.tagline, frames: PET_ART[id as PetId], idleLines: meta.idleLines }
  }
  const custom = customs.find(p => p.id === id)
  if (custom === undefined) return null
  return { name: custom.name, tagline: custom.tagline, frames: framesFromRows(custom.rows), idleLines: [] }
}

// Engine singleton: gameplay state lives in localStorage, one instance
// survives React StrictMode remounts.
let engineSingleton: MiniEngine | null = null
function getEngine(): MiniEngine {
  if (!engineSingleton) engineSingleton = new MiniEngine()
  return engineSingleton
}

// The journal witnesses level-ups too. Wired once per page load, not per
// effect run — the engine is a singleton and its bus outlives remounts.
let witnessBusWired = false
function wireWitnessBus(engine: MiniEngine, burstRef: React.MutableRefObject<(opts?: { count?: number; color?: string }) => void>): void {
  if (witnessBusWired) return
  witnessBusWired = true
  engine.bus.on('level:up', () => {
    recordLevelUp()
    burstRef.current({ count: 14, color: '#ffd33d' })
  })
}

type PetMode = 'idle' | 'work'

interface Platform { x1: number; x2: number; y: number }
// where the pet may land: user message bubbles (每条用户消息) and the
// composer card. Assistant bubbles are readable text — the pet never
// stands on them (不阻挡文字显示).
interface Landing extends Platform { kind: 'user' | 'composer' }

// ── styles ───────────────────────────────────────────────────────────────────
let styleInjected = false
function injectStyles(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.dsh-pet-sprite-layer{position:fixed;inset:0;z-index:900;pointer-events:none}
.dsh-pet-sprite-unit{position:absolute;width:48px;height:56px;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 2px 0 rgba(0,0,0,.12));opacity:.97;user-select:none;-webkit-tap-highlight-color:transparent}
.dsh-pet-sprite-unit canvas{width:100%;height:100%;image-rendering:pixelated;display:block}
.dsh-pet-sprite-spark{position:absolute;z-index:6;width:5px;height:5px;background:#ffd33d;border:1px solid rgba(0,0,0,.25);pointer-events:none;animation:dshPetSpriteSpark .42s ease-out forwards}
@keyframes dshPetSpriteSpark{to{transform:translate(var(--dx),var(--dy)) scale(.4);opacity:0}}
.dsh-pet-sprite-dust{position:absolute;z-index:5;width:7px;height:7px;background:#b9a98f;border:1.5px solid rgba(0,0,0,.22);border-radius:50%;pointer-events:none;transform-origin:50% 100%;animation:dshPetSpriteDust .5s ease-out forwards}
@keyframes dshPetSpriteDust{0%{transform:translate(0,0) scale(var(--ds,1));opacity:.95}100%{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
.dsh-pet-sprite-vine{position:absolute;bottom:0;width:5px;background:linear-gradient(#5f9e4e,#3f7a34);border:1px solid rgba(0,0,0,.28);border-radius:3px;z-index:4;pointer-events:none;transform-origin:50% 100%;animation:dshPetSpriteVineGrow .7s cubic-bezier(.3,1.4,.5,1) both}
@keyframes dshPetSpriteVineGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.dsh-pet-sprite-vine-leaf{position:absolute;width:9px;height:7px;background:#6fb857;border:1px solid rgba(0,0,0,.25);border-radius:60% 10% 60% 10%;pointer-events:none;animation:dshPetSpriteLeafSway 1.6s ease-in-out infinite}
@keyframes dshPetSpriteLeafSway{0%,100%{transform:scaleX(var(--lf,1)) rotate(-6deg)}50%{transform:scaleX(var(--lf,1)) rotate(8deg)}}
.dsh-pet-sprite-ctl{position:absolute;top:-30px;right:-8px;z-index:6;font:800 10.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.18);border-radius:999px;padding:3px 10px;color:var(--dsw-alias-label-secondary,#7b8190);pointer-events:none;box-shadow:0 2px 0 rgba(0,0,0,.12);white-space:nowrap;transition:opacity .55s}
.dsh-pet-sprite-bubble{position:absolute;bottom:calc(100% + 9px);left:50%;z-index:7;max-width:190px;background:var(--dsw-alias-bg-layer-1,#fff);border:2.5px solid var(--dsw-alias-label-primary,#4a4553);border-radius:12px;padding:4px 11px;font:700 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--dsw-alias-label-primary,#4a4553);white-space:nowrap;pointer-events:none;box-shadow:0 2.5px 0 rgba(0,0,0,.15);animation:dshPetSpriteBubbleIn .5s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-bubble::after{content:'';position:absolute;top:calc(100% - 6.5px);left:50%;width:11px;height:11px;background:var(--dsw-alias-bg-layer-1,#fff);border-right:2.5px solid #4a4553;border-bottom:2.5px solid #4a4553;transform:translateX(-50%) rotate(45deg)}
.dsh-pet-sprite-bubble-wrap{white-space:pre-wrap;word-break:break-word;max-width:230px;line-height:1.6;text-align:left}
@keyframes dshPetSpriteBubbleIn{from{opacity:0;transform:translateX(-50%) translateY(9px) scale(.55)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
.dsh-pet-sprite-unit{cursor:grab}
.dsh-pet-sprite-unit:active{cursor:grabbing}
.dsh-pet-sprite-unit.dsh-pet-sprite-dragging{filter:drop-shadow(0 7px 9px rgba(0,0,0,.24))}
.dsh-pet-sprite-dragging canvas{animation:dshPetSpriteHang .8s ease-in-out infinite alternate}
@keyframes dshPetSpriteHang{from{transform:rotate(-8deg) scale(1.1)}to{transform:rotate(8deg) scale(1.1)}}
.dsh-pet-sprite-status{position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);z-index:6;font:800 9.5px ui-monospace,Menlo,Consolas,monospace;background:var(--dsh-card,#fff);border:2px solid rgba(0,0,0,.14);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary,#7b8190);pointer-events:none;white-space:nowrap;box-shadow:0 2px 0 rgba(0,0,0,.10)}
.dsh-pet-sprite-egg{position:absolute;left:58px;bottom:14px;width:48px;height:56px;pointer-events:auto;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 2.5px 0 rgba(0,0,0,.13));animation:dshPetSpriteEggIn .6s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-egg canvas{width:100%;height:100%;image-rendering:pixelated;display:block;animation:dshPetSpriteEggWobble 4.8s ease-in-out infinite,dshPetSpriteEggGlow 3.2s ease-in-out infinite;transform-origin:50% 92%}
@keyframes dshPetSpriteEggIn{from{opacity:0;transform:translateY(18px) scale(.5)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes dshPetSpriteEggWobble{0%,66%,100%{transform:rotate(0)}70%{transform:rotate(-7deg)}74%{transform:rotate(6deg)}78%{transform:rotate(-4deg)}82%{transform:rotate(1.5deg)}86%{transform:rotate(0)}89%{transform:rotate(0) translateY(-2px)}91%{transform:rotate(0) translateY(0)}}
@keyframes dshPetSpriteEggGlow{0%,100%{filter:drop-shadow(0 0 2px rgba(143,208,255,.25))}50%{filter:drop-shadow(0 0 6px rgba(143,208,255,.55))}}
.dsh-pet-sprite-egg:hover{filter:drop-shadow(0 5px 7px rgba(0,0,0,.2)) drop-shadow(0 0 5px rgba(143,208,255,.45))}
.dsh-pet-sprite-egg:hover canvas{animation:dshPetSpriteEggGlow 1.6s ease-in-out infinite;transform:rotate(-6deg) scale(1.08)}
.dsh-pet-sprite-egg:active canvas{transform:rotate(-9deg) scale(.96)}
.dsh-pet-sprite-egg-hint{position:absolute;bottom:calc(100% + 9px);left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-1,#fff);border:2.5px solid var(--dsw-alias-label-primary,#4a4553);border-radius:12px;padding:3px 11px;font:700 11.5px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--dsw-alias-label-primary,#4a4553);white-space:nowrap;pointer-events:none;box-shadow:0 2.5px 0 rgba(0,0,0,.15);animation:dshPetSpriteEggHint .5s cubic-bezier(.2,1.7,.4,1) both}
.dsh-pet-sprite-egg-hint::after{content:'';position:absolute;top:calc(100% - 6.5px);left:50%;width:11px;height:11px;background:var(--dsw-alias-bg-layer-1,#fff);border-right:2.5px solid #4a4553;border-bottom:2.5px solid #4a4553;transform:translateX(-50%) rotate(45deg)}
@keyframes dshPetSpriteEggHint{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.55)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
.dsh-pet-sprite-runner{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center}
.dsh-pet-sprite-runner-dim{position:absolute;inset:0;background:rgba(20,24,32,.45)}
.dsh-pet-sprite-runner-stage{position:relative;width:min(92vw,660px);background:var(--dsw-alias-bg-layer-1,#fff);border:3px solid var(--dsw-alias-label-primary,#4a4553);border-radius:14px;box-shadow:0 10px 0 rgba(0,0,0,.25);padding:10px;animation:dshPetSpriteRunnerIn .3s cubic-bezier(.2,1.5,.4,1) both;cursor:pointer}
@keyframes dshPetSpriteRunnerIn{from{opacity:0;transform:translateY(20px) scale(.92)}to{opacity:1;transform:none}}
.dsh-pet-sprite-runner-stage canvas{display:block;border-radius:8px;image-rendering:pixelated}
.dsh-pet-sprite-runner-hint{font:700 11px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--dsw-alias-label-tertiary,#9a95a5);text-align:center;padding-top:7px}
@media (prefers-reduced-motion:reduce){.dsh-pet-sprite-plus{animation-duration:.4s}.dsh-pet-sprite-egg{animation-duration:.01s}.dsh-pet-sprite-egg canvas{animation:none}.dsh-pet-sprite-egg-hint{animation-duration:.01s}}
`
  document.head.appendChild(style)
}

const ChatPetImpl: FC = () => {
  const layerRef = useRef<HTMLDivElement>(null)
  const unitRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const eggCanvasRef = useRef<HTMLCanvasElement>(null)
  const eggRef = useRef<HTMLDivElement>(null)
  const ctlRef = useRef<HTMLSpanElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)
  // lets the component layer fire pet bubbles (the bubble lives in the
  // physics effect's closure)
  const sayRef = useRef<(text: string, wrap?: boolean) => void>(() => {})
  // lets the component layer fire particle bursts at the pet's position
  const burstRef = useRef<(opts?: { count?: number; color?: string }) => void>(() => {})
  // null until a companion is chosen: a quiet egg sits in the corner
  // instead — clicking it (never auto-popup) opens the picker
  const [petId, setPetId] = useState<string | null>(() => loadPetId())
  const [customPets, setCustomPets] = useState<CustomPet[]>(() => loadCustomPets())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const [eggHint, setEggHint] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>(() => loadChatHistory())
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatModel, setChatModel] = useState<ChatModel | null>(() => loadChatModel())
  const [profiles, setProfiles] = useState<Record<string, PetProfile>>(() => loadProfiles())
  // the pet's memories about the user: global (shared across companions),
  // kept fresh here for the panel and injected into chat/witness prompts
  const [memories, setMemories] = useState<PetMemory[]>(() => loadMemories())
  const [autoMemory, setAutoMemory] = useState<boolean>(() => autoExtractEnabled())
  const engine = getEngine()
  wireWitnessBus(engine, burstRef)

  // builtin or custom; null when the saved custom pet vanished from storage
  const activePet = petId === null ? null : resolvePet(petId, customPets)
  // the active companion's soul; empty profile = all-default voice
  const activeProfile = (petId !== null ? profiles[petId] : undefined) ?? EMPTY_PROFILE
  // live mirrors for the physics effect's closures (see comment there)
  const profileRef = useRef<PetProfile>(EMPTY_PROFILE as PetProfile)
  profileRef.current = activeProfile
  const chatModelRef = useRef<ChatModel | null>(chatModel)
  chatModelRef.current = chatModel
  const petNameRef = useRef('')
  petNameRef.current = activePet?.name ?? ''
  // workspace awareness state: the view feeds chat context and the panel
  const [workspace, setWorkspace] = useState<WorkspaceView>({ total: 0, currentTitle: '', recentTitles: [] })
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace

  // Pool speech entry point: every pet utterance flows through here.
  // Text events (chat replies, witness logs) call sayRef directly —
  // those carry dynamic content, not pool lines.
  const speakPool = (key: LineKey): void => {
    sayRef.current(speakLine(profileRef.current, key, { name: petNameRef.current }))
  }

  const handlePick = (id: string): void => {
    savePetId(id)
    setPickerOpen(false)
    setPetId(id)
  }
  const openPicker = (): void => {
    setPanelOpen(false)
    setPickerOpen(true)
  }

  // styles must exist before the egg renders too (first launch has no
  // petId, and the petId effect below would otherwise never inject them)
  useEffect(() => { injectStyles() }, [])

  // zero-config model: when the user never picked a chat model, adopt the
  // DSH default (agentDefaultModel service, surfaced by the /models route)
  // so chat + generation work out of the box; an explicit choice in the
  // care panel always wins and persists
  useEffect(() => {
    if (loadChatModel() !== null) return
    let done = false
    void (async () => {
      try {
        const res = await fetch('/plugins/dsh-pet-sprite/models')
        if (!res.ok) return
        const data = await res.json().catch(() => ({})) as { default?: { provider?: string; model?: string } }
        const d = data.default
        if (done || d === undefined || typeof d.provider !== 'string' || typeof d.model !== 'string') return
        if (d.provider.length === 0 || d.model.length === 0) return
        // only adopt when nothing was picked meanwhile (user raced us)
        if (loadChatModel() !== null) return
        const m: ChatModel = { provider: d.provider, model: d.model }
        saveChatModel(m)
        setChatModel(m)
      } catch { /* server hiccup: stay unconfigured, panel guides the pick */ }
    })()
    return () => { done = true }
  }, [])

  // workspace tracker: a real session switch fires the pet's "changed
  // work site" line (throttled — flipping through the session list must
  // not machine-gun bubbles)
  useEffect(() => {
    let lastSwitchAt = 0
    return trackWorkspace(
      (view) => { setWorkspace(view) },
      () => {
        const now = Date.now()
        if (now - lastSwitchAt < 30_000) return
        lastSwitchAt = now
        speakPool('switch')
      },
    )
  }, [])

  // one companion chat round-trip: append the user turn, POST to the
  // plugin's node route, surface the reply as both a history row and a
  // pet bubble. Errors are shown inline, never swallowed.
  const handleChatSend = async (text: string): Promise<void> => {
    if (activePet === null || chatBusy) return
    setChatError(null)
    setChatHistory(prev => {
      const next = [...prev, { role: 'user' as const, text }]
      saveChatHistory(next)
      return next
    })
    const model = chatModelRef.current
    if (model === null) {
      setChatError('还没有选择聊天模型：在照顾面板 → 设置 里选一个再试。')
      return
    }
    setChatBusy(true)
    speakPool('think')
    try {
      const history = [...chatHistory, { role: 'user' as const, text }]
        .map(t => ({ role: t.role === 'user' ? 'user' as const : 'assistant' as const, content: t.text }))
      const res = await fetch('/plugins/dsh-pet-sprite/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          petName: activePet.name,
          message: text,
          history: history.slice(0, -1),
          provider: model.provider,
          model: model.model,
          lang: navigator.language,
          persona: activeProfile.persona,
          workspace: { current: workspace.currentTitle, recent: workspace.recentTitles },
          memories: memoryTexts(10),
          petState: engine.getStats(),
        }),
      })
      const data = await res.json().catch(() => ({})) as { reply?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const reply = data.reply ?? ''
      setChatHistory(prev => {
        const next = [...prev, { role: 'pet' as const, text: reply }]
        saveChatHistory(next)
        return next
      })
      sayRef.current(reply.length > 150 ? `${reply.slice(0, 150)}…` : reply, true)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
      speakPool('error')
    } finally {
      setChatBusy(false)
    }
  }

  // custom-companion generation: the node route draws a validated 24x28
  // grid; coins are spent only after a usable sprite came back, and a
  // failed save refunds them so wallet and pet list never disagree.
  // in-flight guard lives here (not in the panel) because closing and
  // reopening the care panel would otherwise lose the busy state and
  // allow a second concurrent LLM call + coin spend.
  const generateInFlightRef = useRef(false)
  const handleGeneratePet = async (description: string): Promise<{ ok: boolean; name?: string; error?: string }> => {
    if (generateInFlightRef.current) return { ok: false, error: '正在生成中，稍等一下。' }
    const model = chatModelRef.current
    if (model === null) {
      return { ok: false, error: '还没有选择模型：先在上方「聊天模型」里选一个。' }
    }
    // the first custom companion is free — the picker's egg-time entry
    // would otherwise be a dead end for a brand-new user (login coins
    // start at ~5-10, far below 100)
    const wallet = engine.shop.getWallet()
    const firstFree = loadCustomPets().length === 0
    const GENERATE_COST = firstFree ? 0 : 100
    if (!firstFree && wallet.coins < GENERATE_COST) {
      return { ok: false, error: `星币不够：需要 ${GENERATE_COST}，当前只有 ${wallet.coins}。` }
    }
    generateInFlightRef.current = true
    try {
      const res = await fetch('/plugins/dsh-pet-sprite/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description,
          provider: model.provider,
          model: model.model,
          lang: navigator.language,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        name?: string; tagline?: string; rows?: string[]
        persona?: string; lines?: Record<string, string[]>; error?: string
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!Array.isArray(data.rows)) throw new Error('生成结果无效：模型没有返回像素网格。')
      if (GENERATE_COST > 0) {
        const spend = engine.shop.spendCoins(GENERATE_COST, 'pet_generation')
        if (!spend.ok) return { ok: false, error: '星币不够。' }
      }
      const pet: CustomPet = {
        id: `custom:${Date.now().toString(36)}`,
        name: (data.name ?? '').trim() || '小家伙',
        tagline: (data.tagline ?? '').trim(),
        rows: data.rows,
        createdAt: Date.now(),
      }
      if (!saveCustomPet(pet)) {
        if (GENERATE_COST > 0) engine.shop.earnCoins(GENERATE_COST, 'pet_generation_refund')
        return { ok: false, error: '保存失败：浏览器本地存储不可用。' }
      }
      // the newborn arrives fully voiced: the model returns a persona
      // plus event lines for every pool key, and parseProfile sanitizes
      // whatever shape it actually came in (missing keys just fall back
      // to the defaults). tagline seeds the persona when absent.
      const seed: PetProfile = parseProfile({
        persona: (data.persona ?? '').trim() || pet.tagline,
        lines: data.lines,
      })
      if (seed.persona.length > 0 || Object.keys(seed.lines).length > 0) {
        saveProfile(pet.id, seed)
        setProfiles(prev => ({ ...prev, [pet.id]: seed }))
      }
      setCustomPets(loadCustomPets())
      savePetId(pet.id)
      setPetId(pet.id)
      // the petId change tears down and remounts the physics effect,
      // whose cleanup removes any live bubble — speak only after the new
      // effect is up, or the greeting vanishes in the same frame
      setTimeout(() => { speakPool('intro') }, 350)
      return { ok: true, name: pet.name }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      generateInFlightRef.current = false
    }
  }

  // memory extraction: every EXTRACT_EVERY completed tasks (and inside
  // the daily cap) the pet quietly rereads the visible conversation
  // window and asks its model for 0-2 new facts about the user. This is
  // background witnessing — failures stay silent, and a model answer of
  // "nothing worth remembering" is a normal outcome, not an error.
  const memoryInFlightRef = useRef(false)
  const maybeExtractMemory = (): void => {
    if (memoryInFlightRef.current || !autoExtractEnabled()) return
    const model = chatModelRef.current
    if (model === null || !takeExtractSlot()) return
    const nodes = document.querySelectorAll('[data-chat-flow-key]')
    const parts: string[] = []
    for (let i = Math.max(0, nodes.length - 10); i < nodes.length; i++) {
      const el = nodes[i]
      const who = el.matches('[data-chat-flow-kind="user"]') || el.querySelector('[data-chat-flow-kind="user"]') !== null
        ? 'User'
        : 'Assistant'
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      if (text.length > 0) parts.push(`${who}: ${text}`)
    }
    const recentText = parts.join('\n').slice(0, 4000)
    if (recentText.trim().length === 0) return
    memoryInFlightRef.current = true
    void (async () => {
      try {
        const res = await fetch('/plugins/dsh-pet-sprite/memory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            petName: petNameRef.current,
            persona: profileRef.current.persona,
            lang: navigator.language,
            provider: model.provider,
            model: model.model,
            recentText,
            existing: memoryTexts(15),
          }),
        })
        const data = await res.json().catch(() => ({})) as { memories?: string[]; error?: string }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        const fresh = Array.isArray(data.memories) ? data.memories : []
        if (fresh.length > 0) {
          setMemories(addMemories(fresh, workspaceRef.current.currentTitle))
          speakPool('memory')
        }
      } catch { /* background witnessing: never surface errors */ }
      finally { memoryInFlightRef.current = false }
    })()
  }

  // profile edits come from the care panel: either a new persona text or a
  // whole lines pool; persist per-pet and refresh state
  const handleProfileChange = (patch: Partial<PetProfile>): void => {
    if (petId === null) return
    const next: PetProfile = {
      persona: patch.persona !== undefined ? patch.persona : activeProfile.persona,
      lines: patch.lines !== undefined ? patch.lines : activeProfile.lines,
    }
    saveProfile(petId, next)
    setProfiles(prev => ({ ...prev, [petId]: next }))
  }

  // share-file import: validation happens in custom-pets (same fixGrid the
  // node route uses); here we persist sprite + soul, refresh the picker
  // list, and switch to the newcomer — free of charge, unlike generation.
  const handleImportPet = (text: string): { ok: boolean; name?: string; error?: string } => {
    const r = importFromText(text)
    if ('error' in r) return { ok: false, error: r.error }
    if (!saveCustomPet(r.pet)) return { ok: false, error: '保存失败：浏览器本地存储不可用。' }
    saveProfile(r.pet.id, r.profile)
    setProfiles(prev => ({ ...prev, [r.pet.id]: r.profile }))
    setCustomPets(loadCustomPets())
    savePetId(r.pet.id)
    setPetId(r.pet.id)
    return { ok: true, name: r.pet.name }
  }

  // pre-hatch egg sprite: redraw on every remount (the egg unmounts
  // while the picker overlay is open and comes back after close)
  useEffect(() => {
    if (petId || pickerOpen) return
    const cv = eggCanvasRef.current
    if (cv) drawPet(cv, EGG_ROWS)
  }, [petId, pickerOpen])

  // dock the egg beside the sidebar's Settings trigger (bottom-left of
  // the screen). The trigger has no stable data attribute, so we take
  // the bottom-left-most button[aria-haspopup="dialog"]; a slow poll
  // keeps the dock correct when the sidebar toggles rail/wide.
  useEffect(() => {
    if (petId || pickerOpen) return
    const egg = eggRef.current
    if (!egg) return
    const place = (): void => {
      let best: DOMRect | null = null
      for (const b of document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')) {
        const r = b.getBoundingClientRect()
        if (r.width === 0 || r.bottom < window.innerHeight * 0.6 || r.left > window.innerWidth * 0.35) continue
        if (!best || r.bottom > best.bottom || (r.bottom === best.bottom && r.left < best.left)) best = r
      }
      if (best) {
        egg.style.left = `${Math.round(best.right + 10)}px`
        egg.style.bottom = `${Math.round(window.innerHeight - best.bottom)}px`
      } else {
        egg.style.left = '58px'
        egg.style.bottom = '14px'
      }
    }
    place()
    const iv = setInterval(place, 1500)
    window.addEventListener('resize', place)
    return () => { clearInterval(iv); window.removeEventListener('resize', place) }
  }, [petId, pickerOpen])

  // one-off hint bubble ("knock knock?") a few seconds after first
  // launch — discoverable without being intrusive, never repeats
  useEffect(() => {
    if (petId) return
    const t1 = setTimeout(() => setEggHint(true), 4500)
    const t2 = setTimeout(() => setEggHint(false), 11000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [petId])

  useEffect(() => {
    if (activePet === null) return
    const art: Frames = activePet.frames
    // capture by value: the closures below (tick) must not re-check null
    const idleLines = activePet.idleLines
    // event lines: profile pools override the defaults; custom idle lines
    // join the built-in ambient chatter instead of replacing it. read
    // through a ref so care-panel edits apply live without restarting the
    // physics loop (which would teleport the pet back to spawn)
    const ambientIdle = (): readonly string[] =>
      [...DEFAULT_LINES.idle, ...idleLines, ...(profileRef.current.lines.idle ?? [])]
    injectStyles()
    const layer = layerRef.current
    const unit = unitRef.current
    const cv = canvasRef.current
    const ctlHint = ctlRef.current
    const statusBar = statusRef.current
    if (!layer || !unit || !cv) return

    // gameplay engine: ticks attribute decay, bridges DSH chat events
    engine.start()
    engine.onLogin()
    // one-time teasers: read the persisted "already seen" flags once per
    // mount (markTeaserSeen persists, the flags below decide this mount)
    const teasersSeen = loadTeasersSeen()
    // status pill = text + a persistent pixel-coin canvas (textContent
    // would wipe the canvas, so updates go through replaceChildren)
    const coinCv = document.createElement('canvas')
    coinCv.width = 24; coinCv.height = 24
    coinCv.style.cssText = 'width:9px;height:9px;image-rendering:pixelated;vertical-align:-1px;margin-left:3px'
    drawIcon(coinCv, ICONS.coin)
    function renderStatus(): void {
      const s = engine.getStats()
      if (!statusBar) return
      statusBar.replaceChildren(
        document.createTextNode(`Lv.${s.level} ${s.title}`),
        coinCv,
        document.createTextNode(String(s.coins)),
      )
    }
    // the pill is a one-time teaser: shown only while the user has never
    // seen it, for 10s after the pet appears, then never again (persisted
    // across reloads and companion switches) — the care panel (right-click)
    // owns the stats afterwards, and the chat area stays clean
    let statusTimer: ReturnType<typeof setInterval> | undefined
    let statusHideTimer: ReturnType<typeof setTimeout> | undefined
    if (!teasersSeen.status) {
      markTeaserSeen('status')
      statusTimer = setInterval(renderStatus, 2500)
      renderStatus()
      statusHideTimer = setTimeout(() => {
        if (statusBar) statusBar.style.display = 'none'
        clearInterval(statusTimer)
      }, 10_000)
    } else if (statusBar) {
      statusBar.style.display = 'none'
    }

    // DSH bridges: user message → power drain; assistant done → EXP
    // (every turn also lands in the daily work journal)
    let lastUserCount = document.querySelectorAll('[data-chat-flow-kind="user"]').length
    let wasStreaming = !!document.querySelector('[data-streaming]')
    function bridgeChat(): void {
      const users = document.querySelectorAll('[data-chat-flow-kind="user"]')
      if (users.length > lastUserCount) {
        const last = users[users.length - 1]
        const text = last.textContent ?? ''
        engine.onUserMessage(text)
        recordTurn(text.length)
      }
      lastUserCount = users.length
      const streaming = !!document.querySelector('[data-streaming]')
      if (!wasStreaming && streaming && users.length > 0) say(speakLine(profileRef.current, 'work'))
      if (wasStreaming && !streaming) {
        const nodes = document.querySelectorAll('[data-chat-flow-key]')
        const lastNode = nodes[nodes.length - 1]
        const outLen = lastNode?.textContent?.length ?? 0
        engine.onAssistantDone(outLen)
        recordTask(outLen)
        if (users.length > 0) {
          // agent error detection: if the last message contains error
          // indicators, the pet reacts once — a natural empathy moment,
          // not a proactive notification
          const hasError = lastNode?.querySelector('[data-error], .error, [data-chat-flow-kind="error"]') !== null
          say(speakLine(profileRef.current, hasError ? 'error' : 'done'))
        }
        // memory extraction paces off completed tasks: every Nth one
        // (daily-capped) quietly rereads the visible conversation
        if (bumpTaskCounter()) maybeExtractMemory()
      }
      wasStreaming = streaming
    }

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    // physics constants, kept identical to the original game
    const G = 1500, WALK = 58, CLIMBV = 85, SKILLV = 780, JUMPV = 420, PW = 48
    let x = 16, h = 0, vy = 0, dir = 1
    let state: 'ground' | 'air' | 'climb' = 'ground'
    let plat: Platform | null = null
    let goal: { x: number; jump?: Platform } | null = null
    let climb: { x: number; top: number; p: Platform } | null = null
    let ft = 0, ftAcc = 0, lastFrame: string[] | null = null, lastT = 0, planAt = 0
    let landings: Landing[] = []   // landable platforms ONLY: user bubbles + composer
    let platsAt = 0
    let mode: PetMode = 'idle'
    // attribute levels, polled in the tick loop for visual state feedback
    let petMoodLevel = 'normal', petPowerLevel = 'normal', petHealthLevel = 'normal'
    let floorX = 0, floorY = 0, visible = false

    // player control: click chat background to take over, 10s idle hands back
    const keys: Record<string, boolean> = {}
    let playerCtl = false, lastKeyAt = 0, airJumped = false, dropP: Platform | null = null, moving = false

    // chat bubble + drag-and-drop state
    let bubbleEl: HTMLDivElement | null = null
    let bubbleTimer: ReturnType<typeof setTimeout> | undefined
    let nextChatAt = 0
    let dragging = false, dragMoved = false, dragId = -1
    let dragX = 0, dragY = 0

    function playground(): DOMRect | null {
      const el = document.querySelector('[data-conversation-scroll]')
      const r = el?.getBoundingClientRect()
      if (!r || r.height < 200 || r.width < 240) return null
      return r
    }
    function scanPlats(): void {
      const fr = playground()
      if (!fr) { landings = []; return }
      const land: Landing[] = []
      const els = document.querySelectorAll('[data-chat-flow-key]')
      for (let i = Math.max(0, els.length - 30); i < els.length; i++) {
        const el = els[i]
        // only USER bubbles are landable — assistant text stays readable
        // (the pet never stands on the agent's answers)
        const isUser = el.matches('[data-chat-flow-kind="user"]')
          || el.querySelector('[data-chat-flow-kind="user"]') !== null
        if (!isUser) continue
        const r = el.getBoundingClientRect()
        if (r.width < 70 || r.bottom < 20 || r.top <= 0 || r.top >= fr.bottom - 24) continue
        land.push({ x1: r.left - fr.left, x2: r.right - fr.left, y: fr.bottom - 4 - r.top, kind: 'user' })
      }
      // the composer card (输入框) is a wide, stable platform near the bottom
      const comp = document.querySelector('[data-composer-card]')
      if (comp) {
        const r = comp.getBoundingClientRect()
        if (r.width >= 100 && r.top > 20) {
          land.push({ x1: r.left - fr.left, x2: r.right - fr.left, y: fr.bottom - 4 - r.top, kind: 'composer' })
        }
      }
      landings = land
    }
    function support(): boolean {
      if (!plat) return true
      // 支撑判定只认可落脚平台：assistant 气泡「消失/滚动」后宠物会掉下去，
      // 而不是悬空站在文字上
      for (const p of landings) {
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
    // 藤蔓元素：攀爬时从地面长到平台顶，宠物贴着往上爬
    let vineEl: HTMLDivElement | null = null
    function vineTo(topY: number, vx: number): void {
      if (!vineEnabled()) return   // 默认关闭：不开开关就不画藤蔓
      if (vineEl) vineEl.remove()
      const el = document.createElement('div')
      el.className = 'dsh-pet-sprite-vine'
      el.style.left = `${vx}px`
      el.style.height = `${Math.round(topY)}px`
      // layer 是全屏层：藤蔓底在地板线上（floorY = playground.bottom - 4）
      const vfr2 = playground()
      if (vfr2) el.style.bottom = `${Math.max(0, window.innerHeight - vfr2.bottom + 4)}px`
      else el.style.bottom = '4px'
      // 缠绕的小叶子
      for (let i = 0; i < Math.floor(topY / 34); i++) {
        const leaf = document.createElement('span')
        leaf.className = 'dsh-pet-sprite-vine-leaf'
        leaf.style.bottom = `${8 + i * 34 + Math.random() * 10}px`
        leaf.style.setProperty('--lf', i % 2 === 0 ? '1' : '-1')
        leaf.style.animationDelay = `${Math.random() * 0.5}s`
        el.appendChild(leaf)
      }
      layer.appendChild(el)
      vineEl = el
    }
    function vineClear(): void {
      if (vineEl) { vineEl.remove(); vineEl = null }
    }

    function startClimb(p: Platform): void {
      const edge = Math.abs(x - p.x1) < Math.abs(x - p.x2) ? p.x1 - 12 : p.x2 - PW + 12
      climb = { x: edge, top: p.y, p }
      goal = { x: edge }
      // 藤蔓从脚下长到目标平台顶（挂 world 层 layer：固定在攀爬点，不随宠物移动）
      const vfr = playground()
      if (vfr) vineTo(p.y, vfr.left + edge + 22)
    }
    function plan(now: number): void {
      planAt = now + 1200 + Math.random() * 1800
      // 上层目标只从可落脚平台（用户气泡/输入框）里选。
      // 藤蔓开启：高平台走藤蔓；关闭：只选跳得着的（大跳上限 202px，
      // 取 190px 余量）——够不着就当没看见，杜绝对着高处凭空跳。
      const maxUp = vineEnabled() ? 560 : 190
      const ups = landings.filter(p => p.y > h + 30 && p.y < h + maxUp)
      const r = Math.random()
      if (r < .34 || ups.length === 0) { goal = { x: 12 + Math.random() * Math.max(20, floorX - 76) }; return }
      const c = ups[Math.floor(Math.random() * ups.length)]
      if (c.y - h <= 200) { goal = { x: Math.max(c.x1, Math.min(c.x2 - PW, x)), jump: c } }
      else if (vineEnabled()) startClimb(c)   // 开了藤蔓才爬高墙
      else if (h > 0 && plat) goal = { x: Math.random() < .5 ? plat.x1 - 40 : plat.x2 + 8 }
    }
    // 落地扬尘：脚下喷出小土云（像素风，暖灰），强度随落速
    function dust(pv: number): void {
      if (still) return
      const speed = Math.abs(pv)
      const n = Math.min(7, 2 + Math.floor(speed / 160))
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span')
        s.className = 'dsh-pet-sprite-dust'
        // 左右对称喷洒，脚跟位置（unit 底部）
        const side = i % 2 === 0 ? -1 : 1
        s.style.left = `${22 + side * (3 + Math.random() * 9)}px`
        s.style.bottom = '0px'
        s.style.setProperty('--dx', `${side * (10 + Math.random() * 26)}px`)
        s.style.setProperty('--dy', `${-(4 + Math.random() * 14)}px`)
        s.style.setProperty('--ds', `${0.7 + Math.random() * 0.6}`)
        unit.appendChild(s)
        setTimeout(() => s.remove(), 550)
      }
    }

    // 头顶小星尘：紧凑的一小撮（头顶 12px 内），不再飞得又高又远
    function burst(opts?: { count?: number; color?: string }): void {
      if (still) return
      const count = opts?.count ?? 4
      const color = opts?.color ?? '#ffd33d'
      for (let i = 0; i < count; i++) {
        const s = document.createElement('span')
        s.className = 'dsh-pet-sprite-spark'
        s.style.left = `${20 + Math.random() * 12}px`
        s.style.top = `${-6 - h}px`
        s.style.background = color
        s.style.setProperty('--dx', `${Math.random() * 20 - 10}px`)
        s.style.setProperty('--dy', `${-(3 + Math.random() * 9)}px`)
        unit.appendChild(s)
        setTimeout(() => s.remove(), 480)
      }
    }
    burstRef.current = burst
    function say(text: string, wrap = false): void {
      if (bubbleEl) { bubbleEl.remove(); clearTimeout(bubbleTimer) }
      const el = document.createElement('div')
      el.className = wrap ? 'dsh-pet-sprite-bubble dsh-pet-sprite-bubble-wrap' : 'dsh-pet-sprite-bubble'
      el.textContent = text
      unit.appendChild(el)
      bubbleEl = el
      const dur = Math.max(2400, 1300 + text.length * 200)
      bubbleTimer = setTimeout(() => { el.remove(); if (bubbleEl === el) bubbleEl = null }, dur)
    }
    sayRef.current = say
    function typingField(): boolean {
      const a = document.activeElement
      if (!a) return false
      return !!(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable)
    }
    let ctlFadeTimer: ReturnType<typeof setTimeout> | undefined
    function showCtlHint(): void {
      // teach the keys exactly once, ever (persisted): the first takeover
      // shows the pill for 10s, every later interaction stays silent
      if (!ctlHint || ctlHintShown) return
      ctlHintShown = true
      markTeaserSeen('ctl')
      ctlHint.style.display = ''
      ctlHint.style.opacity = '1'
      clearTimeout(ctlFadeTimer)
      ctlFadeTimer = setTimeout(() => { if (ctlHint) ctlHint.style.opacity = '0' }, 10_000)
    }
    function setCtl(on: boolean): void {
      if (playerCtl === on) return
      playerCtl = on
      if (on) {
        if (ctlHint) ctlHint.textContent = '操控中：A/D 移动 · 空格 跳跃 · W 攀爬 · S 下落'
        showCtlHint()
        if (Math.random() < .6) say(speakLine(profileRef.current, 'ctl'))
      } else {
        clearTimeout(ctlFadeTimer)
        if (ctlHint) ctlHint.style.display = 'none'
        for (const k in keys) keys[k] = false
        planAt = lastT + 1500
      }
    }
    function tryClimbNear(): boolean {
      for (const p of landings) {   // 只能爬到可落脚的平台
        if (p.y < h + 30) continue
        const le = p.x1 - 12, re = p.x2 - PW + 12
        if (Math.abs(x - le) < 30) { climb = { x: le, top: p.y, p }; state = 'climb'; vineTo(p.y, le + 22); return true }
        if (Math.abs(x - re) < 30) { climb = { x: re, top: p.y, p }; state = 'climb'; vineTo(p.y, re + 22); return true }
      }
      return false
    }

    function frameFor(): string[] {
      if (dragging) return art.JP
      if (state === 'air') return art.JP
      if (state === 'climb') return ft % 2 ? art.KA : art.KB
      if (moving || (goal && Math.abs(goal.x - x) > 3)) {
        // starving pet shuffles slowly, no walk cycle
        if (petPowerLevel === 'starving') return art.I
        return ft % 4 < 2 ? art.KA : art.KB
      }
      if (mode === 'work') return ft % 6 < 3 ? art.WA : art.WB
      // sad pet blinks twice as often
      if (ft % (petMoodLevel === 'sad' ? 25 : 50) === 9) return art.BL
      // starving/sick pet slumps asleep more often
      if (petPowerLevel === 'starving' || petPowerLevel === 'hungry' || petHealthLevel === 'sick') {
        if (ft % 80 >= 64) return ft % 10 < 5 ? art.ZZ : art.B
      } else {
        if (ft % 140 >= 124) return ft % 10 < 5 ? art.ZZ : art.B
      }
      return ft % 10 < 5 ? art.I : art.B
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
        // poll attribute levels for visual state feedback in frameFor()
        { const s = engine.getStats(); petMoodLevel = s.moodLevel; petPowerLevel = s.powerLevel; petHealthLevel = s.healthLevel }
        bridgeChat()
        if (state === 'ground' && h > 0 && !support()) { state = 'air'; vy = 0; plat = null }
        // ambient chat: idle-only, low frequency, low-status lines win
        if (!playerCtl && !dragging && mode === 'idle' && state === 'ground') {
          if (nextChatAt === 0) nextChatAt = now + 15000 + Math.random() * 15000
          else if (now > nextChatAt) {
            const s = engine.getStats()
            say(s.power < 30 || s.mood < 30
              ? speakLine(profileRef.current, 'low')
              : pickLine(ambientIdle()))
            nextChatAt = now + 24000 + Math.random() * 20000
          }
        }
      }
      if (playerCtl && now - lastKeyAt > 10000) setCtl(false)
      moving = false
      if (dragging) {
        // carried by pointer: no physics, follow the hand, stay in bounds
        goal = null; climb = null; vy = 0; vineClear()
        x = Math.max(2, Math.min(floorX - 52, dragX - fr.left - PW / 2))
        h = Math.max(0, floorY - dragY)
      } else if (playerCtl) {
        goal = null
        if (keys.a) { x -= WALK * 1.7 * dt; dir = -1; moving = true }
        if (keys.d) { x += WALK * 1.7 * dt; dir = 1; moving = true }
        if (moving && state === 'climb') { state = 'air'; vy = 0; climb = null; vineClear() }
      } else if (mode !== 'idle') {
        goal = null; climb = null
        if (state === 'climb') { state = 'air'; vineClear() }
      }
      if (!dragging) {
        if (state === 'climb' && climb) {
          dir = climb.x > x ? 1 : (climb.x < x ? -1 : dir)
          if (Math.abs(climb.x - x) > 3) x += WALK * dt * (climb.x > x ? 1 : -1)
          else {
            h += CLIMBV * dt
            if (h >= climb.top) {
              h = climb.top; plat = climb.p
              x = Math.max(climb.p.x1 + 2, Math.min(climb.p.x2 - PW - 2, x))
              state = 'ground'; climb = null; goal = null
              vineClear(); dust(-200)   // 翻上平台：尘 + 藤蔓枯萎
            }
          }
        } else if (state === 'air') {
          h += vy * dt
          const pv = vy
          vy -= G * dt
          if (vy < 0) {
            // landing: user bubbles + composer ONLY — assistant 气泡永远落不住
            // （不阻挡文字显示），落空就掉到地板。凭空跳不复存在。
            for (const p of landings) {
              if (dropP && Math.abs(p.y - dropP.y) < 8) continue
              if (h <= p.y && h + ((pv > 0 ? pv : 0) - vy) * dt + 30 >= p.y && x + PW / 2 > p.x1 - 4 && x + PW / 2 < p.x2 + 4 && p.y > 2) {
                h = p.y; vy = 0; state = 'ground'; plat = p; goal = null; dropP = null; airJumped = false; dust(pv)   // 落地扬尘
                break
              }
            }
          }
          if (h <= 0) { h = 0; vy = 0; state = 'ground'; plat = null; dropP = null; airJumped = false; dust(pv) }
        } else if (goal) {
          dir = goal.x > x + 2 ? 1 : (goal.x < x - 2 ? -1 : dir)
          if (Math.abs(goal.x - x) > 3) x += WALK * dt * dir
          else if (goal.jump) { const j = goal.jump; goal = null; jumpTo(j) }
          else goal = null
        } else if (!playerCtl && mode === 'idle' && state === 'ground' && now > planAt) plan(now)
        if (!playerCtl && state === 'ground' && mode !== 'idle' && h > 0) { state = 'air'; vy = 0 }
      }
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
      if ((t as Element).closest('.dsh-pet-sprite-unit,a,button,input,textarea,select,label,[role="button"],[contenteditable]')) return
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
      // only light the hint on fresh presses; OS key-repeat would keep
      // resetting the fade timer and pin the pill while walking
      if (!e.repeat) showCtlHint()
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

    // drag-and-drop: hold left button on the pet, move to pick it up,
    // release anywhere to drop it (falls with gravity onto platforms)
    const onUnitPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      dragMoved = false
      dragId = e.pointerId
      dragX = e.clientX
      dragY = e.clientY
      try { unit.setPointerCapture(dragId) } catch { /* not fatal */ }
    }
    const onUnitPointerMove = (e: PointerEvent): void => {
      if (e.pointerId !== dragId) return
      if (!dragMoved) {
        const dx = e.clientX - dragX, dy = e.clientY - dragY
        if (Math.hypot(dx, dy) < 6) return
        dragMoved = true
        dragging = true
        unit.classList.add('dsh-pet-sprite-dragging')
        if (Math.random() < .5) say(speakLine(profileRef.current, 'drag'))
      }
      dragX = e.clientX
      dragY = e.clientY
    }
    const onUnitPointerUp = (e: PointerEvent): void => {
      if (e.pointerId !== dragId) return
      dragId = -1
      try { unit.releasePointerCapture(e.pointerId) } catch { /* not fatal */ }
      if (dragging) {
        dragging = false
        unit.classList.remove('dsh-pet-sprite-dragging')
        // hand over to physics: free fall from the release point
        state = 'air'
        vy = 0
        plat = null
        climb = null
        goal = null
        dropP = null
        airJumped = false
      }
    }

    const onClickPet = (): void => {
      if (dragMoved) { dragMoved = false; return }
      // left click opens the side chat box beside the pet (no jump)
      const r = unit.getBoundingClientRect()
      setAnchor({ x: r.left, y: r.top + r.height })
      setChatOpen(true)
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
    unit.addEventListener('pointerdown', onUnitPointerDown)
    unit.addEventListener('pointermove', onUnitPointerMove)
    unit.addEventListener('pointerup', onUnitPointerUp)
    unit.addEventListener('pointercancel', onUnitPointerUp)
    if (ctlHint) ctlHint.style.display = 'none'

    drawPet(cv, art.I)
    if (!still) requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(tick) })
    else {
      // reduced motion: still draw frames slowly, no physics takeover
      const slow = setInterval(() => { ft++; const f = frameFor(); if (f !== lastFrame) { lastFrame = f; drawPet(cv, f) } }, 320)
      return () => {
        clearInterval(slow)
        clearInterval(statusTimer)
        clearTimeout(statusHideTimer)
        clearTimeout(ctlFadeTimer)
        clearTimeout(bubbleTimer)
        bubbleEl?.remove()
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('keyup', onKeyUp, true)
        window.removeEventListener('blur', onBlur)
        unit.removeEventListener('click', onClickPet)
        unit.removeEventListener('contextmenu', onContextMenu)
        unit.removeEventListener('pointerdown', onUnitPointerDown)
        unit.removeEventListener('pointermove', onUnitPointerMove)
        unit.removeEventListener('pointerup', onUnitPointerUp)
        unit.removeEventListener('pointercancel', onUnitPointerUp)
      }
    }
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(ctlFadeTimer)
      clearTimeout(bubbleTimer)
      bubbleEl?.remove()
      clearInterval(statusTimer)
      clearTimeout(statusHideTimer)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      unit.removeEventListener('click', onClickPet)
      unit.removeEventListener('contextmenu', onContextMenu)
      unit.removeEventListener('pointerdown', onUnitPointerDown)
      unit.removeEventListener('pointermove', onUnitPointerMove)
      unit.removeEventListener('pointerup', onUnitPointerUp)
      unit.removeEventListener('pointercancel', onUnitPointerUp)
      vineClear()
      if (vineEl) { vineEl.remove(); vineEl = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId])

  // mini runner: double-click the pet (or the care panel's play button) for
  // a 45s play break. Coins earned land in the shop wallet; mood gets a
  // play bump through the same speakPool/burst the panel uses.
  const runnerBusyRef = useRef(false)
  const startRunner = (): void => {
    if (runnerBusyRef.current || activePet === null) return
    runnerBusyRef.current = true
    void runRunnerGame(activePet.frames, n => {
      if (n <= 0) return
      engine.shop.earnCoins(n, 'runner_game')
      speakPool('play')
      burst({ count: 5, color: '#ffd33d' })
    }).then(result => {
      if (result.score > 0) {
        sayRef.current(`跑酷结束！${result.score} 分${result.coins > 0 ? `，赚了 ${result.coins} 星币` : ''}。`)
      }
      runnerBusyRef.current = false
    }).catch(() => { runnerBusyRef.current = false })
  }

  return (
    <div ref={layerRef} className="dsh-pet-sprite-layer">
      {activePet !== null && (
        <div
          ref={unitRef}
          className="dsh-pet-sprite-unit"
          title={`${activePet.name}（左键聊天 · 右键照顾面板 · 双击玩跑酷）`}
          onDoubleClick={startRunner}
        >
          <span ref={ctlRef} className="dsh-pet-sprite-ctl" />
          <canvas ref={canvasRef} width={96} height={112} />
          <span ref={statusRef} className="dsh-pet-sprite-status" />
        </div>
      )}
      {activePet === null && !pickerOpen && (
        <div
          ref={eggRef}
          className="dsh-pet-sprite-egg"
          title="点一点，看看谁在里面"
          onClick={() => setPickerOpen(true)}
        >
          <canvas ref={eggCanvasRef} width={96} height={112} />
          {eggHint && <span className="dsh-pet-sprite-egg-hint">咔……咔？</span>}
        </div>
      )}
      {activePet !== null && panelOpen && (
        <CarePanel
          engine={engine}
          anchor={anchor}
          customCount={customPets.length}
          petName={activePet.name}
          chatModel={chatModel}
          profile={activeProfile}
          onProfileChange={handleProfileChange}
          onGeneratePet={handleGeneratePet}
          onImportPet={handleImportPet}
          onPetSay={(text) => sayRef.current(text, true)}
          onSpeakPool={speakPool}
          onBurst={(opts) => burstRef.current(opts)}
          onPlayRunner={startRunner}
          onSwitchPet={openPicker}
          memories={memories}
          onRemoveMemory={(id) => { setMemories(removeMemory(id)) }}
          autoMemory={autoMemory}
          vineClimb={vineEnabled()}
          onVineClimbChange={(on) => { setVineEnabled(on) }}
          onAutoMemoryChange={(on) => { setAutoExtract(on); setAutoMemory(on) }}
          workspace={workspace}
          onChatModelChange={m => { setChatModel(m); saveChatModel(m) }}
          onClose={() => setPanelOpen(false)}
        />
      )}
      {activePet !== null && chatOpen && (
        <PetChatBox
          petName={activePet.name}
          anchor={anchor}
          model={chatModel}
          history={chatHistory}
          busy={chatBusy}
          error={chatError}
          onSend={text => { void handleChatSend(text) }}
          onClear={() => { setChatHistory([]); saveChatHistory([]) }}
          onClose={() => setChatOpen(false)}
        />
      )}
      {pickerOpen && (
        <PetPicker
          currentId={petId}
          customPets={customPets}
          profiles={profiles}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
          onGeneratePet={handleGeneratePet}
          firstGenerateFree={customPets.length === 0}
        />
      )}
    </div>
  )
}

// ── hydration gate ──────────────────────────────────────────────────────────
// Cross-device sync hydrates localStorage from the server before the pet
// mounts (the pet reads localStorage synchronously in its useState
// initializers). This wrapper delays the first render until hydration
// settles — with a hard timeout (a dead server must not hide the pet).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GatedChatPet: FC = (props: any) => {
  const [ready, setReady] = useState(isSyncReady)
  useEffect(() => {
    if (ready) return
    let done = false
    whenSyncReady().then(() => { if (!done) { done = true; setReady(true) } })
    const t = setTimeout(() => { if (!done) { done = true; setReady(true) } }, 4000)
    return () => { done = true; clearTimeout(t) }
  }, [ready])
  if (!ready) return null
  return <ChatPetImpl {...props} />
}
export { GatedChatPet as ChatPet }
