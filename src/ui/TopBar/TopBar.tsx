import { useRef, useState } from 'react'
import { Download, Maximize2, Film, ImageIcon, Undo2, Redo2, Save, FolderOpen } from 'lucide-react'
import { Segmented } from '../controls/Segmented'
import { useProjectStore } from '../../store/project'
import { runExport } from '../ExportDialog/ExportDialog'

export function TopBar() {
  const name = useProjectStore((s) => s.project.name)
  const setName = useProjectStore((s) => s.setName)
  const editorMode = useProjectStore((s) => s.editorMode)
  const setEditorMode = useProjectStore((s) => s.setEditorMode)
  const output = useProjectStore((s) => s.project.output)
  const background = useProjectStore((s) => s.project.background)
  const [busy, setBusy] = useState(false)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const saveProject = useProjectStore((s) => s.saveProject)
  const openProject = useProjectStore((s) => s.openProject)
  // Subscribe to the history itself, not the canUndo() function — a getter
  // never changes identity, so the buttons would never re-enable.
  const history = useProjectStore((s) => s.history)
  const fileRef = useRef<HTMLInputElement>(null)

  async function quickExport() {
    setBusy(true)
    try {
      await runExport(output.width, output.height, background)
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="icon-cluster">
          <button className="icon-btn" onClick={quickExport} disabled={busy} title="Export PNG">
            <Download size={15} />
          </button>
          <button className="icon-btn" onClick={() => void saveProject()} title="Save .mockup (⌘S)">
            <Save size={15} />
          </button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Open .mockup">
            <FolderOpen size={15} />
          </button>
          <button
            className="icon-btn"
            title="Fullscreen"
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            <Maximize2 size={15} />
          </button>
        </div>

        <div className="icon-cluster">
          <button
            className="icon-btn"
            onClick={undo}
            disabled={history.past.length === 0}
            title="Undo (⌘Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={redo}
            disabled={history.future.length === 0}
            title="Redo (⇧⌘Z)"
          >
            <Redo2 size={15} />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".mockup,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void openProject(file)
            e.target.value = ''
          }}
        />
        <input
          className="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="topbar-right">
        <Segmented
          value={editorMode}
          onChange={setEditorMode}
          options={[
            { id: 'movie' as const, label: <><span>Movie</span> <Film size={13} /></> },
            { id: 'image' as const, label: <><span>Image</span> <ImageIcon size={13} /></> },
          ]}
        />
      </div>
    </header>
  )
}
