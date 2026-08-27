import { Camera, Smartphone, Image as ImageIcon, Globe, Download, Type, Layers, LayoutGrid } from 'lucide-react'
import { TopBar } from './ui/TopBar/TopBar'
import { Artboard } from './ui/Artboard/Artboard'
import { TimelineBar } from './ui/Timeline/TimelineBar'
import { Section } from './ui/controls/Section'
import { CameraSection } from './ui/Inspector/CameraSection'
import { DeviceCard, ScreenContent } from './ui/Inspector/DeviceSection'
import { DeviceList } from './ui/Inspector/DeviceList'
import { TransformSection } from './ui/Inspector/TransformSection'
import { TemplatePicker } from './ui/Templates/TemplatePicker'
import { BackgroundControls, EnvironmentControls } from './ui/Inspector/Inspector'
import { ExportControls } from './ui/ExportDialog/ExportDialog'
import { useProjectStore } from './store/project'
import { useShortcuts } from './app/useShortcuts'
import './App.css'

function App() {
  const editorMode = useProjectStore((s) => s.editorMode)
  useShortcuts()

  return (
    <div className="app">
      <TopBar />

      <div className="app-body">
        <main className={editorMode === 'movie' ? 'stage-zone with-timeline' : 'stage-zone'}>
          <Artboard />
          {/* A still has no time axis, so the whole zone goes away in Image
              mode rather than sitting there disabled. */}
          {editorMode === 'movie' && <TimelineBar />}
        </main>

        <aside className="panel">
          <Section icon={<LayoutGrid size={14} />} title="Templates" defaultOpen>
            <TemplatePicker />
          </Section>

          <Section icon={<Smartphone size={14} />} title="Device" defaultOpen>
            <DeviceList />
            <DeviceCard />
            <ScreenContent />
            <TransformSection />
          </Section>

          <Section icon={<Camera size={14} />} title="Camera" defaultOpen>
            <CameraSection />
          </Section>

          <Section icon={<ImageIcon size={14} />} title="Background">
            <BackgroundControls />
          </Section>

          <Section icon={<Globe size={14} />} title="Environment">
            <EnvironmentControls />
          </Section>

          <Section icon={<Type size={14} />} title="Labels">
            <p className="hint">Text and annotation layers arrive with the layers milestone.</p>
          </Section>

          <Section icon={<Layers size={14} />} title="Effects">
            <p className="hint">Depth of field and motion blur are queued behind the timeline work.</p>
          </Section>

          <Section icon={<Download size={14} />} title="Export" defaultOpen>
            <ExportControls />
          </Section>
        </aside>
      </div>
    </div>
  )
}

export default App
