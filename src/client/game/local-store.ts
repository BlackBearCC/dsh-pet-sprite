// localStorage-backed PersistenceStore for the browser plugin.
// Mirrors the gateway file-store contract: load(key) -> parsed JSON or null,
// save(key, data) -> serialized synchronously.

import type { PersistenceStore } from './attribute-engine.ts'

const PREFIX = 'dshPetGame:'

export function createLocalStore(): PersistenceStore {
  return {
    load(key: string): Record<string, unknown> | null {
      try {
        const raw = localStorage.getItem(PREFIX + key)
        if (!raw) return null
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return null
      }
    },
    save(key: string, data: Record<string, unknown>): void {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(data))
      } catch {
        // storage full / private mode: keep running in-memory
      }
    },
  }
}
