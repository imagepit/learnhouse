const context = new TextEncoder().encode('learnhouse-outline-preview-v1')
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function missing() {
  return new Response(null, { status: 404, headers: privateHeaders })
}

async function readPreview(token, secret) {
  if (!/^[0-9a-f]{64}$/i.test(secret)) return null
  try {
    const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), value => value.charCodeAt(0))
    const keyBytes = Uint8Array.from(secret.match(/../g), hex => parseInt(hex, 16))
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
    const raw = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: context,
    }, key, bytes.subarray(12))
    const [objectKey, width, expires] = JSON.parse(new TextDecoder().decode(raw))
    const now = Math.floor(Date.now() / 1000)
    if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 65) return null
    if (width !== 640 && width !== 1200) return null
    if (typeof objectKey !== 'string' || !objectKey.startsWith('uploads/') ||
      !/\.(png|jpe?g)$/i.test(objectKey)) return null
    return { objectKey, width }
  } catch {
    return null
  }
}

function deliver(response) {
  return new Response(response.body, {
    headers: { ...privateHeaders, 'Content-Type': 'image/webp' },
  })
}

export default {
  async fetch(request, env, execution) {
    const url = new URL(request.url)
    const route = /^\/preview\/([A-Za-z0-9_-]{40,6000})$/.exec(url.pathname)
    if (request.method !== 'GET' || !route || url.search) return missing()
    const preview = await readPreview(route[1], env.PREVIEW_KEY)
    if (!preview) return missing()

    try {
      const original = await env.OUTLINE_ORIGINALS.head(preview.objectKey)
      if (!original) return missing()
      if (original.size > 20_000_000) return new Response(null, { status: 413, headers: privateHeaders })

      const identity = JSON.stringify([preview.objectKey, original.etag, preview.width, 'webp-85-v1'])
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const cacheKey = new Request(new URL('/_outline-image-cache/' + hash, url.origin))
      const cache = caches.default
      const cached = await cache.match(cacheKey)
      if (cached) return deliver(cached)

      const object = await env.OUTLINE_ORIGINALS.get(preview.objectKey, { onlyIf: { etagMatches: original.etag } })
      if (!object?.body) return missing()
      const result = await env.IMAGES.input(object.body)
        .transform({ width: preview.width, fit: 'scale-down' })
        .output({ format: 'image/webp', quality: 85 })
      const transformed = result.response()
      if (!transformed.ok || transformed.headers.get('Content-Type') !== 'image/webp') {
        return new Response(null, { status: 502, headers: privateHeaders })
      }
      const internal = new Response(transformed.body, {
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' },
      })
      execution.waitUntil(cache.put(cacheKey, internal.clone()).catch(() => {}))
      return deliver(internal)
    } catch {
      return new Response(null, { status: 502, headers: privateHeaders })
    }
  },
}
