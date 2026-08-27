/**
 * Media blob storage (§5).
 *
 * Blobs live here, keyed by MediaRef.id — never in the project JSON and
 * never in localStorage. A 30-second 4K screen recording is 100MB+, and
 * base64 in JSON will take the tab down.
 *
 * OPFS is the primary store with an IndexedDB fallback (§11): Safari's OPFS
 * support has been uneven, and losing a user's media is not an acceptable
 * way to discover that.
 */

const DIR = 'media'

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage?.getDirectory?.()
    if (!root) return null
    return await root.getDirectoryHandle(DIR, { create: true })
  } catch {
    return null
  }
}

// --- IndexedDB fallback -----------------------------------------------------

const DB_NAME = 'mockup-media'
const STORE = 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbRequest<T>(store: IDBObjectStore, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbWith<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  try {
    return await idbRequest(db.transaction(STORE, mode).objectStore(STORE), run)
  } finally {
    db.close()
  }
}

// --- public API -------------------------------------------------------------

export async function putMedia(id: string, blob: Blob): Promise<void> {
  const dir = await opfsDir()
  if (dir) {
    const handle = await dir.getFileHandle(id, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }
  await idbWith('readwrite', (s) => s.put(blob, id))
}

export async function getMedia(id: string): Promise<Blob | null> {
  const dir = await opfsDir()
  if (dir) {
    try {
      return await (await dir.getFileHandle(id)).getFile()
    } catch {
      return null
    }
  }
  return (await idbWith<Blob | undefined>('readonly', (s) => s.get(id))) ?? null
}

export async function deleteMedia(id: string): Promise<void> {
  const dir = await opfsDir()
  if (dir) {
    await dir.removeEntry(id).catch(() => {})
    return
  }
  await idbWith('readwrite', (s) => s.delete(id))
}

export async function listMedia(): Promise<string[]> {
  const dir = await opfsDir()
  if (dir) {
    const ids: string[] = []
    for await (const key of dir.keys()) ids.push(key)
    return ids
  }
  return idbWith<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k.map(String))
}

/**
 * Drop blobs no longer referenced by the project. Object URLs are recreated
 * per session, so an orphan is invisible — it just quietly consumes the
 * origin's storage quota until something collects it.
 */
export async function pruneMedia(keepIds: string[]): Promise<number> {
  const keep = new Set(keepIds)
  const all = await listMedia()
  const orphans = all.filter((id) => !keep.has(id))
  await Promise.all(orphans.map(deleteMedia))
  return orphans.length
}
