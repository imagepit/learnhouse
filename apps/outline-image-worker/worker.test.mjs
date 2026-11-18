import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from './worker.mjs'

const testKey = Buffer.alloc(32, 7)
const origin = 'https://preview.example.org'

async function ticket({ key = 'uploads/test.png', expires = Math.floor(Date.now() / 1000) + 60, width = 640 } = {}) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const secret = await crypto.subtle.importKey('raw', testKey, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode('learnhouse-outline-preview-v1'),
  }, secret, new TextEncoder().encode(JSON.stringify([key, width, expires])))
  return Buffer.concat([nonce, Buffer.from(ciphertext)]).toString('base64url')
}

test('accepts a current preview ticket before accessing R2 or the cached WebP', async () => {
  const entries = new Map()
  globalThis.caches = { default: {
    match: async request => entries.get(request.url)?.clone(),
    put: async (request, response) => entries.set(request.url, response),
  } }
  let etag = 'current'
  const calls = { head: 0, get: 0, transform: 0 }
  const env = {
    PREVIEW_KEY: testKey.toString('hex'),
    OUTLINE_ORIGINALS: {
      async head(key) {
        calls.head++
        assert.equal(key, 'uploads/test.png')
        return { size: 500, etag }
      },
      async get(key, options) {
        calls.get++
        assert.equal(key, 'uploads/test.png')
        assert.equal(options.onlyIf.etagMatches, etag)
        return new Response('image')
      },
    },
    IMAGES: {
      input(body) {
        calls.transform++
        assert.ok(body instanceof ReadableStream)
        return { transform(options) {
          assert.deepEqual(options, { width: 640, fit: 'scale-down' })
          return { output(output) {
            assert.deepEqual(output, { format: 'image/webp', quality: 85 })
            return { response: () => new Response('webp', { headers: { 'Content-Type': 'image/webp' } }) }
          } }
        } }
      },
    },
  }
  const queued = []
  const execution = { waitUntil: promise => queued.push(promise) }
  const fetchPreview = value => worker.fetch(new Request(origin + '/preview/' + value), env, execution)
  const valid = await ticket()
  const first = await fetchPreview(valid)
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(first.headers.get('Content-Type'), 'image/webp')
  assert.equal(await first.text(), 'webp')
  await Promise.all(queued)
  const cacheUrl = entries.keys().next().value
  assert.equal((await worker.fetch(new Request(cacheUrl), env, execution)).status, 404)

  const expired = await ticket({ expires: Math.floor(Date.now() / 1000) - 1 })
  const tampered = (valid.startsWith('A') ? 'B' : 'A') + valid.slice(1)
  for (const invalid of [expired, tampered, await ticket({ key: 'uploads/test.svg' }), await ticket({ width: 1201 })]) {
    assert.equal((await fetchPreview(invalid)).status, 404)
  }
  assert.deepEqual(calls, { head: 1, get: 1, transform: 1 })

  assert.equal(await (await fetchPreview(await ticket())).text(), 'webp')
  assert.deepEqual(calls, { head: 2, get: 1, transform: 1 })
  etag = 'updated'
  assert.equal(await (await fetchPreview(await ticket())).text(), 'webp')
  assert.deepEqual(calls, { head: 3, get: 2, transform: 2 })
})
