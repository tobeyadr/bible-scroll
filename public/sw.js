// Caches the app shell, plus each BSB book file the first time it is read (public domain, so reading
// works offline afterwards). ESV text from /api/passage is never stored: its licence forbids it.
const CACHE = 'bible-scroll-v17'
const SHELL = [
  '/',
  '/app.js',
  '/books.js',
  '/parse.js',
  '/sources.js',
  '/config.js',
  '/dom.js',
  '/state.js',
  '/merge.js',
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Stale-while-revalidate: open instantly from cache, refresh in the background.
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return

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
