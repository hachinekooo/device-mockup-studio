import { putMedia } from './storage'
import { loadImageAsMediaRef } from './loadImage'
import type { MediaRef } from '../store/schema'

/** Container types a `<video>` element will actually play back. */
export const ACCEPTED_SCREEN_TYPES = 'image/*,video/mp4,video/webm,video/quicktime'

/**
 * Read a screen recording into a MediaRef and persist the blob.
 *
 * Dimensions come from `videoWidth`/`videoHeight` rather than the container's
 * declared size, because those are the values *after* the browser has applied
 * any rotation matrix the file carries — phone screen recordings routinely
 * carry one, and reading around it is how exports come out sideways (§14
 * trap 8). Letting the element do it means the whole app, preview and export
 * alike, only ever sees upright frames.
 */
export async function loadVideoAsMediaRef(file: File): Promise<MediaRef> {
  const id = crypto.randomUUID()
  const url = URL.createObjectURL(file)

  const meta = await new Promise<{ width: number; height: number; duration: number }>(
    (resolve, reject) => {
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.muted = true
      el.onloadedmetadata = () =>
        resolve({ width: el.videoWidth, height: el.videoHeight, duration: el.duration })
      el.onerror = () => reject(new Error('Failed to load video'))
      el.src = url
    },
  )

  await putMedia(id, file)
  return { id, kind: 'video', ...meta, url }
}

/**
 * Load whatever the user dropped on the screen.
 *
 * Returns null for anything else rather than throwing: a dropped file of the
 * wrong type is a mis-drop, not an error worth interrupting for.
 */
export async function loadScreenMedia(file: File | undefined): Promise<MediaRef | null> {
  if (!file) return null
  if (file.type.startsWith('image/')) return loadImageAsMediaRef(file)
  if (file.type.startsWith('video/')) return loadVideoAsMediaRef(file)
  return null
}
