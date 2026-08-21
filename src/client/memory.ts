// The pet's own memory of its owner: short facts distilled from DSH
// conversations by the /memory node route (the LLM sees a recent chat
// window plus what is already remembered, and answers with 0-2 new
// facts in the pet's voice). Memories are GLOBAL — facts about the
// owner belong to the workspace, so every companion shares them, and
// switching pets never forgets. Everything stays in localStorage.

/** One remembered fact about the owner, in the pet's voice. */
export interface PetMemory {
  id: string
  /** The fact itself, ≤ 60 chars, pet's perspective ("主人这周在重构支付模块"). */
  text: string
  /** Display title of the session the fact came from. */
  sessionTitle: string
  createdAt: number
}

/** Cap on stored memories; oldest are dropped when full (LRU). */
export const MEMORY_LIMIT = 30
/** Longest text kept per memory; the prompt asks for ≤ 40. */
const MAX_TEXT = 60
const KEY = 'dshPetSpriteMemory:items'
/** Daily cap on automatic extractions (each one is an LLM round trip). */
const DAILY_KEY = 'dshPetSpriteMemory:daily'
/** Tasks-completed counter: extraction fires every N completions. */
export const EXTRACT_EVERY = 5
export const DAILY_EXTRACT_LIMIT = 8
const COUNTER_KEY = 'dshPetSpriteMemory:counter'
/** Auto-extraction toggle (default on). */
const AUTO_KEY = 'dshPetSpriteMemory:auto'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sanitize(raw: unknown): PetMemory | null {
  if (raw === null || typeof raw !== 'object') return null
  const m = raw as Partial<PetMemory>
  const text = typeof m.text === 'string' ? m.text.trim().slice(0, MAX_TEXT) : ''
  if (text.length === 0) return null
  return {
    id: typeof m.id === 'string' && m.id.length > 0 ? m.id : `mem:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
    text,
    sessionTitle: typeof m.sessionTitle === 'string' ? m.sessionTitle.slice(0, 40) : '',
    createdAt: typeof m.createdAt === 'number' && m.createdAt > 0 ? m.createdAt : Date.now(),
  }
}

/** All memories, newest first; corrupted storage degrades to empty. */
export function loadMemories(): PetMemory[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v.map(sanitize).filter((m): m is PetMemory => m !== null)
  } catch { return [] }
}

/** Append new memories (deduped against existing texts), then trim LRU. */
export function addMemories(texts: string[], sessionTitle: string): PetMemory[] {
  const existing = loadMemories()
  const seen = new Set(existing.map(m => m.text))
  const fresh: PetMemory[] = []
  for (const t of texts) {
    const m = sanitize({ text: t, sessionTitle, createdAt: Date.now() })
    if (m === null || seen.has(m.text)) continue
    seen.add(m.text)
    fresh.push(m)
  }
  if (fresh.length === 0) return existing
  // newest first, hard cap
  const next = [...fresh, ...existing].slice(0, MEMORY_LIMIT)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* best-effort */ }
  return next
}

/** Drop one memory by id; returns the updated list. */
export function removeMemory(id: string): PetMemory[] {
  const next = loadMemories().filter(m => m.id !== id)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* best-effort */ }
  return next
}

/** Plain texts for prompts, bounded (oldest dropped first). */
export function memoryTexts(limit = 10): string[] {
  return loadMemories().slice(0, limit).map(m => m.text)
}

// ─── extraction pacing ─────────────────────────────────────────────────────

/** Bump the completed-task counter; true when an extraction is due. */
export function bumpTaskCounter(): boolean {
  try {
    const n = Number(localStorage.getItem(COUNTER_KEY) ?? '0') + 1
    if (n < EXTRACT_EVERY) { localStorage.setItem(COUNTER_KEY, String(n)); return false }
    localStorage.setItem(COUNTER_KEY, '0')
    return true
  } catch { return false }
}

/** Today's extraction count (local-date keyed, self-resetting). */
function dailyCount(): number {
  try {
    const v = JSON.parse(localStorage.getItem(DAILY_KEY) ?? 'null') as { date?: string; n?: number } | null
    return v !== null && v.date === todayKey() && typeof v.n === 'number' ? v.n : 0
  } catch { return 0 }
}

/** Consume one of today's extraction slots; false when the cap is hit. */
export function takeExtractSlot(): boolean {
  if (dailyCount() >= DAILY_EXTRACT_LIMIT) return false
  try { localStorage.setItem(DAILY_KEY, JSON.stringify({ date: todayKey(), n: dailyCount() + 1 })) } catch { /* best-effort */ }
  return true
}

/** Auto-extraction toggle (default on). */
export function autoExtractEnabled(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0' } catch { return true }
}

export function setAutoExtract(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* best-effort */ }
}
