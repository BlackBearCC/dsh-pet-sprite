// Client-side registry of LLM-generated companions: persistence in
// localStorage plus the frame math. The generate route returns ONE static
// 24x28 grid; the engine animates a full frame set, so framesFromRows()
// derives bob / blink / sleep / walk / jump variants from that single grid.

import { fixGrid, GRID_H, GRID_W, isCustomPetId } from '../pixel-format.ts'
import type { Frames } from './pet-art.ts'

export interface CustomPet {
  /** 'custom:<base36 timestamp>' — distinguishes generated pets from builtins. */
  id: string
  name: string
  tagline: string
  /** The generated 24x28 grid, validated by the node route before saving. */
  rows: string[]
  createdAt: number
}

/**
 * The soul half of a companion: how it speaks and reacts. Profiles are
 * per-pet (builtin ones too) and travel inside share files, so an exported
 * pet carries both its sprite and its personality. Empty arrays fall back
 * to the built-in line pools.
 */
export interface PetProfile {
  /** Free-form personality fed to the chat system prompt. */
  persona: string
  /** Bubble lines per event; one per line in the editor, picked at random. */
  lines: {
    /** Ambient chatter while idling. */
    idle?: string[]
    /** When the agent starts streaming (the pet opens its laptop). */
    work?: string[]
    /** When the agent's turn completes. */
    done?: string[]
    /** When mood/power/health is in a bad state. */
    low?: string[]
    /** After being fed an item. */
    feed?: string[]
    /** After play interactions. */
    play?: string[]
    /** After resting. */
    rest?: string[]
    /** When the user switches to another DSH session. */
    switch?: string[]
  }
}

/** A profile with nothing customized — everything falls back to defaults. */
export const EMPTY_PROFILE: Readonly<PetProfile> = { persona: '', lines: {} }

const PROFILE_KEY = 'dshPetSpriteChat:profiles'
/** Legacy pre-profile key: one persona shared by every companion. */
const LEGACY_PERSONA_KEY = 'dshPetSpriteChat:persona'

/** Sanitize one lines pool: drop blanks, clamp count and length. */
function cleanLines(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cleaned = v
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim().slice(0, 24))
    .filter(s => s.length > 0)
    .slice(0, 8)
  return cleaned.length > 0 ? cleaned : undefined
}

/** Parse + clamp an unknown value into a PetProfile; never throws. */
export function parseProfile(v: unknown): PetProfile {
  const p: PetProfile = { persona: '', lines: {} }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return p
  const raw = v as { persona?: unknown; lines?: Record<string, unknown> }
  if (typeof raw.persona === 'string') p.persona = raw.persona.trim().slice(0, 500)
  if (raw.lines !== null && typeof raw.lines === 'object' && !Array.isArray(raw.lines)) {
    for (const key of ['idle', 'work', 'done', 'low', 'feed', 'play', 'rest', 'switch'] as const) {
      const cleaned = cleanLines(raw.lines[key])
      if (cleaned !== undefined) p.lines[key] = cleaned
    }
  }
  return p
}

/** All per-pet profiles keyed by companion id (builtins included). */
export function loadProfiles(): Record<string, PetProfile> {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Record<string, unknown>
    const out: Record<string, PetProfile> = {}
    for (const [id, prof] of Object.entries(v ?? {})) {
      out[id] = parseProfile(prof)
    }
    // one-time migration: the old global persona becomes the profile of
    // whichever companion was active back then — that's the one it tuned
    if (localStorage.getItem(`${PROFILE_KEY}:migrated`) === null && localStorage.getItem(LEGACY_PERSONA_KEY) !== null) {
      const activeId = localStorage.getItem('dshPetSpriteGame:petId')
      const legacy = (localStorage.getItem(LEGACY_PERSONA_KEY) ?? '').trim().slice(0, 500)
      if (activeId !== null && legacy.length > 0) {
        out[activeId] = { persona: legacy, lines: out[activeId]?.lines ?? {} }
      }
      localStorage.setItem(`${PROFILE_KEY}:migrated`, '1')
    }
    return out
  } catch {
    return {}
  }
}

/** Persist one companion's profile; returns false when storage is unusable. */
export function saveProfile(id: string, profile: PetProfile): boolean {
  try {
    const all = loadProfiles()
    all[id] = profile
    localStorage.setItem(PROFILE_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

const KEY = 'dshPetSprite:customPets'

export function loadCustomPets(): CustomPet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v.filter((p): p is CustomPet =>
      p !== null && typeof p === 'object'
      && typeof (p as CustomPet).id === 'string' && isCustomPetId((p as CustomPet).id)
      && typeof (p as CustomPet).name === 'string'
      && Array.isArray((p as CustomPet).rows)
      && (p as CustomPet).rows.length === GRID_H
      && (p as CustomPet).rows.every(r => typeof r === 'string'),
    )
  } catch {
    return []
  }
}

/** Append one pet; returns false when localStorage is unusable (quota etc.). */
export function saveCustomPet(pet: CustomPet): boolean {
  try {
    const all = loadCustomPets()
    all.push(pet)
    localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

// ─── share format: export / import ──────────────────────────────────────────
//
// A share file is the sprite payload only — no id, no createdAt: importing
// mints a fresh id, so a shared pet is a copy, not a reference. Grid rows
// go through the same fixGrid() the node route applies to LLM output, so
// hand-edited or truncated files degrade the same way generation does.

/** Shared-sprite payload (what a .dsh-pet.json file contains). */
export interface SharePetFile {
  format: 'dsh-pet-sprite'
  version: 1 | 2
  name: string
  tagline: string
  rows: string[]
  /** v2: the pet's soul — persona + event lines. Absent in v1 files. */
  profile?: PetProfile
}

const SHARE_HEADER = 'dsh-pet-sprite'
const NAME_MAX = 12
const TAGLINE_MAX = 24

export function toShareFile(pet: CustomPet, profile?: PetProfile): SharePetFile {
  return {
    format: SHARE_HEADER,
    version: 2,
    name: pet.name,
    tagline: pet.tagline,
    rows: pet.rows,
    profile: profile !== undefined && (profile.persona.length > 0 || Object.keys(profile.lines).length > 0)
      ? profile
      : undefined,
  }
}

/** Trigger a .dsh-pet.json download for one custom pet (sprite + soul). */
export function downloadShareFile(pet: CustomPet, profile?: PetProfile): void {
  const blob = new Blob([JSON.stringify(toShareFile(pet, profile), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // filesystem-safe: keep CJK, drop path separators and friends
  const safe = pet.name.replace(/[\\/:*?"<>|]/g, '').trim()
  a.download = `${safe.length > 0 ? safe : 'pet'}.dsh-pet.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Parse + validate a share file (from file picker or pasted text) and mint
 * a fresh CustomPet plus its soul profile. v1 files (no profile) come in
 * with an empty one. Same contract as generate: errors are strings for the
 * UI, never thrown.
 */
export function importFromText(text: string): { pet: CustomPet; profile: PetProfile } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: '不是有效的 JSON 文件。' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '格式不对：需要 dsh-pet-sprite 分享文件。' }
  }
  const v = raw as Partial<SharePetFile>
  if (v.format !== SHARE_HEADER) {
    return { error: '格式不对：缺少 dsh-pet-sprite 标识（请用「导出」生成的文件）。' }
  }
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, NAME_MAX) : ''
  if (name.length === 0) return { error: '名字缺失或为空。' }
  const tagline = typeof v.tagline === 'string' ? v.tagline.trim().slice(0, TAGLINE_MAX) : ''
  const grid = fixGrid(v.rows)
  if ('error' in grid) {
    return { error: `像素网格无效：${grid.error}` }
  }
  return {
    pet: {
      id: `custom:${Date.now().toString(36)}`,
      name,
      tagline,
      rows: grid.rows,
      createdAt: Date.now(),
    },
    profile: v.profile === undefined ? { persona: '', lines: {} } : parseProfile(v.profile),
  }
}

// ─── frame derivation ───────────────────────────────────────────────────────

const BLANK = '.'.repeat(GRID_W)

function shiftDown(rows: string[]): string[] {
  return [BLANK, ...rows.slice(0, GRID_H - 1)]
}

function shiftUp(rows: string[]): string[] {
  return [...rows.slice(1), BLANK]
}

/**
 * Generic eye-close for sprites we did not hand-author: repaint 'e' pixels
 * with the row's dominant fill color, so the eyes melt into the face. Rows
 * without 'e' (whale-style sprites, failures) pass through unchanged.
 */
function closeEyes(rows: string[]): string[] {
  return rows.map((row) => {
    if (!row.includes('e')) return row
    const counts = new Map<string, number>()
    for (const ch of row) {
      if (ch !== '.' && ch !== 'e') counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    let fill = 'o'
    let best = 0
    for (const [ch, n] of counts) {
      if (n > best) {
        best = n
        fill = ch
      }
    }
    return row.replaceAll('e', fill)
  })
}

/** Stamp a 'z' pixel only where the cell is transparent (never over the art). */
function markZ(rows: string[], row: number, col: number): void {
  if (rows[row] !== undefined && rows[row][col] === '.') {
    rows[row] = rows[row].slice(0, col) + 'z' + rows[row].slice(col + 1)
  }
}

/**
 * Derive the full frame set from one static grid. Builtin companions have
 * hand-tuned variants; generated ones get whole-body motion, which reads
 * well at 4x scale: idle = static, bob = 1px down, walk alternates the two,
 * jump stretches 1px up, sleep bobs with closed eyes and a z trail.
 */
export function framesFromRows(rows: string[]): Frames {
  const bob = shiftDown(rows)
  const sleep = closeEyes(bob)
  markZ(sleep, 1, 21)
  markZ(sleep, 2, 22)
  markZ(sleep, 3, 23)
  return {
    I: rows,
    B: bob,
    BL: closeEyes(rows),
    ZZ: sleep,
    WA: rows,
    WB: bob,
    KA: rows,
    KB: bob,
    JP: shiftUp(rows),
  }
}
