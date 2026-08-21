// Workspace awareness: the pet sees the host's full session list through
// the client `sessions` service (progressive enhancement — the service
// is read dynamically and may be absent on older hosts, in which case
// every view here is simply empty). One tracker subscribes to the list
// snapshot and reports the current view plus session switches; the
// current title and recent titles feed the chat prompt, and switches
// fire the pet's "changed work site" bubble line.

/** What the pet knows about the host's sessions right now. */
export interface WorkspaceView {
  /** Total sessions in the host list (0 when the service is absent). */
  total: number
  /** Current session's display title ('' when none or unknown). */
  currentTitle: string
  /** The 5 most recently updated other sessions' titles, newest first. */
  recentTitles: string[]
}

const EMPTY_VIEW: WorkspaceView = { total: 0, currentTitle: '', recentTitles: [] }

/** Minimal structural type of the host `sessions` service we consume. */
interface Snapshot {
  ids: string[]
  byId: Record<string, { displayTitle?: string; updatedAt?: number }>
  current?: string
}
interface SessionsLike {
  list: {
    getSnapshot: () => Snapshot
    subscribe: (listener: () => void) => () => void
  }
}

let sessionsService: SessionsLike | null = null

/** Hand the host's sessions service to the tracker (no-op when absent). */
export function setSessionsService(service: unknown): void {
  if (service !== null && typeof service === 'object' && 'list' in service) {
    sessionsService = service as SessionsLike
  }
}

function readView(): WorkspaceView {
  if (sessionsService === null) return EMPTY_VIEW
  try {
    const snap = sessionsService.list.getSnapshot()
    const rows = snap.ids.map(id => snap.byId[id]).filter(r => r !== undefined)
    const currentRow = snap.current !== undefined ? snap.byId[snap.current] : undefined
    const others = rows
      .filter(r => r !== currentRow)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 5)
      .map(r => r.displayTitle ?? '')
      .filter(t => t.length > 0)
    return {
      total: rows.length,
      currentTitle: currentRow?.displayTitle ?? '',
      recentTitles: others,
    }
  } catch { return EMPTY_VIEW }
}

/**
 * Watch the session list. `onChange` fires with the fresh view right
 * away and on every list update; `onSwitch` fires only when the current
 * session id actually changes (initial attach does not count). Returns
 * a disposer.
 */
export function trackWorkspace(
  onChange: (view: WorkspaceView) => void,
  onSwitch: (view: WorkspaceView) => void,
): () => void {
  if (sessionsService === null) { onChange(EMPTY_VIEW); return () => {} }
  let lastCurrent: string | undefined
  const push = (): void => {
    const view = readView()
    onChange(view)
    try {
      const snap = sessionsService?.list.getSnapshot()
      const cur = snap?.current
      if (cur !== undefined && lastCurrent !== undefined && cur !== lastCurrent) onSwitch(view)
      if (cur !== undefined) lastCurrent = cur
    } catch { /* snapshot read already degrades in readView */ }
  }
  push()
  try {
    return sessionsService.list.subscribe(push)
  } catch { return () => {} }
}
