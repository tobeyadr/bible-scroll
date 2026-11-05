import test from 'node:test'
import assert from 'node:assert/strict'

// Loads public/sw.js against a small fake of the service worker environment, then fires fetch and activate events.
const listeners = {}
const stores = new Map() // cache name -> Map(url -> response)
const fetched = []

const open = name => {
  if (!stores.has(name)) stores.set(name, new Map())
  const store = stores.get(name)
  return Promise.resolve({
    match: request => Promise.resolve(store.get(request.url)),
    put: (request, response) => Promise.resolve(store.set(request.url, response)),
    addAll: () => Promise.resolve(),
  })
}
globalThis.caches = {
  open,
  keys: () => Promise.resolve([...stores.keys()]),
  delete: name => Promise.resolve(stores.delete(name)),
}
globalThis.location = { origin: 'https://app.test' }
globalThis.fetch = async request => {
  fetched.push(request.url)
  const res = { ok: true, body: `network:${request.url}`, clone: () => res }
  return res
}
globalThis.self = {
  addEventListener: (type, fn) => (listeners[type] = fn),
  skipWaiting: () => {},
  clients: { claim: () => {} },
}
await import('../public/sw.js')

const get = async path => {
  let answer
  const request = { method: 'GET', url: `https://app.test${path}`, mode: 'cors' }
  listeners.fetch({ request, respondWith: p => (answer = p) })
  return answer && (await answer)
}

test('a picture is fetched once and then always served from its own cache', async () => {
  fetched.length = 0
  const first = await get('/art/book-john.webp?v=aaaa1111')
  assert.equal(first.body, 'network:https://app.test/art/book-john.webp?v=aaaa1111')
  const again = await get('/art/book-john.webp?v=aaaa1111')
  assert.equal(again, first)
  assert.equal(fetched.length, 1, 'only the first look goes to the network')
  assert.ok(stores.get('bible-scroll-art').has('https://app.test/art/book-john.webp?v=aaaa1111'))
})

test('a replaced picture has a new version in its address, so it is fetched again', async () => {
  fetched.length = 0
  await get('/art/book-john.webp?v=bbbb2222')
  assert.equal(fetched.length, 1)
})

test('the manifest is not treated as a picture: it is refreshed from the network each time', async () => {
  fetched.length = 0
  await get('/art/manifest.json')
  await get('/art/manifest.json')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetched.length, 2)
  assert.ok(!stores.get('bible-scroll-art').has('https://app.test/art/manifest.json'))
})

test('the API is left alone, and a new app version keeps the pictures but drops old app caches', async () => {
  assert.equal(await get('/api/passage?book=0&chapter=1'), undefined)
  stores.set('bible-scroll-v1', new Map())
  let done
  listeners.activate({ waitUntil: p => (done = p) })
  await done
  assert.ok(stores.has('bible-scroll-art'), 'pictures survive an update')
  assert.ok(!stores.has('bible-scroll-v1'), 'an old app cache is removed')
})
