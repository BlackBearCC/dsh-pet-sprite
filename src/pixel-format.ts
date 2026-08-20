// Shared pixel-grid format: constants, validation, and fix-ups used by
// both halves — the node generate route validates LLM output here, the
// client reads the same grid when drawing custom pets.

export const GRID_W = 24
export const GRID_H = 28

/** Every palette character a sprite cell may use ('.' = transparent). */
export const PALETTE_CHARS = 'ohHsSeXwtTkKbmlgzfFpuc'

const PALETTE_SET = new Set(PALETTE_CHARS.split(''))

/** Fixed-up grid, or the reason the raw output was unusable. */
export type GridResult = { rows: string[] } | { error: string }

/**
 * Coerce arbitrary LLM output into a valid 24x28 grid: pad/truncate rows,
 * blank out unknown characters, cap at 28 rows. Fails when the result is
 * too empty to read as a sprite.
 */
export function fixGrid(raw: unknown): GridResult {
  if (!Array.isArray(raw)) return { error: 'rows is not an array' }
  const rows: string[] = []
  for (let i = 0; i < GRID_H; i++) {
    const src = typeof raw[i] === 'string' ? (raw[i] as string) : ''
    let row = ''
    for (const ch of src.slice(0, GRID_W)) {
      row += ch === '.' || PALETTE_SET.has(ch) ? ch : '.'
    }
    rows.push(row + '.'.repeat(GRID_W - row.length))
  }
  const filled = rows.join('').replace(/\./g, '').length
  if (filled < 80) {
    return { error: 'generated sprite is too empty to use — try a more concrete description' }
  }
  return { rows }
}

/** True when the id refers to a user-generated (not builtin) companion. */
export function isCustomPetId(id: string): boolean {
  return id.startsWith('custom:')
}
