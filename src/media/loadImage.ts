import { putMedia } from './storage'
import type { MediaRef } from '../store/schema'

/**
 * Read an image file into a MediaRef and persist the blob.
 *
 * The blob goes to durable storage immediately rather than at save time —
 * a dropped screenshot is the most expensive thing in the document to
 * replace, and a tab that reloads before an explicit save should not lose it.
 */
export async function loadImageAsMediaRef(file: File): Promise<MediaRef> {
  const id = crypto.randomUUID()
  const url = URL.createObjectURL(file)

  const { width, height } = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = url
    },
  )

  await putMedia(id, file)
  return { id, kind: 'image', width, height, url }
}

/** Recreate the session-local object URL for a stored ref after a reload. */
export function withObjectUrl(ref: MediaRef, blob: Blob): MediaRef {
  return { ...ref, url: URL.createObjectURL(blob) }
}
