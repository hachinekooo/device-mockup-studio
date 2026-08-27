import type { Project } from './schema'

/**
 * Undo/redo over whole-document snapshots.
 *
 * The project is a small plain object — no THREE objects, no functions — so
 * snapshotting it is cheap and needs no patch machinery. What makes this
 * work is that every mutation already produces a new document rather than
 * editing one in place.
 */
export type History = {
  past: Project[]
  future: Project[]
}

export const emptyHistory: History = { past: [], future: [] }

const LIMIT = 100

/**
 * Continuous edits — dragging a number field, scrubbing a slider — would
 * otherwise push a snapshot per pointer move and bury the previous real
 * state under hundreds of entries. Same label within the window coalesces
 * into the existing entry instead.
 */
const COALESCE_MS = 500

let lastLabel: string | null = null
let lastAt = 0

export function record(history: History, previous: Project, label?: string): History {
  const now = Date.now()
  const coalesce = label !== undefined && label === lastLabel && now - lastAt < COALESCE_MS
  lastLabel = label ?? null
  lastAt = now

  if (coalesce && history.past.length > 0) {
    // Keep the older snapshot: undo should land before the whole gesture,
    // not in the middle of it.
    return { past: history.past, future: [] }
  }

  return { past: [...history.past, previous].slice(-LIMIT), future: [] }
}

export function undo(history: History, current: Project): { history: History; project: Project } | null {
  const previous = history.past[history.past.length - 1]
  if (!previous) return null
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
    project: previous,
  }
}

export function redo(history: History, current: Project): { history: History; project: Project } | null {
  const next = history.future[0]
  if (!next) return null
  return {
    history: { past: [...history.past, current], future: history.future.slice(1) },
    project: next,
  }
}

/** Called when a document is replaced wholesale (open, new) — history resets. */
export function resetCoalescing() {
  lastLabel = null
  lastAt = 0
}
