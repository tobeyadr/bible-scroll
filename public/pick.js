// Tap a word, or select a few, and a small bar appears under it: Search, a palette to highlight the words, and a
// button to add a note on them. Tap an existing highlight to change its colour, add a note, or remove it.
// The pure helpers run in node tests.
import { COLORS } from './highlight.js'

const IN_WORD = /[\p{L}\p{M}\p{N}'’-]/u
const EDGE = /['’-]/
const ALNUM = /[\p{L}\p{N}]/u
const MAX_WORDS = 12

// The word around `offset` in `text` as [start, end), or null when the offset is not on a word.
export function wordBounds(text, offset) {
  let start = offset
  let end = offset
  while (start > 0 && IN_WORD.test(text[start - 1])) start--
  while (end < text.length && IN_WORD.test(text[end])) end++
  while (start < end && EDGE.test(text[start])) start++
  while (end > start && EDGE.test(text[end - 1])) end--
  return end > start && ALNUM.test(text.slice(start, end)) ? [start, end] : null
}

// Selected text -> what to type in the search box: one word as is, several as a "quoted phrase".
export function toQuery(text) {
  const words = text
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .slice(0, MAX_WORDS)
  if (!words.length) return ''
  return words.length === 1 ? words[0] : `"${words.join(' ')}"`
}

// ---------- DOM ----------

const blockOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('.text p, .text .line')
const textHost = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('.text')

// The text nodes of a verse line, verse numbers left out, with where each one starts in the joined string.
function blockText(block) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const parts = []
  let text = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    parts.push({ node: n, from: text.length })
    text += n.data
  }
  return { parts, text }
}

// A search hit is split into several text nodes ("love" in a <mark>, "d" after it), so a word is found
// across the whole line rather than inside one node.
function wordRangeAt(node, offset) {
  const block = blockOf(node)
  if (!block) return null
  const { parts, text } = blockText(block)
  const at = parts.find(p => p.node === node)
  if (!at) return null
  const bounds = wordBounds(text, at.from + offset)
  if (!bounds) return null
  const [s, e] = bounds
  const first = parts.findLast(p => p.from <= s)
  const last = parts.findLast(p => p.from < e)
  const range = document.createRange()
  range.setStart(first.node, s - first.from)
  range.setEnd(last.node, e - last.from)
  return range
}

function selectedText(range) {
  const walker = document.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const parts = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.data)
  return parts.join(' ')
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y)
    return p && { node: p.offsetNode, offset: p.offset }
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r && { node: r.startContainer, offset: r.startOffset }
}

const near = (rect, x, y, slop = 10) => x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop

const NOTE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.600 7.100L3 21l1.900-5.400A8 8 0 1 1 21 12z"/></svg>'

const button = (cls, label) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  if (label) b.setAttribute('aria-label', label)
  return b
}

// containers: the lists of cards to watch. onSearch(query) is called when Search is tapped.
// marks (optional) turns on highlighting for the cards inside marks.container:
//   add(range, color)   highlight the selected words        recolor(id, color)   change a highlight's colour
//   note(range)         add a note quoting the selected words    noteOn(id)       add a note quoting a highlight
//   remove(id)          take a highlight away
export function initPicker({ containers, onSearch, marks }) {
  const bar = document.createElement('div')
  bar.id = 'pickBar'
  bar.hidden = true
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Selected words')

  const search = button('pick-search')
  const row = document.createElement('div')
  row.className = 'pick-row'
  const dots = COLORS.map(color => {
    const dot = button(`pick-dot hl-${color}`, `Highlight ${color}`)
    dot.dataset.color = color
    return dot
  })
  const note = button('pick-note', 'Add a note on these words')
  note.innerHTML = NOTE_ICON
  const remove = button('pick-del', 'Remove highlight')
  remove.textContent = '×'
  row.append(...dots, note, remove)
  bar.append(search, row)
  document.body.append(bar)

  let query = ''
  let current = null // { range } for selected words, or { id } for a highlight that was tapped
  let tapTimer
  let selTimer
  let quietUntil = 0

  const hide = () => {
    bar.hidden = true
    query = ''
    current = null
  }

  // Under the words (clear of the phone's own menu and selection handles), or above when there is no room.
  function place(box, last) {
    const touch = matchMedia('(pointer: coarse)').matches
    const width = bar.offsetWidth
    const height = bar.offsetHeight
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, 12), innerWidth - width - 12)
    let top = last.bottom + (touch ? 44 : 10)
    if (top + height + 8 > innerHeight) top = box.top - height - 8
    bar.style.left = `${left}px`
    bar.style.top = `${Math.max(top, 8)}px`
  }

  function show(range, text, canMark) {
    query = text
    current = { range: range.cloneRange() }
    const shown = text.replace(/"/g, '')
    search.hidden = false
    search.textContent = `Search “${shown.length > 28 ? shown.slice(0, 27) + '…' : shown}”`
    row.hidden = !canMark
    remove.hidden = true
    for (const dot of dots) dot.removeAttribute('aria-pressed')
    bar.hidden = false
    const rects = range.getClientRects()
    place(range.getBoundingClientRect(), rects[rects.length - 1] || range.getBoundingClientRect())
  }

  // A highlight that was tapped.
  function showMark(markEl) {
    query = ''
    current = { id: markEl.dataset.hid }
    const color = COLORS.find(c => markEl.classList.contains(`hl-${c}`))
    search.hidden = true
    row.hidden = false
    remove.hidden = false
    for (const dot of dots) dot.setAttribute('aria-pressed', String(dot.dataset.color === color))
    bar.hidden = false
    const box = markEl.getBoundingClientRect()
    place(box, box)
  }

  function check() {
    const sel = getSelection()
    if (Date.now() < quietUntil) {
      sel.removeAllRanges()
      return hide()
    }
    if (!sel.rangeCount || sel.isCollapsed) return current?.id ? undefined : hide() // a tapped highlight has no selection
    const range = sel.getRangeAt(0)
    const host = textHost(range.startContainer)
    if (!host || host !== textHost(range.endContainer) || !containers.some(c => c.contains(host))) return hide()
    const text = toQuery(selectedText(range))
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return hide()
    show(range, text, !!marks && marks.container.contains(host))
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer)
    selTimer = setTimeout(check, 250)
  })

  for (const container of containers) {
    container.addEventListener('click', event => {
      clearTimeout(tapTimer) // a second tap inside the window is a double-tap, which saves the passage instead
      if (current?.id) hide()
      if (event.target.closest('button') || !getSelection().isCollapsed) return
      const markEl = marks && event.target.closest('mark.hl')
      if (markEl && marks.container.contains(markEl)) {
        tapTimer = setTimeout(() => showMark(markEl), 330)
        return
      }
      const caret = caretAt(event.clientX, event.clientY)
      const range = caret && event.target.closest('.text p, .text .line') && wordRangeAt(caret.node, caret.offset)
      if (!range || ![...range.getClientRects()].some(r => near(r, event.clientX, event.clientY))) return hide()
      tapTimer = setTimeout(() => {
        const sel = getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }, 330)
    })
    container.addEventListener('scroll', () => {
      clearTimeout(tapTimer)
      if (bar.hidden) return
      getSelection().removeAllRanges()
      hide()
    }, { passive: true })
  }

  // Never let the bar take the selection away before it is tapped.
  bar.addEventListener('mousedown', event => event.preventDefault())
  bar.addEventListener('pointerdown', event => event.preventDefault())
  bar.addEventListener('click', event => {
    const btn = event.target.closest('button')
    if (!btn) return
    const target = current
    const q = query
    getSelection().removeAllRanges()
    hide()
    if (!target) return
    if (btn === search) {
      if (q) onSearch(q)
    } else if (btn.classList.contains('pick-dot')) {
      if (target.range) marks.add(target.range, btn.dataset.color)
      else marks.recolor(target.id, btn.dataset.color)
    } else if (btn === note) {
      if (target.range) marks.note(target.range)
      else marks.noteOn(target.id)
    } else if (btn === remove && target.id) {
      marks.remove(target.id)
    }
  })
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !bar.hidden) {
      getSelection().removeAllRanges()
      hide()
    }
  })

  return {
    // A double-tap saves the passage; the browser also selects the word under it, which should not offer a search.
    quiet() {
      clearTimeout(tapTimer)
      quietUntil = Date.now() + 700
      getSelection().removeAllRanges()
      hide()
    },
  }
}
