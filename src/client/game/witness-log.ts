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

// ─── weekly rollup ──────────────────────────────────────────────────────────

const WEEK_KEY = 'dshPetSpriteWitness:week'

/** One week of witnessed work: the last 7 days including today. */
export interface WitnessWeek {
  /** Local date keys of the covered days (oldest first). */
  dates: string[]
  /** Days with any recorded activity. */
  activeDays: number
  turns: number
  tasks: number
  inChars: number
  outChars: number
  /** Days that had past-midnight activity. */
  nights: number
  feed: number
  play: number
  rest: number
  levelUps: number
  /** Total minutes between the week's first and last recorded activity. */
  spanMinutes: number
}

/** The last 7 daily records, zero-filled for days nothing happened. */
export function getWitnessDays(count = 7): WitnessDay[] {
  const all = loadAll()
  const out: WitnessDay[] = []
  for (let i = count - 1; i >= 0; i--) {
    const key = dateKey(new Date(Date.now() - i * 86_400_000))
    out.push(all[key] ?? emptyDay(key))
  }
  return out
}

/** Aggregate the last 7 days into one week rollup. */
export function getWitnessWeek(): WitnessWeek {
  const days = getWitnessDays(7)
  const week: WitnessWeek = {
    dates: days.map(d => d.date), activeDays: 0,
    turns: 0, tasks: 0, inChars: 0, outChars: 0, nights: 0,
    feed: 0, play: 0, rest: 0, levelUps: 0, spanMinutes: 0,
  }
  let firstAt = 0, lastAt = 0
  for (const d of days) {
    const active = d.turns > 0 || d.tasks > 0 || d.feed > 0 || d.play > 0 || d.rest > 0 || d.levelUps > 0
    if (active) week.activeDays++
    week.turns += d.turns
    week.tasks += d.tasks
    week.inChars += d.inChars
    week.outChars += d.outChars
    if (d.night) week.nights++
    week.feed += d.feed
    week.play += d.play
    week.rest += d.rest
    week.levelUps += d.levelUps
    if (d.firstAt > 0 && (firstAt === 0 || d.firstAt < firstAt)) firstAt = d.firstAt
    if (d.lastAt > lastAt) lastAt = d.lastAt
  }
  week.spanMinutes = lastAt > firstAt ? Math.round((lastAt - firstAt) / 60000) : 0
  return week
}

/** Weekly log cache: { weekStart, lastLog, rewarded } keyed by the week's Monday. */
interface WeekCache {
  weekStart: string
  lastLog?: string
  rewarded?: boolean
}

/** Monday of the current local week, as a date key. */
function weekStartKey(): string {
  const d = new Date()
  const back = (d.getDay() + 6) % 7 // Monday=0
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back))
}

function loadWeek(): WeekCache {
  try {
    const v = JSON.parse(localStorage.getItem(WEEK_KEY) ?? 'null') as WeekCache | null
    if (v !== null && typeof v === 'object' && v.weekStart === weekStartKey()) return v
  } catch { /* fall through */ }
  return { weekStart: weekStartKey() }
}

function saveWeek(cache: WeekCache): void {
  try { localStorage.setItem(WEEK_KEY, JSON.stringify(cache)) } catch { /* best-effort */ }
}

/** This week's cached log text, if one was generated. */
export function getWeekLog(): string | null {
  return loadWeek().lastLog ?? null
}

/** Cache the generated weekly log text (does not count as activity). */
export function saveWeekLogText(text: string): void {
  const c = loadWeek()
  c.lastLog = text
  saveWeek(c)
}

/** Claim this week's once-per-week reward; false when already claimed. */
export function claimWeekReward(): boolean {
  const c = loadWeek()
  if (c.rewarded === true) return false
  c.rewarded = true
  saveWeek(c)
  return true
}
