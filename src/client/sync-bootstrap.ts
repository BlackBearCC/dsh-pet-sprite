// Boot wiring for cross-device sync: registers every localStorage slice the
// pet owns as a sync slice, and runs the boot-time hydration exactly once
// per page load BEFORE the pet component mounts (the component reads
// localStorage synchronously in its useState initializers, so hydration
// must land first — otherwise a fresh device renders the egg for a frame
// and then would need a remount).
//
// Push side: every slice's save path also calls schedulePush() (wired in
// this module's wrapped helpers), so any mutation mirrors to the server
// after the shared debounce.

import { syncSlice, schedulePush, hydrateFromServer, flushNow } from './sync.ts'

/** Keys owned by ChatPet.tsx. */
import { markSyncReady } from './sync-gate.ts'

// ── localStorage helpers with push notification ─────────────────────────────

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}
function parseOr<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

// every slice and its blob key; mirrors the storage map in README ("How it
// works": game state + chat history persist in localStorage)
const SLICES: Array<{ blob: string; ls: string }> = [
  { blob: 'petId', ls: 'dshPetSpriteGame:petId' },                     // chosen companion
  { blob: 'teasersSeen', ls: 'dshPetSpriteGame:teasersSeen' },         // one-time onboarding flags
  { blob: 'chatHistory', ls: 'dshPetSpriteChat:history' },             // last 30 chat turns
  { blob: 'chatModel', ls: 'dshPetSpriteChat:model' },                 // provider+model choice
  { blob: 'profiles', ls: 'dshPetSpriteChat:profiles' },               // per-pet persona + lines
  { blob: 'customPets', ls: 'dshPetSprite:customPets' },               // generated companions
  { blob: 'memories', ls: 'dshPetSpriteMemory:items' },                // pet's memories of the user
  { blob: 'memoriesDaily', ls: 'dshPetSpriteMemory:daily' },           // memory daily cap
  { blob: 'memoriesCounter', ls: 'dshPetSpriteMemory:counter' },       // memory extraction counter
  { blob: 'memoriesAuto', ls: 'dshPetSpriteMemory:auto' },             // auto-extraction toggle
  { blob: 'lastLogin', ls: 'dshPetSpriteGame:lastLogin' },             // daily login coin grant
  { blob: 'witnessDays', ls: 'dshPetSpriteWitness:days' },             // daily work journal
]

// game engine store: one nested object under 'game' — the engine's own
// PersistenceStore writes whole records ('attribute-engine', 'level-system',
// 'inventory-system', 'shop-system', 'reward-engine' keys under the
// dshPetSpriteGame: prefix)
const GAME_LS_PREFIX = 'dshPetSpriteGame:'
const GAME_KEYS = ['attribute-engine', 'level-system', 'inventory-system', 'shop-system', 'reward-engine']

let registered = false
let pushHooked = false

/** Wrap the engine's local store so every save also schedules a push. */
export function notifyGameSave(): void {
  schedulePush()
}

function registerAll(): void {
  if (registered) return
  registered = true

  for (const { blob, ls } of SLICES) {
    syncSlice({
      key: blob,
      get: () => parseOr<unknown>(lsGet(ls), null),
      set: (v) => lsSet(ls, JSON.stringify(v)),
    })
  }

  // game engine: expose each store key as its own nested slice
  for (const k of GAME_KEYS) {
    syncSlice({
      key: `game.${k}`,
      get: () => parseOr<unknown>(lsGet(GAME_LS_PREFIX + k), null),
      set: (v) => lsSet(GAME_LS_PREFIX + k, JSON.stringify(v)),
    })
  }
}

/**
 * Register slices, hydrate from the server (single flight, no-op when the
 * local cache is newest), then open the gate so the pet mounts with the
 * adopted state. Safe to call more than once (the slots layer may re-run
 * apply on hot reload).
 */
export async function registerSyncSlices(): Promise<void> {
  registerAll()
  hookPush()
  try {
    await hydrateFromServer()
  } finally {
    markSyncReady()
  }
}

// push triggers: intercept every localStorage write the pet performs by
// listening to the storage event won't work same-tab — instead every helper
// the pet code calls goes through notify wrappers. For engine saves we hook
// the store; for React-side saves the pet code calls schedulePush through
// this module's exports (see sync-hooks.ts patch points).
function hookPush(): void {
  if (pushHooked) return
  pushHooked = true
  // beforeunload: flush a pending debounced push so closing the tab does
  // not lose the last mutation (static import — the client bundle must
  // stay a single file: it loads through window.__ModuleLoader__.load)
  window.addEventListener('beforeunload', () => { flushNow() })
  // visibilitychange → hidden: same flush for mobile browsers that freeze
  // background tabs without firing beforeunload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}
