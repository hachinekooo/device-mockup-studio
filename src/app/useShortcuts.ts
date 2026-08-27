import { useEffect } from 'react'
import { useProjectStore } from '../store/project'

/**
 * Global keyboard shortcuts.
 *
 * Deliberately inert while a text field has focus: undo inside an input
 * should undo typing, not reach past it and revert the document.
 */
export function useShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return
      }

      const store = useProjectStore.getState()
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void store.saveProject()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        store.setPlaying(!store.playing)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
