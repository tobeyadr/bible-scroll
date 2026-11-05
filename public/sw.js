// Caches the app shell, plus each BSB book file the first time it is read (public domain, so reading
// works offline afterwards). ESV text from /api/passage is never stored: its licence forbids it.
const CACHE = 'bible-scroll-v21'
// The Illustrated theme's pictures live in their own cache, so a new app version does not throw them away. Each is
// stored the first time it is shown and never re-downloaded: a redone picture has a new "?v=" in its address.
const ART_CACHE = 'bible-scroll-art'
const SHELL = [
  '/',
  '/app.js',
  '/art.js',
  '/artui.js',
  '/books.js',
  '/parse.js',
  '/sources.js',
  '/config.js',
  '/dom.js',
  '/state.js',
  '/merge.js',
  '/read.js',
  '/sync.js',
  '/keys.js',
  '/syncui.js',
  '/search.js',
  '/searchui.js',
  '/pick.js',
  '/searchhistory.js',
  '/refs.js',
  '/ask.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== ART_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Stale-while-revalidate: open instantly from cache, refresh in the background.
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return

  // A picture (/api/art/<id>?v=n): from the cache when it is there, otherwise fetch it once and keep it. Only a real
  // picture is kept, not the "still being painted" or error answers, and the plan that lists them (which changes) and
  // everything else under /api/ is left to the network.
  if (url.pathname.startsWith('/api/art/') && url.pathname !== '/api/art/plan') {
    event.respondWith(
      caches.open(ART_CACHE).then(async cache => {
        const cached = await cache.match(request)
        if (cached) return cached
        const res = await fetch(request)
        if (res.status === 200) cache.put(request, res.clone())
        return res
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
      const network = fetch(request)
        .then(res => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
