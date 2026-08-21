// Cross-device state sync: the browser keeps localStorage as its offline
// cache (instant boot, works when the server hiccups) and mirrors the whole
// state blob to the plugin's node half (POST /plugins/dsh-pet-sprite/state),
// so every device of the same user hatches the same companion with the same
// progress. Single-user, last-write-wins by `savedAt` (epoch ms): hydration
// adopts the server copy only when it is strictly newer than the local one,
// and a stale tab racing a newer device gets 409'd by the server (its own
// next successful write carries a fresh savedAt, so no data is lost).
//
// Shape of the blob (all fields optional; the client degrades gracefully):
//   savedAt: number           — write clock, bumped on every successful save
//   petId, chatHistory, chatModel, teasersSeen, customPets, profiles,
//   memories, game: { [storeKey]: {...} }, witness: { [date]: {...} }
//
// The sync layer is deliberately dumb: it knows nothing about pets. Every
// subsystem registers its own slice (key → load/save on the blob) through
// `syncSlice`, and one shared debounced push serializes them all.

const STATE_URL = '/plugins/dsh-pet-sprite/state'
const SAVED_AT_KEY = 'dshPetSpriteSync:savedAt'
const PUSH_DEBOUNCE_MS = 1500

/** One subsystem's slice of the synced blob (e.g. petId, chatHistory). */
export interface SyncSlice {
  /** Blob key. Nested objects use dot paths ('game.inventory'). */
  key: string
  /** Serialize the current local value for the blob; undefined = omit. */
  get(): unknown
  /** Adopt a server value into local state. */
  set(value: unknown): void
}

const slices: SyncSlice[] = []
let pushTimer: ReturnType<typeof setTimeout> | undefined
let pushInFlight = false
let dirty = false

function readSavedAt(): number {
  try {
    const v = Number(localStorage.getItem(SAVED_AT_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch { return 0 }
}

function writeSavedAt(at: number): void {
  try { localStorage.setItem(SAVED_AT_KEY, String(at)) } catch { /* ignore */ }
}

/** Dig `a.b.c` out of an object, undefined when any hop is missing. */
function getPath(obj: unknown, key: string): unknown {
  let cur: unknown = obj
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Set `a.b.c` on an object, creating intermediate objects as needed. */
function setPath(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (cur[p] === null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

/** Register a slice; its current value is included in every push. */
export function syncSlice(slice: SyncSlice): void {
  slices.push(slice)
}

/** A local mutation happened: bump the clock and schedule a push. */
export function schedulePush(): void {
  dirty = true
  clearTimeout(pushTimer)
  pushTimer = setTimeout(doPush, PUSH_DEBOUNCE_MS)
}

async function doPush(): Promise<void> {
  if (pushInFlight || !dirty) return
  pushInFlight = true
  dirty = false
  const savedAt = Date.now()
  writeSavedAt(savedAt)
  const blob: Record<string, unknown> = { savedAt }
  for (const s of slices) {
    const v = s.get()
    if (v !== undefined) setPath(blob, s.key, v)
  }
  try {
    const res = await fetch(STATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(blob),
    })
    if (!res.ok && res.status !== 409) {
      // server rejected (stale 409 is fine — a newer device leads); retry later
      dirty = true
      clearTimeout(pushTimer)
      pushTimer = setTimeout(doPush, PUSH_DEBOUNCE_MS * 4)
    }
  } catch {
    // offline / server down: keep the local copy, retry on next mutation
  } finally {
    pushInFlight = false
  }
}

/**
 * Boot-time hydration: fetch the server blob and adopt it when strictly
 * newer than the local clock. Returns once settled (network failure is a
 * no-op — the local cache stands).
 */
export async function hydrateFromServer(): Promise<void> {
  let blob: Record<string, unknown>
  try {
    const res = await fetch(STATE_URL)
    if (!res.ok) return
    blob = await res.json() as Record<string, unknown>
  } catch { return }
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return
  const serverAt = typeof blob.savedAt === 'number' ? blob.savedAt : 0
  if (serverAt <= readSavedAt()) return
  writeSavedAt(serverAt)
  for (const s of slices) {
    const v = getPath(blob, s.key)
    if (v !== undefined) {
      try { s.set(v) } catch { /* one bad slice must not break the rest */ }
    }
  }
}

/** Flush pending state on tab close (best-effort; keepalive survives nav). */
export function flushNow(): void {
  clearTimeout(pushTimer)
  void doPush()
}
