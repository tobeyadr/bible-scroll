// Highlights: coloured marks on the words of a passage.
//
// A highlight is anchored by verse and character position rather than by DOM nodes, so it survives the page being
// rebuilt: it says "from character s of verse v1 to character e of verse v2". Positions count only the verse's own
// words (verse numbers left out) in the translation it was made in. The quote (q) it covers is kept as well, to check
// that the text still matches before anything is drawn, so a changed text never gets a mark in the wrong place.
// The pure helpers run in node tests; the DOM ones are at the bottom.

export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple']
export const DEFAULT_COLOR = COLORS[0]
export const MAX_QUOTE = 1500

// entries: one per text node of verse words, in reading order: { v: verse, start: where this node starts in the
// verse's text, len }. Pieces are parts of those nodes: { i: index into entries, from, to } (offsets inside the node).

// The words in some pieces as one line of text: the quote.
export const quoteOf = texts => texts.join(' ').replace(/\s+/g, ' ').trim()

// Drops spaces from the two ends of a selection so a mark never starts or ends on one. texts[i] is the node text.
export function trimPieces(pieces, texts) {
  const out = pieces.map(p => ({ ...p }))
  while (out.length) {
    const p = out[0]
    const text = texts[p.i]
    while (p.from < p.to && /\s/.test(text[p.from])) p.from++
    if (p.to > p.from) break
    out.shift()
  }
  while (out.length) {
    const p = out.at(-1)
    const text = texts[p.i]
    while (p.to > p.from && /\s/.test(text[p.to - 1])) p.to--
    if (p.to > p.from) break
    out.pop()
  }
  return out
}

// Where pieces begin and end, as a highlight's position: { v1, s, v2, e }.
export function anchorOf(entries, pieces) {
  if (!pieces.length) return null
  const first = pieces[0]
  const last = pieces.at(-1)
  return {
    v1: entries[first.i].v,
    s: entries[first.i].start + first.from,
    v2: entries[last.i].v,
    e: entries[last.i].start + last.to,
  }
}

// The parts of the text a highlight covers.
export function piecesOf(entries, h) {
  const out = []
  entries.forEach((entry, i) => {
    if (entry.v < h.v1 || entry.v > h.v2) return
    const lo = entry.v === h.v1 ? h.s : 0
    const hi = entry.v === h.v2 ? h.e : Infinity
    const from = Math.max(lo, entry.start) - entry.start
    const to = Math.min(hi, entry.start + entry.len) - entry.start
    if (to > from) out.push({ i, from, to })
  })
  return out
}

// One text node cut into runs. spans: [{ from, to, id }], oldest first. Where marks overlap the newest wins.
// Returns [{ from, to, id }] covering 0..len in order, id null where nothing is marked.
export function segmentsOf(len, spans) {
  const cuts = new Set([0, len])
  for (const s of spans) {
    cuts.add(Math.max(0, s.from))
    cuts.add(Math.min(len, s.to))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out = []
  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k]
    const to = points[k + 1]
    const top = spans.findLast(s => s.from <= from && s.to >= to)
    const last = out.at(-1)
    if (last && last.id === (top ? top.id : null)) last.to = to
    else out.push({ from, to, id: top ? top.id : null })
  }
  return out
}

// The same place in the text, compared as (verse, position).
const before = (v1, s1, v2, s2) => v1 < v2 || (v1 === v2 && s1 < s2)

// True when highlight `inner` lies completely inside `outer`.
export const contains = (outer, inner) => !before(inner.v1, inner.s, outer.v1, outer.s) && !before(outer.v2, outer.e, inner.v2, inner.e)

export const sameSpot = (a, b) => a.v1 === b.v1 && a.s === b.s && a.v2 === b.v2 && a.e === b.e

// ---------- DOM ----------

// The text nodes of a card's verse words (verse numbers left out) with the verse each belongs to.
// firstVerse is where the card starts, for words that come before its first verse number.
export function textEntries(root, firstVerse) {
  const entries = []
  const used = {}
  let verse = firstVerse
  for (const block of root.querySelectorAll('p, .line')) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('sup')) {
        const num = parseInt(n.data, 10)
        if (num) verse = num
        continue
      }
      const start = used[verse] || 0
      entries.push({ node: n, v: verse, start, len: n.data.length })
      used[verse] = start + n.data.length
    }
  }
  return entries
}

export function clearHighlights(root) {
  const parents = new Set()
  for (const mark of root.querySelectorAll('mark.hl')) {
    parents.add(mark.parentNode)
    mark.replaceWith(...mark.childNodes)
  }
  for (const parent of parents) parent.normalize()
}

// Draws the highlights (oldest first) on a card's text, replacing whatever was drawn before.
// hls: [{ id, col, v1, s, v2, e, q }]
export function paintHighlights(root, firstVerse, hls) {
  clearHighlights(root)
  if (!hls.length) return
  const entries = textEntries(root, firstVerse)
  const texts = entries.map(e => e.node.data)
  const spans = new Map() // entry index -> [{ from, to, id }]
  const colors = new Map()
  for (const h of hls) {
    const pieces = piecesOf(entries, h)
    if (!pieces.length || quoteOf(pieces.map(p => texts[p.i].slice(p.from, p.to))) !== h.q) continue
    colors.set(h.id, h.col)
    for (const p of pieces) {
      if (!spans.has(p.i)) spans.set(p.i, [])
      spans.get(p.i).push({ from: p.from, to: p.to, id: h.id })
    }
  }
  for (const [i, list] of spans) {
    const node = entries[i].node
    const frag = document.createDocumentFragment()
    for (const seg of segmentsOf(node.data.length, list)) {
      const text = node.data.slice(seg.from, seg.to)
      if (seg.id === null) {
        frag.append(text)
        continue
      }
      const mark = document.createElement('mark')
      mark.className = `hl hl-${colors.get(seg.id)}`
      mark.dataset.hid = seg.id
      mark.textContent = text
      frag.append(mark)
    }
    node.replaceWith(frag)
  }
}

// A selection as a highlight's position and quote, or null when it holds no words (or too many).
export function anchorOfRange(root, firstVerse, range) {
  const entries = textEntries(root, firstVerse)
  const pieces = []
  entries.forEach((entry, i) => {
    if (!range.intersectsNode(entry.node)) return
    const from = entry.node === range.startContainer ? range.startOffset : 0
    const to = entry.node === range.endContainer ? range.endOffset : entry.len
    if (to > from) pieces.push({ i, from, to })
  })
  const texts = entries.map(e => e.node.data)
  const trimmed = trimPieces(pieces, texts)
  const anchor = anchorOf(entries, trimmed)
  if (!anchor) return null
  const q = quoteOf(trimmed.map(p => texts[p.i].slice(p.from, p.to)))
  return q && q.length <= MAX_QUOTE ? { ...anchor, q } : null
}
