// Daily work journal — the pet is the witness of the developer's day.
// One record per LOCAL date in localStorage: chat turns, character
// throughput, care actions, level-ups. The care panel turns a day record
// into an LLM-written log entry in the pet's voice (node route /witness),
// which pays a once-per-day coin reward. Records prune to the newest 14.

const KEY = 'dshPetSpriteWitness:days'
const KEEP_DAYS = 14

/** What the pet saw on one local date. */
export interface WitnessDay {
  date: string
  /** User messages sent to the agent. */
  turns: number
  /** Assistant completions finished. */
  tasks: number
  /** Characters the user typed. */
  inChars: number
  /** Characters the agent produced. */
  outChars: number
  /** Timestamps of first / latest recorded activity (ms). */
  firstAt: number
  lastAt: number
  /** Any activity between 00:00 and 05:00 local. */
  night: boolean
  feed: number
  play: number
  rest: number
  levelUps: number
  /** Coins for this day's log entry already claimed. */
  rewarded?: boolean
  /** Last generated log text (shown until regenerated). */
  lastLog?: string
}

function dateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyDay(date: string): WitnessDay {
  return { date, turns: 0, tasks: 0, inChars: 0, outChars: 0, firstAt: 0, lastAt: 0, night: false, feed: 0, play: 0, rest: 0, levelUps: 0 }
}

function loadAll(): Record<string, WitnessDay> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, WitnessDay> : {}
  } catch {
    return {}
  }
}

function saveAll(all: Record<string, WitnessDay>): void {
  try {
    // prune: keep only the newest KEEP_DAYS date keys
    const keys = Object.keys(all).sort().slice(-KEEP_DAYS)
    const pruned: Record<string, WitnessDay> = {}
    for (const k of keys) pruned[k] = all[k]
    localStorage.setItem(KEY, JSON.stringify(pruned))
  } catch {
    /* storage unusable — the journal is best-effort */
  }
}

/**
 * Mutate today's record through fn and persist. `touch` stamps the
 * activity window; readers (log text, reward flag) pass false so opening
 * the panel at night does not fake a work session.
 */
function update(fn: (day: WitnessDay) => void, touch = true): void {
  const all = loadAll()
  const key = dateKey()
  const day = all[key] ?? emptyDay(key)
  fn(day)
  if (touch) {
    const now = Date.now()
    day.lastAt = now
    if (day.firstAt === 0) day.firstAt = now
    if (new Date().getHours() < 5) day.night = true
  }
  all[key] = day
  saveAll(all)
}

/** Today's record (a zero record when nothing happened yet). */
export function getWitnessDay(): WitnessDay {
  const key = dateKey()
  const all = loadAll()
  return all[key] ?? emptyDay(key)
}

/** One user message went out to the agent. */
export function recordTurn(inChars: number): void {
  update(d => { d.turns++; d.inChars += Math.max(0, Math.floor(inChars)) })
}

/** One assistant completion landed. */
export function recordTask(outChars: number): void {
  update(d => { d.tasks++; d.outChars += Math.max(0, Math.floor(outChars)) })
}

/** One care interaction happened (feed / play / rest). */
export function recordCare(kind: 'feed' | 'play' | 'rest'): void {
  update(d => { d[kind]++ })
}

/** The companion leveled up. */
export function recordLevelUp(): void {
  update(d => { d.levelUps++ })
}

/** Cache the generated log text on today's record (no activity touch). */
export function saveLogText(text: string): void {
  update(d => { d.lastLog = text }, false)
}

/** Claim today's once-per-day log reward; false when already claimed. */
export function claimLogReward(): boolean {
  if (getWitnessDay().rewarded === true) return false
  update(d => { d.rewarded = true }, false)
  return true
}
