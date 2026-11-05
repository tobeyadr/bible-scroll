import { BOOKS, HUES, OT_COUNT, nextChapter, prevChapter, refLabel, slug, parseHash } from './books.js'
import { parseChapter, plainText } from './parse.js'
import { SOURCES } from './sources.js'
import { ENABLED, DEFAULT_TRANSLATION, SHOW_SHARE, SHOW_ASK } from './config.js'
import { $, make } from './dom.js'
import { createState } from './state.js'
import { createSync } from './sync.js'
import { initSyncUI, statusLabel } from './syncui.js'
import { initSearch } from './searchui.js'
import { initPicker } from './pick.js'
import { splitRefs } from './refs.js'
import { initAsk } from './ask.js'
import { snippet } from './search.js'
import { createArt } from './artui.js'

// ---------- localStorage (everything is optional; the app works without it) ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('bs:' + key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('bs:' + key, JSON.stringify(value))
    } catch {}
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('bs:'))
        .forEach(k => localStorage.removeItem(k))
    } catch {}
  },
}

const settings = { scale: 1, theme: 'auto', translation: DEFAULT_TRANSLATION, ...store.get('settings', {}) }

// Saved passages, notes and reading position live in state.js and are what sync carries between devices.
const storage = (() => {
  try {
    localStorage.setItem('bs:probe', '1')
    localStorage.removeItem('bs:probe')
    return localStorage
  } catch {
    const memory = new Map() // storage blocked (e.g. some private modes): work for this visit only
    return { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) }
  }
})()
const state = createState(storage)
const sync = createSync({ state, storage })

// The translation in use, falling back if a saved choice is no longer offered.
const source = () => SOURCES[ENABLED.includes(settings.translation) ? settings.translation : ENABLED[0]]
// What search reads: the translation in use when it ships with the app, otherwise the BSB.
const searchSource = () => (source().book ? source() : SOURCES.BSB)

// ---------- theme / text size ----------

const prefersLight = matchMedia('(prefers-color-scheme: light)')

// The Illustrated theme puts a picture behind each card (public/art.js picks it, public/artui.js shows it).
const art = createArt({ isOn: () => settings.theme === 'illustrated' })

function applyTheme() {
  const theme = settings.theme === 'auto' ? (prefersLight.matches ? 'light' : 'dark') : settings.theme
  document.documentElement.dataset.theme = theme
  $('meta[name="theme-color"]').content = { light: '#f1ebdd', paper: '#e9dfc9', dark: '#0b1020', illustrated: '#0b1020' }[theme]
  document.querySelectorAll('[data-theme-choice]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === settings.theme)),
  )
}
prefersLight.addEventListener('change', applyTheme)

function applyScale() {
  document.documentElement.style.setProperty('--scale', settings.scale)
  $('#scale').value = settings.scale
}

// ---------- chapter fetching ----------

const chapterCache = new Map()

function loadChapter(b, c) {
  const src = source()
  const key = `${src.id}.${b}.${c}`
  if (!chapterCache.has(key)) {
    const request = src.text(b, c).then(parseChapter)
    request.catch(() => chapterCache.delete(key))
    chapterCache.set(key, request)
    if (chapterCache.size > 12) chapterCache.delete(chapterCache.keys().next().value)
  }
  return chapterCache.get(key)
}

// ---------- rendering ----------

const feed = $('#feed')

const ICON = {
  heart: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.700 3.900 4.500 7.100 4.500c2 0 3.700 1.100 4.900 2.900 1.200-1.800 2.900-2.900 4.900-2.900 3.200 0 5.400 3.200 4.300 6.600-1.700 4.800-9.200 9.400-9.200 9.400z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.600 7.100L3 21l1.900-5.400A8 8 0 1 1 21 12z"/></svg>',
  ask: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900zM19 15l.8 2.200L22 18l-2.200.8L19 21l-.8-2.200L16 18l2.200-.8z"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.600-6.400L21 8M21 3v5h-5"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.500A2.500 2.500 0 0 1 6.500 3H20v15H6.500A2.500 2.500 0 0 0 4 20.500zM4 20.500A2.500 2.500 0 0 0 6.500 23H20v-5"/></svg>',
}

function addVerseText(parent, text) {
  text.split(/\[(\d+)\]/).forEach((part, i) => {
    if (i % 2) parent.append(make('sup', null, part))
    else if (part) parent.append(document.createTextNode(part))
  })
}

function renderBlock(block) {
  if (block.type === 'prose') {
    const p = make('p', block.cont ? 'cont' : '')
    addVerseText(p, block.lines[0].t)
    return p
  }
  const poem = make('div', block.cont ? 'poem cont' : 'poem')
  for (const line of block.lines) {
    const row = make('div', 'line')
    row.style.setProperty('--lvl', line.lvl)
    addVerseText(row, line.t)
    poem.append(row)
  }
  return poem
}

const cardKey = (b, c, v1, v2) => `${b}.${c}.${v1}-${v2}`

function renderCard(b, c, card, index, total) {
  const sec = make('section', 'card')
  sec.dataset.b = b
  sec.dataset.c = c
  sec.dataset.v1 = card.v1
  sec.dataset.v2 = card.v2
  sec.dataset.i = index
  sec.dataset.n = total
  sec.style.setProperty('--h', (HUES[BOOKS[b].g] + ((c * 4) % 24)) % 360)
  sec.plain = plainText(card)

  const body = make('div', 'body')
  const text = make('div', 'text')
  if (index === 0) text.append(make('div', 'chapter-title', `${BOOKS[b].n} ${c}`))
  card.blocks.forEach(block => text.append(renderBlock(block)))
  body.append(text)

  const foot = make('div', 'foot')
  foot.append(make('div', 'ref', refLabel(b, c, card.v1, card.v2)), make('div', 'sub', source().mark))

  const rail = make('div', 'rail')
  rail.append(...railButtons(isSaved(cardKey(b, c, card.v1, card.v2))), railButton('jump', 'Books', 'Choose a book and chapter', ICON.book))

  sec.append(body, foot, rail)
  refreshBadge(sec)
  art.attach(sec)
  return sec
}

function railButton(act, label, aria, icon, cls = '') {
  const btn = make('button', cls)
  btn.dataset.act = act
  btn.hidden = act === 'redo' // shown by public/artui.js once the card has a picture
  btn.setAttribute('aria-label', aria)
  const badge = act === 'notes' ? '<i class="badge" hidden></i>' : ''
  btn.innerHTML = `<span class="disc">${icon}${badge}</span><span>${label}</span>`
  return btn
}

const railButtons = saved => [
  railButton('save', 'Save', 'Save this passage', ICON.heart, 'heart' + (saved ? ' on' : '')),
  railButton('notes', 'Notes', 'Your notes on this passage', ICON.note),
  ...(SHOW_ASK ? [railButton('ask', 'Ask', 'Ask a question about this passage', ICON.ask)] : []),
  railButton('redo', 'Redo', 'Paint a new picture for this scene', ICON.redo),
  ...(SHOW_SHARE ? [railButton('share', 'Share', 'Share this passage', ICON.share)] : []),
]

// One verse found by search, as a card in the results feed. "Read" opens it in the chapter.
function renderResult(verse, query) {
  const { b, c, v } = verse
  const src = searchSource()
  const sec = make('section', 'card')
  Object.assign(sec.dataset, { b, c, v1: v, v2: v, src: src.id })
  sec.style.setProperty('--h', (HUES[BOOKS[b].g] + ((c * 4) % 24)) % 360)
  sec.plain = verse.text

  const text = make('div', 'text')
  const p = make('p')
  p.append(make('sup', null, v))
  for (const seg of snippet(verse.text, query, 700)) p.append(seg.hit ? make('mark', null, seg.t) : seg.t)
  text.append(p)
  const body = make('div', 'body')
  body.append(text)

  // "Keep reading" opens the verse in its chapter, and the reading feed carries on through the book from there.
  const readOn = make('button', 'btn read-on', 'Keep reading ›')
  readOn.dataset.act = 'open'
  readOn.setAttribute('aria-label', `Keep reading from ${refLabel(b, c, v)}`)
  const foot = make('div', 'foot')
  foot.append(make('div', 'ref', refLabel(b, c, v)), make('div', 'sub', src.mark), readOn)

  const rail = make('div', 'rail')
  rail.append(...railButtons(isSaved(cardKey(b, c, v, v))))

  sec.append(body, foot, rail)
  refreshBadge(sec)
  art.attach(sec)
  return sec
}

function refreshBadge(sec) {
  const count = state.notesFor(+sec.dataset.b, +sec.dataset.c, +sec.dataset.v1, +sec.dataset.v2).length
  const badge = $('.badge', sec)
  badge.hidden = !count
  badge.textContent = count
}

// After anything that can change notes or saved passages behind the cards' backs (notes edits, sync).
function refreshCards() {
  document.querySelectorAll('.card:not(.note)').forEach(sec => {
    refreshBadge(sec)
    $('.heart', sec).classList.toggle('on', state.isSaved(cardKey(sec.dataset.b, sec.dataset.c, sec.dataset.v1, sec.dataset.v2)))
  })
}

function noteCard(cls, title, message, actionLabel, onAction) {
  const sec = make('section', `card note ${cls}`)
  if (cls.includes('loading')) sec.append(make('div', 'spinner'))
  if (title) sec.append(make('h3', null, title))
  if (message) sec.append(make('p', null, message))
  if (actionLabel) {
    const btn = make('button', 'btn', actionLabel)
    btn.addEventListener('click', onAction)
    sec.append(btn)
  }
  return sec
}

// Shrink a card's text until it fits the screen.
function fit(sec) {
  const body = $('.body', sec)
  const text = $('.text', sec)
  if (!body || !text) return
  let f = 1
  text.style.setProperty('--fit', f)
  while (text.offsetHeight > body.clientHeight + 1 && f > 0.55) {
    f -= 0.05
    text.style.setProperty('--fit', f.toFixed(2))
  }
}
const fitAll = () => document.querySelectorAll('.card:not(.note)').forEach(fit)

// ---------- the endless feed ----------

let loaded = [] // chapters currently in the DOM, in order: [{ b, c }]
let current = null
let busy = { 1: false, '-1': false } // a chapter is loading at the end (1) / start (-1)
let generation = 0
let atEnd = false

// Adding or removing cards above the one being read shifts everything under the reader. While a swipe
// is still gliding, the phone keeps heading for the old destination and overshoots by however many
// cards moved (it landed several verses, even chapters, too far on). So anything that changes the DOM
// above the screen waits until the feed has been still for a moment. Adding below is always safe.
let lastScroll = 0
let touching = false
feed.addEventListener('scroll', () => (lastScroll = performance.now()), { passive: true })
feed.addEventListener('touchstart', () => (touching = true), { passive: true })
for (const type of ['touchend', 'touchcancel']) {
  feed.addEventListener(type, () => {
    touching = false
    lastScroll = performance.now()
  }, { passive: true })
}
const STILL_FOR = 250
const whenStill = () =>
  new Promise(resolve => {
    const check = () => (!touching && performance.now() - lastScroll > STILL_FOR ? resolve() : setTimeout(check, 100))
    check()
  })

const observer = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (resizeAnchor) return
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6 && !entry.target.classList.contains('note')) {
        onCurrent(entry.target)
      }
    }
  },
  { root: feed, threshold: [0.6] },
)

// Run a DOM change without the visible card jumping.
function keepAnchor(change) {
  if (!current || !current.isConnected) return change()
  const offset = current.offsetTop - feed.scrollTop
  feed.style.scrollSnapType = 'none'
  change()
  feed.scrollTop = current.offsetTop - offset
  requestAnimationFrame(() => (feed.style.scrollSnapType = ''))
}

function chapterCards(t) {
  return [...feed.querySelectorAll(`.card[data-b="${t.b}"][data-c="${t.c}"]`)]
}

function dropChapter(t) {
  const cards = chapterCards(t)
  cards.forEach(card => observer.unobserve(card))
  keepAnchor(() => cards.forEach(card => card.remove()))
  loaded = loaded.filter(x => !(x.b === t.b && x.c === t.c))
  atEnd = atEnd && loaded.length > 0 && !nextChapter(loaded.at(-1).b, loaded.at(-1).c)
}

// Keep a few chapters either side of the one being read. Only called once the feed is still.
function prune() {
  while (current?.isConnected && loaded.length > 5) {
    const at = loaded.findIndex(x => x.b === +current.dataset.b && x.c === +current.dataset.c)
    if (at < 0) return
    if (at > 2) dropChapter(loaded[0])
    else if (loaded.length - 1 - at > 2) dropChapter(loaded.at(-1))
    else return
  }
}

function clearTail() {
  feed.querySelectorAll('.tail').forEach(n => n.remove())
}

function insertChapter(dir, t, cards) {
  const nodes = cards.map((card, i) => renderCard(t.b, t.c, card, i, cards.length))
  if (dir > 0) {
    clearTail()
    feed.append(...nodes)
    loaded.push(t)
  } else {
    keepAnchor(() => feed.prepend(...nodes))
    loaded.unshift(t)
  }
  nodes.forEach(node => observer.observe(node))
  nodes.forEach(fit)
  return nodes
}

async function extend(dir) {
  if (busy[dir] || !loaded.length) return
  const edge = dir > 0 ? loaded.at(-1) : loaded[0]
  const target = dir > 0 ? nextChapter(edge.b, edge.c) : prevChapter(edge.b, edge.c)
  if (!target) {
    if (dir > 0 && !atEnd) {
      atEnd = true
      const end = noteCard('tail end', 'The end', 'You have scrolled through the whole Bible.', 'Back to Genesis 1', () =>
        openAt(0, 1, 1),
      )
      feed.append(end)
    }
    return
  }

  busy[dir] = true
  const g = generation
  if (dir > 0 && !feed.querySelector('.tail')) feed.append(noteCard('tail loading', '', ''))
  try {
    const cards = await loadChapter(target.b, target.c)
    if (g !== generation) return
    if (dir < 0) {
      await whenStill()
      if (g !== generation) return
    }
    // Make sure the edge this chapter was meant to follow is still the edge.
    const now = dir > 0 ? loaded.at(-1) : loaded[0]
    if (!now || now.b !== edge.b || now.c !== edge.c) {
      if (dir > 0) clearTail()
      return
    }
    insertChapter(dir, target, cards)
    whenStill().then(() => g === generation && prune())
  } catch (err) {
    if (g !== generation) return
    clearTail()
    if (dir > 0) {
      feed.append(
        noteCard('tail error', "Couldn't load the next chapter", err.message, 'Try again', () => {
          clearTail()
          extend(1)
        }),
      )
    }
  } finally {
    if (g === generation) busy[dir] = false
  }
}

async function openAt(b, c, verse = 1) {
  const g = ++generation
  if (!startingUp) arm() // navigating on purpose counts as reading from here
  startingUp = false
  busy = { 1: false, '-1': false }
  atEnd = false
  loaded = []
  current = null
  observer.disconnect()
  feed.replaceChildren(noteCard('loading', '', ''))
  updateChrome({ b, c })

  let cards
  try {
    cards = await loadChapter(b, c)
  } catch (err) {
    if (g !== generation) return
    feed.replaceChildren(noteCard('error', "Couldn't load this chapter", err.message, 'Try again', () => openAt(b, c, verse)))
    return
  }
  if (g !== generation) return

  feed.replaceChildren()
  const nodes = insertChapter(1, { b, c }, cards)
  const target = nodes.find(n => +n.dataset.v1 <= verse && verse <= +n.dataset.v2) || nodes[0]
  feed.style.scrollSnapType = 'none'
  feed.scrollTop = target.offsetTop
  requestAnimationFrame(() => (feed.style.scrollSnapType = ''))
  onCurrent(target)
}

// ---------- current card bookkeeping ----------

let saveTimer
let posArmed = true
let startingUp = false // true only for the automatic restore of her last place
const arm = () => (posArmed = true)
for (const type of ['pointerdown', 'wheel', 'touchstart']) feed.addEventListener(type, arm, { passive: true })
document.addEventListener('keydown', arm)
function onCurrent(sec) {
  current = sec
  const b = +sec.dataset.b
  const c = +sec.dataset.c
  updateChrome({ b, c, i: +sec.dataset.i, n: +sec.dataset.n })

  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // Opening the app re-selects the saved card; that is not a move, so it must not look newer than
    // a position another device synced in the meantime. Only record once she has touched the feed
    // or navigated somewhere herself.
    if (posArmed) state.setPos({ b, c, v: +sec.dataset.v1 })
  }, 400)

  let ahead = sec
  for (let i = 0; i < 3 && ahead; i++) ahead = ahead.nextElementSibling
  if (!ahead || ahead.classList.contains('tail')) extend(1)

  let behind = sec
  for (let i = 0; i < 2 && behind; i++) behind = behind.previousElementSibling
  if (!behind) extend(-1)
}

function updateChrome({ b, c, i, n }) {
  $('#chipLabel').textContent = `${BOOKS[b].n} ${c}`
  $('#progress i').style.width = n ? `${((i + 1) / n) * 100}%` : '0'
  document.title = `${BOOKS[b].n} ${c} · Bible Scroll`
}

// ---------- saving, sharing ----------

const isSaved = key => state.isSaved(key)

function setSaved(sec, on) {
  const { b, c, v1, v2 } = sec.dataset
  state.setSaved({ k: cardKey(b, c, v1, v2), b: +b, c: +c, v1: +v1, v2: +v2 }, on)
  $('.heart', sec).classList.toggle('on', on)
}

function toggleSaved(sec) {
  const { b, c, v1, v2 } = sec.dataset
  const on = !isSaved(cardKey(b, c, v1, v2))
  setSaved(sec, on)
  toast(on ? 'Saved' : 'Removed from saved')
}

async function share(sec) {
  const { b, c, v1, v2 } = sec.dataset
  const ref = refLabel(+b, +c, +v1, +v2)
  const link = `${location.origin}/#${slug(+b)}-${c}-${v1}`
  const text = `“${sec.plain}”\n— ${ref} (${sec.dataset.src || source().id})`
  try {
    if (navigator.share) {
      await navigator.share({ text, url: link })
    } else {
      await navigator.clipboard.writeText(`${text}\n${link}`)
      toast('Copied to clipboard')
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast("Couldn't share")
  }
}

// Paints a new picture for this card's scene. It costs a few cents and takes up to a minute, so it asks first.
async function redoArt(sec, button) {
  if (button.disabled) return
  if (!confirm('Paint a new picture for this scene? It takes up to a minute and replaces the current one.')) return
  button.disabled = true
  button.classList.add('busy')
  toast('Painting a new picture…')
  try {
    await art.redo(sec)
    toast('New picture ready')
  } catch (err) {
    toast(err.message)
  } finally {
    button.disabled = false
    button.classList.remove('busy')
  }
}

let toastTimer
// An optional action ({ label, run }) adds a button and keeps the toast up a little longer.
function toast(message, action) {
  const node = $('#toast')
  node.replaceChildren(message)
  node.classList.toggle('has-action', !!action)
  if (action) {
    const btn = make('button', null, action.label)
    btn.addEventListener('click', () => {
      node.classList.remove('show')
      action.run()
    })
    node.append(btn)
  }
  node.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => node.classList.remove('show'), action ? 9000 : 1600)
}

function burst(sec, x, y) {
  const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  heart.setAttribute('viewBox', '0 0 24 24')
  heart.setAttribute('class', 'burst')
  heart.innerHTML = '<path d="M12 20.500s-7.500-4.600-9.200-9.400C1.700 7.700 3.900 4.500 7.100 4.500c2 0 3.700 1.100 4.900 2.900 1.200-1.800 2.900-2.900 4.900-2.900 3.200 0 5.400 3.200 4.300 6.600-1.700 4.800-9.200 9.400-9.200 9.400z"/>'
  heart.style.left = `${x}px`
  heart.style.top = `${y}px`
  sec.append(heart)
  setTimeout(() => heart.remove(), 800)
}

// ---------- gestures ----------

// The reading feed and the search results are both lists of cards with the same buttons and gestures.
function wireCards(container, onAct = {}) {
  container.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]')
    if (!button) return
    const sec = button.closest('.card')
    const act = button.dataset.act
    if (act === 'save') toggleSaved(sec)
    else if (act === 'notes') openNotes(sec)
    else if (act === 'ask') openAsk(sec)
    else if (act === 'redo') redoArt(sec, button)
    else if (act === 'share') share(sec)
    else onAct[act]?.(sec)
  })

  // Double-tap anywhere on a card to save it, like a TikTok like.
  let lastTap = { t: 0, x: 0, y: 0 }
  container.addEventListener('pointerup', event => {
    if (event.pointerType === 'mouse' || event.target.closest('button')) return
    const sec = event.target.closest('.card:not(.note)')
    if (!sec) return
    const now = Date.now()
    const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40
    if (now - lastTap.t < 320 && near) {
      if (!isSaved(cardKey(sec.dataset.b, sec.dataset.c, sec.dataset.v1, sec.dataset.v2))) setSaved(sec, true)
      const rect = sec.getBoundingClientRect()
      burst(sec, event.clientX - rect.left, event.clientY - rect.top)
      wordPicker.quiet()
      lastTap.t = 0
    } else {
      lastTap = { t: now, x: event.clientX, y: event.clientY }
    }
  })
  container.addEventListener('dblclick', event => {
    const sec = event.target.closest('.card:not(.note)')
    if (!sec || event.target.closest('button')) return
    if (!isSaved(cardKey(sec.dataset.b, sec.dataset.c, sec.dataset.v1, sec.dataset.v2))) setSaved(sec, true)
    const rect = sec.getBoundingClientRect()
    burst(sec, event.clientX - rect.left, event.clientY - rect.top)
    wordPicker.quiet()
  })
}

wireCards(feed, { jump: () => openPicker() })

document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || !$('#searchPage').hidden || event.metaKey || event.ctrlKey || event.altKey) return
  const step = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  feed.scrollBy({ top: step * feed.clientHeight, behavior: 'smooth' })
})

// ---------- sheets ----------

function openSheet(sheet) {
  if (!sheet.open) sheet.showModal()
}

document.querySelectorAll('dialog.sheet').forEach(sheet => {
  $('.close', sheet).addEventListener('click', () => sheet.close())
  sheet.addEventListener('click', event => {
    if (event.target === sheet) sheet.close()
  })
})

// book + chapter picker
const picker = $('#pickerSheet')
let pickerTab = 'ot'

function openPicker() {
  pickerTab = current && +current.dataset.b >= OT_COUNT ? 'nt' : 'ot'
  renderBooks()
  openSheet(picker)
}

function renderBooks() {
  $('h2', picker).textContent = 'Books'
  $('.back', picker).hidden = true
  const body = $('.sheet-body', picker)
  const tabs = make('div', 'tabs')
  for (const [id, label] of [['ot', 'Old Testament'], ['nt', 'New Testament']]) {
    const tab = make('button', null, label)
    tab.setAttribute('aria-pressed', String(pickerTab === id))
    tab.addEventListener('click', () => {
      pickerTab = id
      renderBooks()
    })
    tabs.append(tab)
  }
  const grid = make('div', 'grid')
  const from = pickerTab === 'ot' ? 0 : OT_COUNT
  const to = pickerTab === 'ot' ? OT_COUNT : BOOKS.length
  for (let b = from; b < to; b++) {
    const btn = make('button', current && +current.dataset.b === b ? 'cur' : '', BOOKS[b].n)
    btn.addEventListener('click', () => (BOOKS[b].c === 1 ? choose(b, 1) : renderChapters(b)))
    grid.append(btn)
  }
  body.replaceChildren(tabs, grid)
}

function renderChapters(b) {
  $('h2', picker).textContent = BOOKS[b].n
  $('.back', picker).hidden = false
  const grid = make('div', 'grid chapters')
  for (let c = 1; c <= BOOKS[b].c; c++) {
    const btn = make('button', current && +current.dataset.b === b && +current.dataset.c === c ? 'cur' : '', String(c))
    btn.addEventListener('click', () => choose(b, c))
    grid.append(btn)
  }
  $('.sheet-body', picker).replaceChildren(grid)
}

function choose(b, c) {
  picker.close()
  openAt(b, c, 1)
}

$('.back', picker).addEventListener('click', renderBooks)
$('#chip').addEventListener('click', openPicker)

// saved passages and the list of all notes
const savedSheet = $('#savedSheet')
let savedTab = 'saved'

function renderSaved() {
  const body = $('.sheet-body', savedSheet)
  const tabs = make('div', 'tabs inline')
  for (const [id, label] of [['saved', 'Saved'], ['notes', 'Notes']]) {
    const tab = make('button', null, label)
    tab.setAttribute('aria-pressed', String(savedTab === id))
    tab.addEventListener('click', () => {
      savedTab = id
      renderSaved()
    })
    tabs.append(tab)
  }

  const jump = item => {
    savedSheet.close()
    openAt(item.b, item.c, item.v1)
  }

  const items = savedTab === 'saved' ? state.savedList() : state.noteList()
  if (!items.length) {
    const hint =
      savedTab === 'saved'
        ? 'Nothing saved yet. Tap the heart, or double-tap a passage, to keep it here.'
        : 'No notes yet. Tap Notes on any passage to write your thoughts.'
    body.replaceChildren(tabs, make('p', 'empty', hint))
    return
  }

  const list = make('ul', 'list')
  for (const item of items) {
    const li = make('li')
    const go = make('button', 'go', refLabel(item.b, item.c, item.v1, item.v2))
    if (savedTab === 'notes') go.append(make('span', 'snippet', item.text))
    go.addEventListener('click', () => jump(item))
    li.append(go)
    if (savedTab === 'saved') {
      const rm = make('button', 'rm', '×')
      rm.setAttribute('aria-label', `Remove ${refLabel(item.b, item.c, item.v1, item.v2)}`)
      rm.addEventListener('click', () => {
        state.setSaved(item, false)
        refreshCards()
        renderSaved()
      })
      li.append(rm)
    }
    list.append(li)
  }
  body.replaceChildren(tabs, list)
}

$('#savedBtn').addEventListener('click', () => {
  renderSaved()
  openSheet(savedSheet)
})

// search page (over the translation being read; the ESV is not bundled, so it searches the BSB)
const searchUI = initSearch({ page: $('#searchPage'), getSource: searchSource, renderResult, fit, go: openAt, store })
wireCards($('#searchResults'), {
  open(sec) {
    searchUI.close()
    openAt(+sec.dataset.b, +sec.dataset.c, +sec.dataset.v1)
  },
})
$('#searchBtn').addEventListener('click', () => searchUI.open())
// Tap a word, or select a few, in the feed or in search results to search for them.
const wordPicker = initPicker({ containers: [feed, $('#searchResults')], onSearch: text => searchUI.open(text) })
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
  if (document.querySelector('dialog[open]') || searchUI.isOpen() || /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return
  event.preventDefault()
  searchUI.open()
})

// notes on one passage
const notesSheet = $('#notesSheet')
let noteTarget = null // { b, c, v1, v2 } of the card the sheet was opened from
let editingId = null
const NOTE_MAX = 2000

// Reads like a comment thread: newest first, "You" with a time, and a composer pinned underneath.
function timeAgo(ms) {
  const minutes = Math.floor(Math.max(0, Date.now() - ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const composer = {
  field: $('#noteField'),
  send: $('#noteSend'),
  banner: $('#noteEditing'),
}

function resizeComposer() {
  composer.field.style.height = 'auto'
  composer.field.style.height = `${Math.max(40, Math.min(composer.field.scrollHeight, 120))}px`
  composer.send.disabled = !composer.field.value.trim()
}

function setEditing(note) {
  editingId = note ? note.k : null
  composer.banner.hidden = !note
  composer.field.value = note ? note.text : ''
  composer.field.placeholder = 'Add a note…'
  resizeComposer()
  if (note) composer.field.focus()
}

function openNotes(sec) {
  noteTarget = { b: +sec.dataset.b, c: +sec.dataset.c, v1: +sec.dataset.v1, v2: +sec.dataset.v2 }
  setEditing(null)
  renderNotesFeed()
  openSheet(notesSheet)
  resizeComposer() // measured once the sheet is on screen
}

// A note's text, with scripture references in it ("John 3:16", "1 Cor 13:4-7") as links that open that verse.
function noteText(text) {
  const p = make('p', 'cmt-text')
  for (const part of splitRefs(text)) {
    if (!part.ref) {
      p.append(part.t)
      continue
    }
    const { b, c, v } = part.ref
    const link = make('button', 'ref-link', part.t)
    link.type = 'button'
    link.setAttribute('aria-label', `Go to ${refLabel(b, c, part.ref.verse ? v : undefined)}`)
    link.addEventListener('click', () => {
      notesSheet.close()
      searchUI.close() // the notes may have been opened from a search result
      openAt(b, c, v)
    })
    p.append(link)
  }
  return p
}

function renderNotesFeed(freshId) {
  const { b, c, v1, v2 } = noteTarget
  const notes = state.notesFor(b, c, v1, v2).reverse() // newest first
  $('h2', notesSheet).replaceChildren(`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`, make('small', 'ref-sub', refLabel(b, c, v1, v2)))

  const body = $('.sheet-body', notesSheet)
  if (!notes.length) {
    const empty = make('div', 'empty-feed')
    empty.innerHTML = ICON.note
    empty.append(make('p', null, 'No notes yet. Write what this passage means to you. A reference like John 3:16 becomes a link.'))
    body.replaceChildren(empty)
    return
  }

  const list = make('ul', 'feed-list')
  for (const note of notes) {
    const li = make('li', 'cmt' + (note.k === freshId ? ' fresh' : ''))
    li.append(make('div', 'avatar'))

    const head = make('div', 'cmt-head')
    head.append(make('strong', null, 'You'), make('span', 'cmt-time', timeAgo(note.at)))
    if (note.u - note.at > 60000) head.append(make('span', 'cmt-time', '· edited'))
    if (note.v1 !== v1 || note.v2 !== v2) head.append(make('span', 'cmt-ref', refLabel(note.b, note.c, note.v1, note.v2)))

    const actions = make('div', 'cmt-actions')
    const edit = make('button', null, 'Edit')
    edit.addEventListener('click', () => setEditing(note))
    const del = make('button', null, 'Delete')
    del.addEventListener('click', () => {
      if (!confirm('Delete this note?')) return
      state.deleteNote(note.k)
      if (editingId === note.k) setEditing(null)
      refreshCards()
      renderNotesFeed()
    })
    actions.append(edit, del)

    const main = make('div', 'cmt-main')
    main.append(head, noteText(note.text), actions)
    li.append(main)
    list.append(li)
  }
  body.replaceChildren(list)
}

function postNote() {
  const text = composer.field.value.trim()
  if (!text) return
  const existing = editingId && state.snapshot().notes[editingId]
  const range = existing ? { b: existing.b, c: existing.c, v1: existing.v1, v2: existing.v2 } : noteTarget
  const id = state.saveNote({ id: editingId, ...range, text })
  setEditing(null)
  refreshCards()
  renderNotesFeed(id)
  $('.sheet-body', notesSheet).scrollTop = 0
}

composer.field.maxLength = NOTE_MAX
composer.field.addEventListener('input', resizeComposer)
composer.field.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    postNote()
  }
})
composer.send.addEventListener('click', postNote)
$('#noteEditing button').addEventListener('click', () => setEditing(null))

// questions about one passage (Workers AI through /api/ask)
const askSheet = $('#askSheet')
const asker = initAsk({
  sheet: askSheet,
  openRef(b, c, v) {
    askSheet.close()
    searchUI.close() // the question may have been asked from a search result
    openAt(b, c, v)
  },
})

function openAsk(sec) {
  asker.open({
    b: +sec.dataset.b,
    c: +sec.dataset.c,
    v1: +sec.dataset.v1,
    v2: +sec.dataset.v2,
    text: sec.plain || '',
    translation: sec.dataset.src || source().id,
  })
}

// On phones the on-screen keyboard can cover a bottom sheet; lift the sheet by however much it hides.
if (window.visualViewport) {
  const lift = () => {
    const hidden = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)
    for (const sheet of [notesSheet, askSheet]) sheet.style.setProperty('--kb', `${hidden}px`)
  }
  visualViewport.addEventListener('resize', lift)
  visualViewport.addEventListener('scroll', lift)
}

// settings
function renderTranslations() {
  $('#translationRow').hidden = ENABLED.length < 2
  const seg = $('#translationSeg')
  seg.replaceChildren(
    ...ENABLED.map(id => {
      const btn = make('button', null, id)
      btn.setAttribute('aria-pressed', String(source().id === id))
      btn.addEventListener('click', () => {
        if (source().id === id) return
        settings.translation = id
        store.set('settings', settings)
        renderTranslations()
        const here = current && { b: +current.dataset.b, c: +current.dataset.c, v: +current.dataset.v1 }
        if (here) openAt(here.b, here.c, here.v)
      })
      return btn
    }),
  )
  $('#notice').textContent = source().notice
}

$('#settingsBtn').addEventListener('click', () => {
  applyScale()
  applyTheme()
  renderTranslations()
  $('#syncState').textContent = statusLabel(sync.status())
  openSheet($('#settingsSheet'))
})

// sync
const syncUI = initSyncUI({ sync, sheet: $('#syncSheet'), openSheet, toast })
$('#syncBtn').addEventListener('click', () => {
  $('#settingsSheet').close()
  syncUI.open()
})
sync.onStatus(status => ($('#syncState').textContent = statusLabel(status)))
$('#scale').addEventListener('input', event => {
  settings.scale = Number(event.target.value)
  store.set('settings', settings)
  applyScale()
  fitAll()
})
document.querySelectorAll('[data-theme-choice]').forEach(btn =>
  btn.addEventListener('click', () => {
    settings.theme = btn.dataset.themeChoice
    store.set('settings', settings)
    applyTheme()
    art.refresh()
  }),
)
// Offer the Illustrated theme only when pictures ship with the app (the open-source repo has none until some are generated).
art.available().then(found => {
  $('[data-theme-choice="illustrated"]').hidden = !found && settings.theme !== 'illustrated'
})
$('#reset').addEventListener('click', () => {
  const syncNote = sync.isOn() ? ' Sync is turned off on this device; the synced copy and your other devices are not touched.' : ''
  if (!confirm(`Erase your place, saved passages, notes and settings on this device?${syncNote}`)) return
  store.clear()
  location.reload()
})

// Resizing or rotating changes the card height, which makes the browser re-snap to some other card.
// Remember the card that was showing when the resize began and put it back once the size settles.
let resizeTimer
let resizeAnchor = null
addEventListener('resize', () => {
  resizeAnchor ??= current
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const anchor = resizeAnchor
    resizeAnchor = null
    fitAll()
    if (anchor?.isConnected) {
      feed.style.scrollSnapType = 'none'
      feed.scrollTop = anchor.offsetTop
      requestAnimationFrame(() => (feed.style.scrollSnapType = ''))
      onCurrent(anchor)
    }
  }, 150)
})

// ---------- start ----------

applyTheme()
applyScale()

// Returns true when the URL held a shared passage link (e.g. #john-3-16) and opened it.
function openFromHash() {
  const link = parseHash(location.hash)
  if (!link) return false
  searchUI.close()
  history.replaceState(null, '', location.pathname)
  openAt(link.b, link.c, link.v)
  return true
}
// A link from another device (#sync=<secret>) joins this device to the synced data.
function joinFromHash() {
  const match = location.hash.match(/^#sync=([A-Za-z0-9_-]+)$/)
  if (!match) return
  history.replaceState(null, '', location.pathname) // keep the secret out of the address bar and history
  if (sync.isOn()) return toast('Sync is already on for this device')
  if (!confirm('Link this device to your synced notes and saved passages?')) return
  sync.join(match[1]).then(
    () => toast('Synced'),
    err => alert(err.message),
  )
}
addEventListener('hashchange', () => {
  joinFromHash()
  openFromHash()
})

joinFromHash()
if (!openFromHash()) {
  const pos = state.getPos()
  const valid = pos && BOOKS[pos.b] && pos.c >= 1 && pos.c <= BOOKS[pos.b].c
  startingUp = true
  posArmed = false // also when starting at Genesis 1: not reading yet, so no position to record
  openAt(valid ? pos.b : 0, valid ? pos.c : 1, valid ? pos.v : 1)
}

// Sync: push soon after a local change, and pull whenever the app comes back or the network returns.
state.onChange((source, previous) => {
  if (source === 'local') return sync.schedule()

  refreshCards()
  if (savedSheet.open) renderSaved()
  if (notesSheet.open && noteTarget) renderNotesFeed()

  // Offer to jump to where she was reading on another device.
  const pos = state.getPos()
  const from = current ? { b: +current.dataset.b, c: +current.dataset.c } : previous.pos
  if (pos && (!previous.pos || pos.u > previous.pos.u) && (!from || from.b !== pos.b || from.c !== pos.c)) {
    toast(`Pick up at ${refLabel(pos.b, pos.c, pos.v)}?`, { label: 'Go', run: () => openAt(pos.b, pos.c, pos.v) })
  }
})
document.addEventListener('visibilitychange', () => sync.syncNow())
addEventListener('online', () => sync.syncNow())
sync.syncNow()

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
