import { httpsImageUrl, isOutlineActivityImagePath, OUTLINE_IMAGE_MAX_WIDTH } from './activityImages'

type ReceivePreview = (_url: string | null) => void
type ActivityBatch = { queued: Map<string, Set<ReceivePreview>>; scheduled: boolean }

const batches = new Map<string, ActivityBatch>()

function schedule(path: string, batch: ActivityBatch) {
  if (batch.scheduled) return
  batch.scheduled = true
  setTimeout(() => void sendBatch(path, batch), 25)
}

async function sendBatch(path: string, batch: ActivityBatch) {
  const entries = Array.from(batch.queued.entries()).slice(0, 32)
  if (!entries.length) {
    batches.delete(path)
    return
  }
  entries.forEach(([id]) => batch.queued.delete(id))
  let previews: object | null = null
  let fallback = true
  try {
    const pixels = Math.min(window.innerWidth, OUTLINE_IMAGE_MAX_WIDTH) * window.devicePixelRatio
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: entries.map(([id]) => id), width: pixels > 640 ? 1200 : 640 }),
    })
    if (response.ok) {
      const data: unknown = await response.json()
      if (data && typeof data === 'object' && 'images' in data && data.images && typeof data.images === 'object') {
        previews = data.images
        fallback = false
      }
    } else if ([401, 402, 403].includes(response.status)) {
      fallback = false
    }
  } catch {
    // The original endpoint also works during a rolling upgrade.
  }
  for (const [id, receivers] of entries) {
    const value: unknown = previews && Object.getOwnPropertyDescriptor(previews, id)?.value
    const url = httpsImageUrl(value) ?? (fallback ? path + '/' + id : null)
    receivers.forEach(receive => receive(url))
  }
  batch.scheduled = false
  if (batch.queued.size) schedule(path, batch)
  else batches.delete(path)
}

export function requestOutlinePreview(src: string, receive: ReceivePreview) {
  if (!isOutlineActivityImagePath(src)) throw new Error('Invalid Outline image path')
  const separator = src.lastIndexOf('/')
  const path = src.slice(0, separator)
  const id = src.slice(separator + 1)
  const batch = batches.get(path) ?? { queued: new Map(), scheduled: false }
  batches.set(path, batch)
  const receivers = batch.queued.get(id) ?? new Set<ReceivePreview>()
  batch.queued.set(id, receivers)
  receivers.add(receive)
  schedule(path, batch)
  return () => {
    receivers.delete(receive)
    if (!receivers.size && batch.queued.get(id) === receivers) batch.queued.delete(id)
  }
}
