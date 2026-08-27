import type { CSSProperties } from 'react'
import type { BackgroundConfig } from '../store/schema'

// Background is a CSS/compositing layer, never scene geometry (§6.3) —
// putting it in the scene would defeat alpha export.
export function backdropCss(bg: BackgroundConfig): CSSProperties {
  switch (bg.type) {
    case 'transparent':
      return {
        backgroundImage:
          'linear-gradient(45deg, #2a2a2e 25%, transparent 25%), linear-gradient(-45deg, #2a2a2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2e 75%), linear-gradient(-45deg, transparent 75%, #2a2a2e 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        backgroundColor: '#1c1c1f',
      }
    case 'solid':
      return { backgroundColor: bg.color }
    case 'gradient':
      return { background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})` }
    case 'image':
      return {
        backgroundImage: `url(${bg.ref.url})`,
        backgroundSize: bg.fit === 'cover' ? 'cover' : 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#000',
      }
  }
}
