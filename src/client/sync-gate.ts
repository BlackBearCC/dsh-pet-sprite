// Hydration gate: the pet component must not mount before boot-time
// hydration settles (it reads localStorage synchronously). The slots layer
// registers the pet component; this module flips a flag once hydration is
// done, and the pet's render waits on it (with a timeout so a dead server
// never blocks the pet entirely).

let ready = false
const waiters: Array<() => void> = []

/** Called once hydration settled (or failed) — releases all waiters. */
export function markSyncReady(): void {
  ready = true
  for (const w of waiters.splice(0)) w()
}

/** True when hydration has settled; mount-time check. */
export function isSyncReady(): boolean {
  return ready
}

/** Resolve when hydration settled (immediately when already done). */
export function whenSyncReady(): Promise<void> {
  if (ready) return Promise.resolve()
  return new Promise(resolve => { waiters.push(resolve) })
}
