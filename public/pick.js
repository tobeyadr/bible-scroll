// Tap a word, or select a few, and a "Search" chip appears under it. The pure helpers run in node tests.

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

// containers: the lists of cards to watch. onSearch(query) is called when the chip is tapped.
export function initPicker({ containers, onSearch }) {
  const chip = document.createElement('button')
  chip.id = 'pickChip'
  chip.hidden = true
  document.body.append(chip)

  let query = ''
  let tapTimer
  let selTimer
  let quietUntil = 0

  const hide = () => {
    chip.hidden = true
    query = ''
  }

  function show(range, text) {
    query = text
    const shown = text.replace(/"/g, '')
    chip.textContent = `Search “${shown.length > 28 ? shown.slice(0, 27) + '…' : shown}”`
    chip.hidden = false
    const rects = range.getClientRects()
    const last = rects[rects.length - 1] || range.getBoundingClientRect()
    const box = range.getBoundingClientRect()
    const touch = matchMedia('(pointer: coarse)').matches
    const width = chip.offsetWidth
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, 12), innerWidth - width - 12)
    // Under the words (clear of the phone's own menu and selection handles), or above when there is no room.
    let top = last.bottom + (touch ? 44 : 10)
    if (top + 52 > innerHeight) top = box.top - 56
    chip.style.left = `${left}px`
    chip.style.top = `${Math.max(top, 8)}px`
  }

  function check() {
    const sel = getSelection()
    if (Date.now() < quietUntil) {
      sel.removeAllRanges()
      return hide()
    }
    if (!sel.rangeCount || sel.isCollapsed) return hide()
    const range = sel.getRangeAt(0)
    const host = textHost(range.startContainer)
    if (!host || host !== textHost(range.endContainer) || !containers.some(c => c.contains(host))) return hide()
    const text = toQuery(selectedText(range))
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return hide()
    show(range, text)
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer)
    selTimer = setTimeout(check, 250)
  })

  for (const container of containers) {
    container.addEventListener('click', event => {
      clearTimeout(tapTimer) // a second tap inside the window is a double-tap, which saves the passage instead
      if (event.target.closest('button') || !getSelection().isCollapsed) return
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
      if (chip.hidden) return
      getSelection().removeAllRanges()
      hide()
    }, { passive: true })
  }

  // Never let the chip take the selection away before it is tapped.
  chip.addEventListener('mousedown', event => event.preventDefault())
  chip.addEventListener('pointerdown', event => event.preventDefault())
  chip.addEventListener('click', () => {
    const q = query
    getSelection().removeAllRanges()
    hide()
    if (q) onSearch(q)
  })
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !chip.hidden) {
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
