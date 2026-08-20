// Client-side registry of LLM-generated companions: persistence in
// localStorage plus the frame math. The generate route returns ONE static
// 24x28 grid; the engine animates a full frame set, so framesFromRows()
// derives bob / blink / sleep / walk / jump variants from that single grid.

import { GRID_H, GRID_W, isCustomPetId } from '../pixel-format.ts'
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
